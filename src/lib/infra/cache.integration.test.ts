import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { DbCacheStore, cleanupExpiredCache, getCachedJson, setCachedJson } from "./cache";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("InfraCache mot ekte PostgreSQL", () => {
  const prefix = unique("cache");
  const keys: string[] = [];

  function key(name: string): string {
    const value = `${prefix}:${name}`;
    keys.push(value);
    return value;
  }

  beforeAll(async () => {
    await prisma.infraCache.deleteMany({
      where: { key: { startsWith: prefix } },
    });
  });

  afterAll(async () => {
    await prisma.infraCache.deleteMany({
      where: { key: { startsWith: prefix } },
    });
    await prisma.$disconnect().catch(() => undefined);
  });

  it("lagrer og leser JSON med TTL", async () => {
    const cacheKey = key("les");
    await setCachedJson(cacheKey, { verdi: 42 }, 60);
    await expect(getCachedJson(cacheKey)).resolves.toEqual({ verdi: 42 });

    const row = await prisma.infraCache.findUnique({ where: { key: cacheKey } });
    expect(row?.value).toBe(JSON.stringify({ verdi: 42 }));
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("behandler utløpt rad som miss og rydder den", async () => {
    const cacheKey = key("utlopt");
    await prisma.infraCache.create({
      data: {
        key: cacheKey,
        value: "gammel",
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    await expect(getCachedJson(cacheKey)).resolves.toBeNull();
    await expect(
      prisma.infraCache.findUnique({ where: { key: cacheKey } }),
    ).resolves.toBeNull();
  });

  it("upsert oppdaterer verdi og levetid", async () => {
    const cacheKey = key("upsert");
    const store = new DbCacheStore();
    await store.set(cacheKey, "en", 60);
    await store.set(cacheKey, "to", 60);
    await expect(store.get(cacheKey)).resolves.toBe("to");
  });

  it("cleanupExpiredCache sletter bare utløpte rader", async () => {
    const expired = key("rydd-utlopt");
    const live = key("rydd-live");
    await prisma.infraCache.createMany({
      data: [
        { key: expired, value: "x", expiresAt: new Date(Date.now() - 1_000) },
        { key: live, value: "y", expiresAt: new Date(Date.now() + 60_000) },
      ],
    });

    await expect(cleanupExpiredCache()).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      prisma.infraCache.findUnique({ where: { key: expired } }),
    ).resolves.toBeNull();
    await expect(
      prisma.infraCache.findUnique({ where: { key: live } }),
    ).resolves.not.toBeNull();
  });
});
