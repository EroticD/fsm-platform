import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/credentials", () => ({
  verifyCredentials: vi.fn(),
}));

import { authOptions } from "./auth-options";
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

  it("avviser en inaktiv konto", async () => {
    mockedVerify.mockResolvedValue({ status: "inactive" });

    await expect(
      authorize!({ email: "inaktiv@example.com", password: "x" }, { headers: {} }),
    ).rejects.toThrow("AccountNotActivated");
  });

  it("avviser feil passord", async () => {
    mockedVerify.mockResolvedValue({ status: "invalid" });
    const result = await authorize!({ email: "feil@example.com", password: "x" }, { headers: {} });
    expect(result).toBeNull();
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

  it("bruker første X-Forwarded-For når proxy er betrodd", async () => {
    const original = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    try {
      mockedVerify.mockResolvedValue({ status: "invalid" });
      await authorize!(
        { email: "kari@example.com", password: "x" },
        { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } },
      );
      expect(mockedVerify).toHaveBeenCalledWith("kari@example.com", "x", "1.2.3.4");
    } finally {
      process.env.TRUST_PROXY = original;
    }
  });
});
