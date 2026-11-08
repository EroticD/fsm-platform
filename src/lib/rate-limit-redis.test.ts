import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  rateLimit: { deleteMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { allowRequestDb, allowRequestDbDirect } from "./rate-limit-db";
import { allowRequestRedis, resetRateLimitRedis } from "./rate-limit-redis";
import { resetRedisForTests, setRedisClientForTests } from "@/lib/infra/redis";

type FakeRedis = {
  eval: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function fakeRedis(response: unknown): FakeRedis {
  return {
    eval: vi.fn(async () => response),
    del: vi.fn(async () => 1),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRedisForTests();
  vi.unstubAllEnvs();
});
afterEach(() => {
  resetRedisForTests();
  vi.unstubAllEnvs();
});

describe("Redis rate limit", () => {
  it("slipper gjennom under grensen", async () => {
    const redis = fakeRedis([2, 59_000]);
    setRedisClientForTests(redis as unknown as Redis);

    await expect(allowRequestRedis("login", 5, 60_000)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("INCR"),
      1,
      "fsm:ratelimit:login",
      "60000",
    );
  });

  it("avviser med retry-after fra TTL", async () => {
    setRedisClientForTests(fakeRedis([6, 30_000]) as unknown as Redis);
    await expect(allowRequestRedis("login", 5, 60_000)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("returnerer null uten Redis-klient", async () => {
    await expect(allowRequestRedis("x", 1, 1_000)).resolves.toBeNull();
  });

  it("nullstiller tellere", async () => {
    const redis = fakeRedis([1, 1]);
    setRedisClientForTests(redis as unknown as Redis);
    await resetRateLimitRedis("a", "b");
    expect(redis.del).toHaveBeenCalledWith("fsm:ratelimit:a", "fsm:ratelimit:b");
  });
});

describe("rate-limit-fasade", () => {
  it("bruker Redis når driveren er valgt", async () => {
    vi.stubEnv("QUEUE_DRIVER", "redis");
    const redis = fakeRedis([1, 60_000]);
    setRedisClientForTests(redis as unknown as Redis);

    await expect(allowRequestDb("k", 5, 60_000)).resolves.toMatchObject({
      allowed: true,
    });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("faller tilbake til databasen når Redis feiler", async () => {
    vi.stubEnv("QUEUE_DRIVER", "redis");
    const redis = fakeRedis(null);
    redis.eval.mockRejectedValue(new Error("redis nede"));
    setRedisClientForTests(redis as unknown as Redis);
    prismaMock.$queryRaw.mockResolvedValue([
      { count: 1, resetAt: new Date(Date.now() + 60_000) },
    ]);

    await expect(allowRequestDb("k", 5, 60_000)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });

  it("databaseprimitive er uendret når Redis er av", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { count: 3, resetAt: new Date(Date.now() + 10_000) },
    ]);
    await expect(allowRequestDbDirect("k", 5, 60_000)).resolves.toMatchObject({
      allowed: true,
    });
  });
});
