import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPendingTwoFactor: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/session-token", () => ({
  readPendingTwoFactor: mocks.readPendingTwoFactor,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/prisma", () => ({
  default: { branding: { findFirst: vi.fn(async () => null) } },
}));
vi.mock("../actions", () => ({
  verifyTwoFactorAction: vi.fn(),
  verifyRecoveryCodeAction: vi.fn(),
}));
vi.mock("../SubmitButton", () => ({ default: () => null }));

import TwoFactorPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("2FA-siden – utløpt økt", () => {
  it("forklarer utløpet på innloggingssiden og beholder callbackUrl", async () => {
    mocks.readPendingTwoFactor.mockResolvedValue(null);

    await expect(
      TwoFactorPage({
        searchParams: Promise.resolve({
          error: "TwoFactorExpired",
          callbackUrl: "/kunder",
        }),
      }),
    ).rejects.toThrow(
      "REDIRECT:/logg-inn?error=TwoFactorExpired&callbackUrl=%2Fkunder",
    );
  });

  it("sender en direkte besøkende til innlogging uten feilmelding", async () => {
    mocks.readPendingTwoFactor.mockResolvedValue(null);

    await expect(
      TwoFactorPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/logg-inn");
  });
});
