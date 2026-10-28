import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    twoFactorRecoveryCode: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  allowRequestDb: vi.fn(),
  resetRateLimitDb: vi.fn(),
  verifyTotp: vi.fn(),
  createTotpSecret: vi.fn(() => "NY-HEMMELIGHET"),
  replaceRecoveryCodes: vi.fn(async () => ["AAAA-BBBB", "CCCC-DDDD"]),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
  resetRateLimitDb: mocks.resetRateLimitDb,
}));
vi.mock("@/lib/two-factor", () => ({
  createTotpSecret: mocks.createTotpSecret,
  verifyTotp: mocks.verifyTotp,
  TWO_FACTOR_SETUP_TTL_MS: 10 * 60_000,
}));
vi.mock("@/lib/two-factor-recovery", () => ({
  replaceRecoveryCodes: mocks.replaceRecoveryCodes,
}));

import {
  cancelTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
  verifyOwnPassword,
} from "./security";

const actor: ServiceActor = {
  id: "user-1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
};

const CORRECT_PASSWORD = "riktig-passord";
const CORRECT_CODE = "123456";
let passwordHash = "";

/** Teller per nøkkel, slik den ekte databasetelleren gjør. */
function installRateLimitCounter() {
  const counters = new Map<string, number>();
  mocks.allowRequestDb.mockImplementation(
    async (key: string, limit: number) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return {
        allowed: count <= limit,
        retryAfterSeconds: count <= limit ? 0 : 900,
      };
    },
  );
  return counters;
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash(CORRECT_PASSWORD, 4);
});

beforeEach(() => {
  vi.clearAllMocks();
  installRateLimitCounter();

  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.user.update.mockResolvedValue({ sessionVersion: 7 });
  mocks.prisma.twoFactorRecoveryCode.deleteMany.mockResolvedValue({ count: 10 });
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.user.findUnique.mockImplementation(
    async ({ select }: { select?: Record<string, boolean> }) => {
      if (select?.password) return { password: passwordHash };
      if (select?.twoFactorSecret && select?.twoFactorSetupStartedAt) {
        return {
          twoFactorSecret: "HEMMELIGHET",
          twoFactorSetupStartedAt: new Date(),
        };
      }
      if (select?.twoFactorSecret && select?.isTwoFactorEnabled) {
        return { twoFactorSecret: "HEMMELIGHET", isTwoFactorEnabled: true };
      }
      if (select?.twoFactorSecret) return { twoFactorSecret: "HEMMELIGHET" };
      if (select?.isTwoFactorEnabled) return { isTwoFactorEnabled: false };
      return null;
    },
  );
  mocks.verifyTotp.mockImplementation(
    (_secret: string, token: string) => token === CORRECT_CODE,
  );
});

