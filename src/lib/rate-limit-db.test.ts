import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
    rateLimit: { deleteMany: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { allowRequestDb, cleanupRateLimits } from "./rate-limit-db";

const mockedRaw = vi.mocked(prisma.$queryRaw);
const mockedDelete = vi.mocked(prisma.rateLimit.deleteMany);

describe("allowRequestDb", () => {
  beforeEach(() => vi.clearAllMocks());

  it("slipper gjennom under grensen", async () => {
    mockedRaw.mockResolvedValue([{ count: 1, resetAt: new Date(Date.now() + 60_000) }] as never);
    await expect(allowRequestDb("login:test", 5, 60_000)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("avviser når grensen er nådd", async () => {
    mockedRaw.mockResolvedValue([{ count: 6, resetAt: new Date(Date.now() + 30_000) }] as never);
    const result = await allowRequestDb("login:test", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it("avviser uten å spørre databasen når grensen er null", async () => {
    const result = await allowRequestDb("x", 0, 60_000);
    expect(result.allowed).toBe(false);
    expect(mockedRaw).not.toHaveBeenCalled();
  });
});

describe("cleanupRateLimits", () => {
  it("sletter utløpte rader", async () => {
    mockedDelete.mockResolvedValue({ count: 4 } as never);
    await expect(cleanupRateLimits()).resolves.toBe(4);
  });
});
