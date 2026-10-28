import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  allowRequestDb: vi.fn(),
  resetRateLimitDb: vi.fn(),
  compare: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
  resetRateLimitDb: mocks.resetRateLimitDb,
}));
vi.mock("bcryptjs", () => ({
  default: { compare: mocks.compare },
}));

import { verifyCredentials } from "./credentials";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.resetRateLimitDb.mockResolvedValue(undefined);
  mocks.compare.mockResolvedValue(true);
  mocks.findUnique.mockResolvedValue({
    id: "u1",
    email: "kari@firma.no",
    name: "Kari",
    role: "OFFICE",
    password: "hash",
    isActive: true,
    isTwoFactorEnabled: false,
    sessionVersion: 0,
  });
});

describe("verifyCredentials – e-postnormalisering", () => {
  it("slår opp en e-post med store bokstaver og mellomrom i små bokstaver", async () => {
    const result = await verifyCredentials("  Kari@Firma.NO ", "riktig");

    expect(result.status).toBe("ok");
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: "kari@firma.no" },
    });
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "email:kari@firma.no",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("avviser ugyldig e-post uten å slå opp i databasen", async () => {
    const result = await verifyCredentials("ikke-en-epost", "riktig");

    expect(result).toEqual({ status: "invalid" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
