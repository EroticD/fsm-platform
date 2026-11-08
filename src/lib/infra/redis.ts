// i18n-ignore-file: Redis-tilkoblingens logger er driftsdata.
import type { Redis } from "ioredis";
import { logger } from "@/lib/logger";

export type InfraDriver = "db" | "redis";

function normaliseDriver(
  name: string,
  raw: string | undefined,
  fallback: InfraDriver,
): InfraDriver {
  const value = (raw?.trim() || fallback).toLowerCase();
  if (value === "db" || value === "redis") return value;
  throw new Error(
    `Ugyldig ${name} «${value}». Gyldige verdier er db og redis.`,
  );
}

export function queueDriver(
  env: Record<string, string | undefined> = process.env,
): InfraDriver {
  return normaliseDriver("QUEUE_DRIVER", env.QUEUE_DRIVER, "db");
}

export function cacheDriver(env: Record<string, string | undefined> = process.env): InfraDriver {
  return normaliseDriver("CACHE_DRIVER", env.CACHE_DRIVER, queueDriver(env));
}

export function rateLimitDriver(
  env: Record<string, string | undefined> = process.env,
): InfraDriver {
  return normaliseDriver(
    "RATE_LIMIT_DRIVER",
    env.RATE_LIMIT_DRIVER,
    queueDriver(env),
  );
}

export function redisUrl(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.REDIS_URL?.trim();
  return value ? value : null;
}

/**
 * Redis brukes bare når driveren er valgt *og* URL-en finnes. Mangler URL-en,
 * faller appen tilbake til databasen med en tydelig advarsel i stedet for å
 * nekte oppstart. Det gjør en glemt miljøvariabel ufarlig, men den logges.
 */
export function redisBackendEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const wantsRedis =
    queueDriver(env) === "redis" ||
    cacheDriver(env) === "redis" ||
    rateLimitDriver(env) === "redis";
  if (!wantsRedis) return false;
  if (!redisUrl(env)) {
    const scope = globalThis as RedisGlobal;
    if (!scope.__fsmRedisUrlWarned) {
      scope.__fsmRedisUrlWarned = true;
      logger.warn(
        "Redis er valgt, men REDIS_URL mangler. Bruker database-fallback.",
      );
    }
    return false;
  }
  return true;
}

type RedisGlobal = typeof globalThis & {
  __fsmRedisClient?: Promise<Redis> | null;
  __fsmRedisTestClient?: Redis | null;
  __fsmRedisUrlWarned?: boolean;
};

export function setRedisClientForTests(client: Redis | null): void {
  (globalThis as RedisGlobal).__fsmRedisTestClient = client;
  (globalThis as RedisGlobal).__fsmRedisClient = null;
}

export function resetRedisForTests(): void {
  const scope = globalThis as RedisGlobal;
  scope.__fsmRedisTestClient = undefined;
  scope.__fsmRedisClient = null;
}

async function connectRedis(url: string): Promise<Redis> {
  const ioredis = (await import("ioredis")) as unknown as {
    default?: new (url: string, options?: Record<string, unknown>) => Redis;
    Redis?: new (url: string, options?: Record<string, unknown>) => Redis;
  };
  const RedisCtor = ioredis.default ?? ioredis.Redis;
  if (!RedisCtor) throw new Error("ioredis er ikke tilgjengelig");
  const client = new RedisCtor(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
  });
  await client.connect();
  return client;
}

/**
 * Delt Redis-klient. Returnerer null når Redis ikke er konfigurert. Feil under
 * tilkobling nullstilles, slik at en senere forespørsel kan prøve igjen uten å
 * holde hele prosessen fast i en avvist promise.
 */
export async function getRedisClient(
  env: Record<string, string | undefined> = process.env,
): Promise<Redis | null> {
  const scope = globalThis as RedisGlobal;
  if (scope.__fsmRedisTestClient !== undefined) {
    return scope.__fsmRedisTestClient;
  }
  if (!redisBackendEnabled(env)) return null;
  const url = redisUrl(env);
  if (!url) return null;

  if (!scope.__fsmRedisClient) {
    scope.__fsmRedisClient = connectRedis(url).catch((error) => {
      scope.__fsmRedisClient = null;
      logger.error("Kunne ikke koble til Redis", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  }

  try {
    return await scope.__fsmRedisClient;
  } catch {
    return null;
  }
}

/** Lukker testklienten uten å røre produksjonssingletonen. */
export async function closeRedisForTests(): Promise<void> {
  const scope = globalThis as RedisGlobal;
  const client = scope.__fsmRedisTestClient;
  scope.__fsmRedisTestClient = undefined;
  scope.__fsmRedisClient = null;
  if (client) await client.quit().catch(() => undefined);
}