describe("2FA-innstillinger – rate limiting", () => {
  it("sperrer etter fem feil TOTP-koder", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        confirmTwoFactorSetup(actor, {
          password: CORRECT_PASSWORD,
          code: "000000",
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid_code" });
    }

    await expect(
      confirmTwoFactorSetup(actor, {
        password: CORRECT_PASSWORD,
        code: "000000",
      }),
    ).resolves.toEqual({ ok: false, reason: "rate_limited" });

    // Den sjette forespørselen skal stoppes før koden i det hele tatt sjekkes.
    expect(mocks.verifyTotp).toHaveBeenCalledTimes(5);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("sperrer etter fem feil passordforsøk", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        startTwoFactorSetup(actor, { password: "feil-passord" }),
      ).resolves.toEqual({ ok: false, reason: "invalid_password" });
    }

    await expect(
      startTwoFactorSetup(actor, { password: "feil-passord" }),
    ).resolves.toEqual({ ok: false, reason: "rate_limited" });

    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("bruker både bruker- og IP-nøkkel med riktige grenser", async () => {
    await startTwoFactorSetup(actor, { password: "feil-passord" }, "10.0.0.5");

    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "2fa-settings:user:user-1",
      5,
      15 * 60_000,
    );
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "2fa-settings:ip:10.0.0.5",
      20,
      15 * 60_000,
    );
  });

  it("sperrer når bare IP-grensen er nådd", async () => {
    mocks.allowRequestDb.mockImplementation(
      async (key: string) =>
        key.startsWith("2fa-settings:ip:")
          ? { allowed: false, retryAfterSeconds: 900 }
          : { allowed: true, retryAfterSeconds: 0 },
    );

    await expect(
      verifyOwnPassword(actor, CORRECT_PASSWORD, "10.0.0.5"),
    ).resolves.toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("2FA-innstillinger – verifisering", () => {
  it("deaktiverer 2FA med riktig passord og TOTP i én transaksjon", async () => {
    const result = await disableTwoFactor(actor, {
      password: CORRECT_PASSWORD,
      code: CORRECT_CODE,
    });

    expect(result).toEqual({ ok: true, data: { sessionVersion: 7 } });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        isTwoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorSetupStartedAt: null,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });
    expect(mocks.prisma.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "User",
        entityId: "user-1",
        action: "Slå av to-trinns verifisering",
      }),
    });
    expect(mocks.resetRateLimitDb).toHaveBeenCalled();
  });

  it("krever både passord og TOTP ved deaktivering", async () => {
    await expect(
      disableTwoFactor(actor, { password: "feil", code: CORRECT_CODE }),
    ).resolves.toEqual({ ok: false, reason: "invalid_password" });

    await expect(
      disableTwoFactor(actor, { password: CORRECT_PASSWORD, code: "000000" }),
    ).resolves.toEqual({ ok: false, reason: "invalid_code" });

    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("aktiverer 2FA og øker øktversjonen i samme transaksjon", async () => {
    const result = await confirmTwoFactorSetup(actor, {
      password: CORRECT_PASSWORD,
      code: CORRECT_CODE,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        sessionVersion: 7,
        recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"],
      },
    });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        isTwoFactorEnabled: true,
        twoFactorSetupStartedAt: null,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });
    expect(mocks.replaceRecoveryCodes).toHaveBeenCalledWith(
      mocks.prisma,
      "user-1",
    );
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "Slå på to-trinns verifisering",
      }),
    });
    // En eksisterende kalenderlenke skal ikke overleve en 2FA-endring.
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        calendarTokenHash: null,
        calendarTokenCreatedAt: null,
        calendarTokenLastUsedAt: null,
      },
    });
  });

  it("krever passord på nytt når oppsettet bekreftes", async () => {
    await expect(
      confirmTwoFactorSetup(actor, {
        password: "feil-passord",
        code: CORRECT_CODE,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_password" });

    expect(mocks.verifyTotp).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("avviser et oppsett som er eldre enn ti minutter og sletter det", async () => {
    const startedAt = new Date(Date.now() - 11 * 60_000);
    mocks.prisma.user.findUnique.mockImplementation(
      async ({ select }: { select?: Record<string, boolean> }) => {
        if (select?.password) return { password: passwordHash };
        if (select?.twoFactorSecret && select?.twoFactorSetupStartedAt) {
          return { twoFactorSecret: "HEMMELIGHET", twoFactorSetupStartedAt: startedAt };
        }
        return null;
      },
    );

    await expect(
      confirmTwoFactorSetup(actor, {
        password: CORRECT_PASSWORD,
        code: CORRECT_CODE,
      }),
    ).resolves.toEqual({ ok: false, reason: "setup-expired" });

    expect(mocks.verifyTotp).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1", twoFactorSetupStartedAt: startedAt },
      data: { twoFactorSecret: null, twoFactorSetupStartedAt: null },
    });
  });

  it("avviser et ventende oppsett uten tidsstempel", async () => {
    mocks.prisma.user.findUnique.mockImplementation(
      async ({ select }: { select?: Record<string, boolean> }) => {
        if (select?.password) return { password: passwordHash };
        if (select?.twoFactorSecret && select?.twoFactorSetupStartedAt) {
          return { twoFactorSecret: "HEMMELIGHET", twoFactorSetupStartedAt: null };
        }
        return null;
      },
    );

    await expect(
      confirmTwoFactorSetup(actor, {
        password: CORRECT_PASSWORD,
        code: CORRECT_CODE,
      }),
    ).resolves.toEqual({ ok: false, reason: "setup-expired" });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1", twoFactorSetupStartedAt: null },
      data: { twoFactorSecret: null, twoFactorSetupStartedAt: null },
    });
  });

  it("setter tidsstempel når et nytt oppsett startes", async () => {
    await expect(
      startTwoFactorSetup(actor, { password: CORRECT_PASSWORD }),
    ).resolves.toEqual({ ok: true, data: undefined });

    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1", isTwoFactorEnabled: false },
      data: {
        twoFactorSecret: "NY-HEMMELIGHET",
        twoFactorSetupStartedAt: expect.any(Date),
        isTwoFactorEnabled: false,
      },
    });
  });

  it("krever både passord og TOTP for nye gjenopprettingskoder", async () => {
    await expect(
      regenerateRecoveryCodes(actor, {
        password: CORRECT_PASSWORD,
        code: "000000",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_code" });
    await expect(
      regenerateRecoveryCodes(actor, { password: CORRECT_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "invalid_code" });
    await expect(
      regenerateRecoveryCodes(actor, {
        password: "feil-passord",
        code: CORRECT_CODE,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_password" });

    expect(mocks.replaceRecoveryCodes).not.toHaveBeenCalled();

    await expect(
      regenerateRecoveryCodes(actor, {
        password: CORRECT_PASSWORD,
        code: CORRECT_CODE,
      }),
    ).resolves.toEqual({
      ok: true,
      data: { recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"] },
    });
    expect(mocks.replaceRecoveryCodes).toHaveBeenCalledWith(
      mocks.prisma,
      "user-1",
    );
  });

  it("lager ikke nye gjenopprettingskoder når 2FA er slått av", async () => {
    mocks.prisma.user.findUnique.mockImplementation(
      async ({ select }: { select?: Record<string, boolean> }) => {
        if (select?.password) return { password: passwordHash };
        if (select?.isTwoFactorEnabled) {
          return { isTwoFactorEnabled: false, twoFactorSecret: null };
        }
        return null;
      },
    );

    await expect(
      regenerateRecoveryCodes(actor, {
        password: CORRECT_PASSWORD,
        code: CORRECT_CODE,
      }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.replaceRecoveryCodes).not.toHaveBeenCalled();
  });

  it("avbryter oppsett og ugyldiggjør øktene i samme transaksjon", async () => {
    const result = await cancelTwoFactorSetup(actor, {
      password: CORRECT_PASSWORD,
    });

    expect(result).toEqual({ ok: true, data: { sessionVersion: 7 } });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1", isTwoFactorEnabled: false },
      data: {
        twoFactorSecret: null,
        twoFactorSetupStartedAt: null,
        isTwoFactorEnabled: false,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });
  });

  it("kan ikke starte eller avbryte oppsett når 2FA allerede er aktivert", async () => {
    // En kapret økt med passord skal ikke kunne omgå TOTP-kravet ved å
    // overskrive eller avbryte en aktiv 2FA-konfigurasjon.
    mocks.prisma.user.findUnique.mockImplementation(
      async ({ select }: { select?: Record<string, boolean> }) => {
        if (select?.password) return { password: passwordHash };
        if (select?.isTwoFactorEnabled) return { isTwoFactorEnabled: true };
        return null;
      },
    );

    await expect(
      startTwoFactorSetup(actor, { password: CORRECT_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(
      cancelTwoFactorSetup(actor, { password: CORRECT_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });

    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("avviser start og avbryt hvis 2FA aktiveres samtidig", async () => {
    mocks.prisma.user.update.mockRejectedValue({ code: "P2025" });

    await expect(
      startTwoFactorSetup(actor, { password: CORRECT_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(
      cancelTwoFactorSetup(actor, { password: CORRECT_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("2FA-innstillinger – revisjonslogg uten hemmeligheter", () => {
  it("logger aldri TOTP-koden eller passordet", async () => {
    const secretPassword = "SuperHemmeligPassord!";
    const secretCode = "999999";

    await disableTwoFactor(actor, {
      password: secretPassword,
      code: secretCode,
    });
    await startTwoFactorSetup(actor, { password: secretPassword });

    const serialized = JSON.stringify(mocks.prisma.auditLog.create.mock.calls);

    expect(serialized).toContain("2FA: feilet verifisering");
    expect(serialized).not.toContain(secretPassword);
    expect(serialized).not.toContain(secretCode);
  });
});
