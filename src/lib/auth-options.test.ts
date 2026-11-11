import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bumpSessionVersion: vi.fn(),
  clearRecoveryCodesForDisplay: vi.fn(),
  auditStandalone: vi.fn(),
  auditRequestContext: vi.fn(),
}));

vi.mock("@/lib/credentials", () => ({
  verifyCredentials: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  bumpSessionVersion: mocks.bumpSessionVersion,
}));
vi.mock("@/lib/session-token", () => ({
  clearRecoveryCodesForDisplay: mocks.clearRecoveryCodesForDisplay,
}));
vi.mock("@/lib/audit", () => ({
  auditStandalone: mocks.auditStandalone,
  auditRequestContext: mocks.auditRequestContext,
}));

import { authOptions, SESSION_ABSOLUTE_MAX_AGE } from "./auth-options";
import { verifyCredentials } from "@/lib/credentials";

const mockedVerify = vi.mocked(verifyCredentials);

const provider = authOptions.providers[0] as unknown as {
  authorize?: (credentials: Record<string, string>, request: unknown) => Promise<unknown>;
  options?: {
    authorize?: (credentials: Record<string, string>, request: unknown) => Promise<unknown>;
  };
};
// NextAuth setter en stub på `authorize`; den ekte funksjonen ligger i `options`.
const authorize = provider.options?.authorize ?? provider.authorize;

describe("NextAuth authorize", () => {
  beforeEach(() => {
    mockedVerify.mockReset();
    mocks.auditStandalone.mockReset();
    mocks.auditStandalone.mockResolvedValue(undefined);
    mocks.auditRequestContext.mockResolvedValue({ ip: "203.0.113.9" });
  });

  it("slipper gjennom en aktiv bruker uten 2FA", async () => {
    mockedVerify.mockResolvedValue({
      status: "ok",
      user: {
        id: "u1",
        email: "kari@example.com",
        name: "Kari",
        role: "OFFICE",
        isTwoFactorEnabled: false,
        sessionVersion: 3,
      },
    });

    const result = await authorize!({ email: "kari@example.com", password: "x" }, { headers: {} });
    expect(result).toMatchObject({ id: "u1", sessionVersion: 3 });
  });

  it("avviser en 2FA-bruker slik at engangskoden ikke kan hoppes over", async () => {
    mockedVerify.mockResolvedValue({
      status: "ok",
      user: {
        id: "u2",
        email: "ola@example.com",
        name: "Ola",
        role: "ADMIN",
        isTwoFactorEnabled: true,
        sessionVersion: 0,
      },
    });

    const result = await authorize!({ email: "ola@example.com", password: "x" }, { headers: {} });
    expect(result).toBeNull();
  });

  it("avviser privilegert bruker uten 2FA når policyen krever det", async () => {
    const original = process.env.REQUIRE_2FA_ROLES;
    process.env.REQUIRE_2FA_ROLES = "ADMIN,OFFICE";
    try {
      mockedVerify.mockResolvedValue({
        status: "ok",
        user: {
          id: "u3",
          email: "office@example.com",
          name: "Office",
          role: "OFFICE",
          isTwoFactorEnabled: false,
          sessionVersion: 0,
        },
      });

      const result = await authorize!(
        { email: "office@example.com", password: "x" },
        { headers: {} },
      );
      expect(result).toBeNull();
    } finally {
      if (original === undefined) delete process.env.REQUIRE_2FA_ROLES;
      else process.env.REQUIRE_2FA_ROLES = original;
    }
  });

  it("avviser en inaktiv konto", async () => {
    mockedVerify.mockResolvedValue({ status: "inactive" });

    await expect(
      authorize!({ email: "inaktiv@example.com", password: "x" }, { headers: {} }),
    ).rejects.toThrow("AccountNotActivated");

    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "auth.login.inactive",
        outcome: "DENIED",
        entityId: "unknown",
      }),
    );
  });

  it("avviser feil passord", async () => {
    const forsoktPassord = "UnikTestPassord-42";
    mockedVerify.mockResolvedValue({ status: "invalid" });
    const result = await authorize!(
      { email: "feil@example.com", password: forsoktPassord },
      { headers: {} },
    );
    expect(result).toBeNull();

    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "auth.login.failed",
        outcome: "DENIED",
        entityId: "unknown",
      }),
    );
    // Verken e-posten eller passordet skal havne i revisjonsraden.
    const serialized = JSON.stringify(mocks.auditStandalone.mock.calls);
    expect(serialized).not.toContain("feil@example.com");
    expect(serialized).not.toContain(forsoktPassord);
  });

  it("ignorerer X-Forwarded-For når proxy ikke er betrodd", async () => {
    const original = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "false";
    try {
      mockedVerify.mockResolvedValue({ status: "invalid" });
      await authorize!(
        { email: "kari@example.com", password: "x" },
        { headers: { "x-forwarded-for": "1.2.3.4" } },
      );
      expect(mockedVerify).toHaveBeenCalledWith("kari@example.com", "x", undefined);
    } finally {
      process.env.TRUST_PROXY = original;
    }
  });

  it("bruker siste X-Forwarded-For når proxy er betrodd", async () => {
    const original = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    try {
      mockedVerify.mockResolvedValue({ status: "invalid" });
      await authorize!(
        { email: "kari@example.com", password: "x" },
        { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } },
      );
      expect(mockedVerify).toHaveBeenCalledWith("kari@example.com", "x", "10.0.0.1");
    } finally {
      process.env.TRUST_PROXY = original;
    }
  });
});

