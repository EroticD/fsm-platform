// i18n-ignore-file: cache-data og logger er driftsdata.
import type { Redis } from "ioredis";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { cacheDriver, getRedisClient } from "./redis";

const REDIS_PREFIX = "fsm:cache:";

export type CacheStoreKind = "db" | "redis";

export interface CacheStore {
  readonly kind: CacheStoreKind;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Database-fallback. Raden ryddes når den er utløpt, uten egen jobb. */
export class DbCacheStore implements CacheStore {
  readonly kind = "db" as const;

  async get(key: string): Promise<string | null> {
    const row = await prisma.infraCache.findUnique({
      where: { key },
      select: { value: true, expiresAt: true },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await prisma.infraCache.deleteMany({ where: { key } }).catch(() => undefined);
      return null;
    }
    return row.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + Math.max(1, ttlSeconds) * 1_000);
    await prisma.infraCache.upsert({
      where: { key },
      create: { key, value, expiresAt },
      update: { value, expiresAt },
    });
  }

  async delete(key: string): Promise<void> {
    await prisma.infraCache.deleteMany({ where: { key } });
  }
}

export class RedisCacheStore implements CacheStore {
  readonly kind = "redis" as const;

  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(`${REDIS_PREFIX}${key}`);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(
      `${REDIS_PREFIX}${key}`,
      value,
      "EX",
      Math.max(1, ttlSeconds),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.del(`${REDIS_PREFIX}${key}`);
  }
}

/**
 * Redis når den er konfigurert, ellers databasen. En Redis-feil skal aldri
 * velte en side eller en jobb: lesing gir da cache-miss og skriving logges.
 */
export async function getCacheStore(
  env: Record<string, string | undefined> = process.env,
): Promise<CacheStore> {
  if (cacheDriver(env) === "redis") {
    const client = await getRedisClient(env);
    if (client) return new RedisCacheStore(client);
  }
  return new DbCacheStore();
}

export async function getCachedJson<T>(
  key: string,
  env: Record<string, string | undefined> = process.env,
): Promise<T | null> {
  try {
    const raw = await (await getCacheStore(env)).get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn("Cache-lesing feilet", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function setCachedJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  try {
    await (await getCacheStore(env)).set(
      key,
      JSON.stringify(value),
      ttlSeconds,
    );
  } catch (error) {
    logger.warn("Cache-skriving feilet", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteCachedValue(
  key: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  try {
    await (await getCacheStore(env)).delete(key);
  } catch {
    // Cache er best effort.
  }
}

/** Rydder utløpte DB-rader. Redis nøkler har egen TTL. */
export async function cleanupExpiredCache(now = new Date()): Promise<number> {
  const result = await prisma.infraCache.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return result.count;
}
