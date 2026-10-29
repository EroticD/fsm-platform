import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  verifyCredentials: vi.fn(),
  verifyTotpStep: vi.fn(),
  acceptTotpTimeStep: vi.fn(),
  setPendingTwoFactor: vi.fn(),
  readPendingTwoFactor: vi.fn(),
  clearPendingTwoFactor: vi.fn(),
  createSessionCookie: vi.fn(),
  allowRequestDb: vi.fn(),
  resetRateLimitDb: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/credentials", () => ({
  verifyCredentials: mocks.verifyCredentials,
}));
vi.mock("@/lib/two-factor", () => ({
  verifyTotpStep: mocks.verifyTotpStep,
  acceptTotpTimeStep: mocks.acceptTotpTimeStep,
}));
vi.mock("@/lib/session-token", () => ({
  setPendingTwoFactor: mocks.setPendingTwoFactor,
  readPendingTwoFactor: mocks.readPendingTwoFactor,
  clearPendingTwoFactor: mocks.clearPendingTwoFactor,
  createSessionCookie: mocks.createSessionCookie,
}));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
  resetRateLimitDb: mocks.resetRateLimitDb,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { loginAction, verifyTwoFactorAction } from "./actions";
import { safeRelativeTarget } from "@/lib/safe-redirect";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

const credentialUser = {
  id: "user-1",
  email: "kari@example.test",
  name: "Kari",
  role: "OFFICE",
  isTwoFactorEnabled: true,
  sessionVersion: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) => callback({}),
  );
  mocks.acceptTotpTimeStep.mockResolvedValue(true);
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.verifyCredentials.mockResolvedValue({
    status: "ok",
    user: credentialUser,
  });
});

describe("loginAction – fail closed for 2FA", () => {
  it("avviser innlogging når 2FA er slått på men hemmeligheten mangler", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      isTwoFactorEnabled: true,
      twoFactorSecret: null,
    });

    await expect(
      loginAction(
        formData({ email: credentialUser.email, password: "passord" }),
      ),
    ).rejects.toThrow("REDIRECT:/logg-inn?error=TwoFactorUnavailable");

    expect(mocks.setPendingTwoFactor).not.toHaveBeenCalled();
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it("sender en korrekt konfigurert 2FA-bruker til kode-steget", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      isTwoFactorEnabled: true,
      twoFactorSecret: "HEMMELIGHET",
    });

    await expect(
      loginAction(
        formData({
          email: credentialUser.email,
          password: "passord",
          callbackUrl: "/kunder",
        }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/logg-inn/2fa?callbackUrl=%2Fkunder",
    );

    expect(mocks.setPendingTwoFactor).toHaveBeenCalledWith("user-1");
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });
});

describe("loginAction – rollehjem", () => {
  beforeEach(() => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      isTwoFactorEnabled: false,
      twoFactorSecret: null,
    });
  });

  it.each([
    ["TECHNICIAN", "/mine-oppdrag"],
    ["OFFICE", "/"],
    ["ADMIN", "/"],
    ["CUSTOMER", "/kundeportal"],
  ])("sender %s hjem uten eksplisitt callback", async (role, target) => {
    mocks.verifyCredentials.mockResolvedValue({
      status: "ok",
      user: { ...credentialUser, role },
    });

    await expect(
      loginAction(
        formData({
          email: credentialUser.email,
          password: "passord",
          callbackUrl: "/",
        }),
      ),
    ).rejects.toThrow(`REDIRECT:${target}`);
  });

  it("respekterer en eksplisitt trygg callback for montører", async () => {
    mocks.verifyCredentials.mockResolvedValue({
      status: "ok",
      user: { ...credentialUser, role: "TECHNICIAN" },
    });

    await expect(
      loginAction(
        formData({
          email: credentialUser.email,
          password: "passord",
          callbackUrl: "/kunder",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/kunder");
  });
});

describe("verifyTwoFactorAction – replay-vern", () => {
  beforeEach(() => {
    mocks.readPendingTwoFactor.mockResolvedValue("user-1");
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "kari@example.test",
      name: "Kari",
      role: "OFFICE",
      sessionVersion: 2,
      isActive: true,
      isTwoFactorEnabled: true,
      twoFactorSecret: "HEMMELIGHET",
      lastTotpTimeStep: 100,
    });
  });

  it("godtar en ny kode og lagrer tidssteget", async () => {
    mocks.verifyTotpStep.mockReturnValue({ valid: true, timeStep: 101 });

    await expect(
      verifyTwoFactorAction(formData({ code: "123456" })),
    ).rejects.toThrow("REDIRECT:/");

    expect(mocks.verifyTotpStep).toHaveBeenCalledWith(
      "HEMMELIGHET",
      "123456",
      100,
    );
    expect(mocks.acceptTotpTimeStep).toHaveBeenCalledWith(expect.anything(), "user-1", 101);
    expect(mocks.createSessionCookie).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
    );
  });

  it("sender en montør til I dag når callback mangler", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "montor@example.test",
      name: "Montør",
      role: "TECHNICIAN",
      sessionVersion: 2,
      isActive: true,
      isTwoFactorEnabled: true,
      twoFactorSecret: "HEMMELIGHET",
      lastTotpTimeStep: 100,
    });
    mocks.verifyTotpStep.mockReturnValue({ valid: true, timeStep: 101 });

    await expect(
      verifyTwoFactorAction(formData({ code: "123456", callbackUrl: "/" })),
    ).rejects.toThrow("REDIRECT:/mine-oppdrag");
  });

  it("avviser en kode som allerede er brukt", async () => {
    mocks.verifyTotpStep.mockReturnValue({ valid: true, timeStep: 100 });
    mocks.acceptTotpTimeStep.mockResolvedValue(false);

    await expect(
      verifyTwoFactorAction(formData({ code: "123456" })),
    ).rejects.toThrow("REDIRECT:/logg-inn/2fa?error=InvalidTwoFactor");

    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
    expect(mocks.resetRateLimitDb).not.toHaveBeenCalled();
  });
});

describe("safeRelativeTarget", () => {
  it("beholder vanlige relative stier", () => {
    expect(safeRelativeTarget("/kunder?x=1#a")).toBe("/kunder?x=1#a");
  });

  it.each([
    "//evil.example",
    "/..//evil.example",
    "/a/..//evil.example",
    "/.//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
  ])("avviser utenforliggende mål: %s", (value) => {
    expect(safeRelativeTarget(value)).toBe("/");
  });
});