describe("jwt callback", () => {
  const jwt = authOptions.callbacks!.jwt!;

  it("setter absolutt starttid ved innlogging", async () => {
    const token = await jwt({
      token: {},
      user: { id: "u1", role: "OFFICE", sessionVersion: 2 },
    } as never);

    expect(token).toMatchObject({
      id: "u1",
      role: "OFFICE",
      sessionVersion: 2,
      sessionIssuedAt: expect.any(Number),
    });
  });

  it("avviser en økt som er eldre enn absolutt levetid", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await jwt({
      token: {
        id: "u1",
        sessionIssuedAt: now - SESSION_ABSOLUTE_MAX_AGE - 1,
      },
    } as never);

    expect(token).toBeNull();
    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "u1",
        actionCode: "auth.session.expired",
        metadata: expect.objectContaining({ reason: "absolute_max_age" }),
      }),
    );
  });

  it("fornyer en økt som fortsatt er innenfor levetiden", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await jwt({
      token: {
        id: "u1",
        role: "OFFICE",
        sessionVersion: 2,
        sessionIssuedAt: now - 60,
      },
    } as never);

    expect(token).toMatchObject({ id: "u1", role: "OFFICE" });
  });
});

describe("signOut event", () => {
  beforeEach(() => {
    mocks.bumpSessionVersion.mockReset();
    mocks.clearRecoveryCodesForDisplay.mockReset();
    mocks.auditStandalone.mockReset();
    mocks.auditRequestContext.mockReset();
    mocks.bumpSessionVersion.mockResolvedValue(3);
    mocks.clearRecoveryCodesForDisplay.mockResolvedValue(undefined);
    mocks.auditStandalone.mockResolvedValue(undefined);
    mocks.auditRequestContext.mockResolvedValue({});
  });

  it("ugyldiggjør brukerens JWTs og rydder visningscookien", async () => {
    await authOptions.events!.signOut!({
      token: { id: "u1" },
      session: {},
    } as never);

    expect(mocks.bumpSessionVersion).toHaveBeenCalledWith("u1");
    expect(mocks.clearRecoveryCodesForDisplay).toHaveBeenCalled();
  });

  it("revisjonslogger utloggingen med auth.logout", async () => {
    await authOptions.events!.signOut!({
      token: { id: "u1", name: "Kari", email: "kari@example.test" },
      session: {},
    } as never);

    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "User",
        entityId: "u1",
        actionCode: "auth.logout",
        outcome: "SUCCESS",
      }),
    );
  });

  it("fullfører utloggingen selv om revisjonsloggen feiler", async () => {
    mocks.auditStandalone.mockRejectedValue(new Error("db nede"));

    await expect(
      authOptions.events!.signOut!({
        token: { id: "u1" },
        session: {},
      } as never),
    ).resolves.toBeUndefined();

    expect(mocks.bumpSessionVersion).toHaveBeenCalledWith("u1");
    expect(mocks.clearRecoveryCodesForDisplay).toHaveBeenCalled();
  });
});
