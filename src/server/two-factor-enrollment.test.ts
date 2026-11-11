import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  auditStandalone: vi.fn(),
  auditRequestContext: vi.fn(),
  createTotpSecret: vi.fn(),
  verifyTotpStep: vi.fn(),
  acceptTotpTimeStep: vi.fn(),
  replaceRecoveryCodes: vi.fn(),
  clearCalendarToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({
  audit: mocks.audit,
  auditStandalone: mocks.auditStandalone,
  auditRequestContext: mocks.auditRequestContext,
}));
vi.mock("@/lib/two-factor", () => ({
  createTotpSecret: mocks.createTotpSecret,
  TWO_FACTOR_SETUP_TTL_MS: 10 * 60_000,
  verifyTotpStep: mocks.verifyTotpStep,
  acceptTotpTimeStep: mocks.acceptTotpTimeStep,
}));
vi.mock("@/lib/two-factor-recovery", () => ({
  replaceRecoveryCodes: mocks.replaceRecoveryCodes,
}));
vi.mock("./calendar-feed", () => ({
  clearCalendarToken: mocks.clearCalendarToken,
}));

import {
  confirmRequiredEnrollment,
  startRequiredEnrollment,
} from "./two-factor-enrollment";

const user = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "ADMIN",
  isActive: true,
  isTwoFactorEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTotpSecret.mockReturnValue("HEMMELIG");
  mocks.verifyTotpStep.mockReturnValue({ valid: true, timeStep: 42 });
  mocks.acceptTotpTimeStep.mockResolvedValue(true);
  mocks.replaceRecoveryCodes.mockResolvedValue(["AAAA-BBBB"]);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) =>
      callback(mocks.prisma),
  );
  mocks.prisma.user.findUnique.mockResolvedValue(user);
  mocks.prisma.user.update.mockResolvedValue({ sessionVersion: 5 });
});

describe("startRequiredEnrollment", () => {
  it("lagrer en ventende hemmelighet og revisjonslogger starten", async () => {
    const result = await startRequiredEnrollment("u1");

    expect(result.ok).toBe(true);
    const update = mocks.prisma.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "u1", isTwoFactorEnabled: false });
    expect(update.data).toMatchObject({
      twoFactorSecret: "HEMMELIG",
      isTwoFactorEnabled: false,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "User",
        action: "2FA: startet påkrevd oppsett",
      }),
    );
  });

  it("avviser inaktiv bruker og bruker som allerede har 2FA", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });
    expect(await startRequiredEnrollment("u1")).toEqual({
      ok: false,
      reason: "forbidden",
    });

    mocks.prisma.user.findUnique.mockResolvedValue({
      ...user,
      isTwoFactorEnabled: true,
    });
    expect(await startRequiredEnrollment("u1")).toEqual({
      ok: false,
      reason: "already_enabled",
    });
  });
});

describe("confirmRequiredEnrollment", () => {
  it("aktiverer 2FA, lager gjenopprettingskoder og øker øktversjonen", async () => {
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({
        twoFactorSecret: "HEMMELIG",
        twoFactorSetupStartedAt: new Date(),
        lastTotpTimeStep: null,
      });

    const result = await confirmRequiredEnrollment("u1", "123456");

    expect(result).toEqual({
      ok: true,
      data: { sessionVersion: 5, recoveryCodes: ["AAAA-BBBB"] },
    });
    expect(mocks.verifyTotpStep).toHaveBeenCalledWith("HEMMELIG", "123456", null);
    expect(mocks.acceptTotpTimeStep).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      42,
    );
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1", isTwoFactorEnabled: false },
        data: expect.objectContaining({
          isTwoFactorEnabled: true,
          sessionVersion: { increment: 1 },
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "2FA: fullførte påkrevd oppsett" }),
    );
  });

  it("avviser feil kode og logger forsøket", async () => {
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({
        twoFactorSecret: "HEMMELIG",
        twoFactorSetupStartedAt: new Date(),
        lastTotpTimeStep: null,
      });
    mocks.verifyTotpStep.mockReturnValue({ valid: false });

    const result = await confirmRequiredEnrollment("u1", "000000");

    expect(result).toEqual({ ok: false, reason: "invalid_code" });
    expect(mocks.auditStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "u1",
        action: "2FA: feilet verifisering",
        actionCode: "auth.2fa.failed",
        outcome: "DENIED",
      }),
    );
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("avviser utløpt oppsett og sletter hemmeligheten", async () => {
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({
        twoFactorSecret: "HEMMELIG",
        twoFactorSetupStartedAt: new Date(Date.now() - 11 * 60_000),
        lastTotpTimeStep: null,
      });

    const result = await confirmRequiredEnrollment("u1", "123456");

    expect(result).toEqual({ ok: false, reason: "setup_expired" });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { twoFactorSecret: null, twoFactorSetupStartedAt: null },
      }),
    );
  });
});
