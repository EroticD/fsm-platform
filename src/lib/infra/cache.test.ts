import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  infraCache: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  DbCacheStore,
  RedisCacheStore,
  cleanupExpiredCache,
  getCacheStore,
  getCachedJson,
  setCachedJson,
} from "./cache";
import { resetRedisForTests, setRedisClientForTests } from "./redis";

type FakeRedis = {
  values: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function fakeRedis(): FakeRedis {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRedisForTests();
});
afterEach(() => {
  resetRedisForTests();
});

describe("cache-adapter", () => {
  it("bruker databasen som standard", async () => {
    prismaMock.infraCache.findUnique.mockResolvedValue({
      value: JSON.stringify({ a: 1 }),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(getCachedJson("nøkkel")).resolves.toEqual({ a: 1 });
    expect(prismaMock.infraCache.findUnique).toHaveBeenCalledWith({
      where: { key: "nøkkel" },
      select: { value: true, expiresAt: true },
    });
  });

  it("behandler utløpt DB-rad som cache-miss og rydder den", async () => {
    prismaMock.infraCache.findUnique.mockResolvedValue({
      value: "gammel",
      expiresAt: new Date(Date.now() - 1_000),
    });
    prismaMock.infraCache.deleteMany.mockResolvedValue({ count: 1 });

    await expect(getCachedJson("gammel")).resolves.toBeNull();
    expect(prismaMock.infraCache.deleteMany).toHaveBeenCalledWith({
      where: { key: "gammel" },
    });
  });

  it("skriver JSON med TTL til DB", async () => {
    prismaMock.infraCache.upsert.mockResolvedValue({});
    await setCachedJson("k", { verdi: 2 }, 30);

    const call = prismaMock.infraCache.upsert.mock.calls[0][0] as {
      where: { key: string };
      create: { expiresAt: Date };
    };
    expect(call.where).toEqual({ key: "k" });
    expect(call.create.expiresAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it("bruker Redis når driveren er satt", async () => {
    const redis = fakeRedis();
    setRedisClientForTests(redis as unknown as Redis);

    const store = await getCacheStore({ CACHE_DRIVER: "redis" });
    expect(store.kind).toBe("redis");

    await store.set("a", "1", 10);
    await expect(store.get("a")).resolves.toBe("1");
    expect(redis.set).toHaveBeenCalledWith("fsm:cache:a", "1", "EX", 10);

    await store.delete("a");
    await expect(store.get("a")).resolves.toBeNull();
  });

  it("faller tilbake til DB når Redis ikke er konfigurert", async () => {
    const store = await getCacheStore({ CACHE_DRIVER: "redis" });
    expect(store).toBeInstanceOf(DbCacheStore);
  });

  it("RedisCacheStore og DbCacheStore oppfører seg likt for JSON-verdier", async () => {
    const redis = fakeRedis();
    setRedisClientForTests(redis as unknown as Redis);
    const redisStore = new RedisCacheStore(redis as unknown as Redis);
    await redisStore.set("x", JSON.stringify([1]), 5);
    await expect(redisStore.get("x")).resolves.toBe("[1]");

    prismaMock.infraCache.findUnique.mockResolvedValue({
      value: "[1]",
      expiresAt: new Date(Date.now() + 5_000),
    });
    const dbStore = new DbCacheStore();
    await expect(dbStore.get("x")).resolves.toBe("[1]");
  });

  it("rydder utløpte DB-rader", async () => {
    prismaMock.infraCache.deleteMany.mockResolvedValue({ count: 3 });
    await expect(cleanupExpiredCache()).resolves.toBe(3);
  });
});
