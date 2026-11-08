import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { rateLimitDriver } from "@/lib/infra/redis";
import { allowRequestRedis, resetRateLimitRedis } from "@/lib/rate-limit-redis";

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Delt, atomisk rate limiting i PostgreSQL.
 *
 * Telleren ligger i `RateLimit`, slik at flere app-instanser ser samme grense.
 * Upserten er én atomisk spørring: vinduet nullstilles når `resetAt` er passert,
 * ellers økes telleren. Det er trygt under samtidige forespørsler.
 */
export async function allowRequestDb(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (limit <= 0) return { allowed: false, retryAfterSeconds: 0 };

  // Redis er en optimalisering, ikke et krav. Feiler den, bruker vi den
  // databasetransaksjonen under – som fortsatt er delt mellom alle replikaer.
  if (rateLimitDriver() === "redis") {
    try {
      const redis = await allowRequestRedis(key, limit, windowMs);
      if (redis) return redis;
    } catch (error) {
      logger.warn("Redis rate limit feilet; bruker database", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return allowRequestDbDirect(key, limit, windowMs);
}

/** Selve databaseimplementasjonen. Eksportert for tester og fallback. */
export async function allowRequestDbDirect(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  if (limit <= 0) return { allowed: false, retryAfterSeconds: 0 };

  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + (${windowMs} * interval '1 millisecond'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."resetAt" <= now() THEN 1
        ELSE "RateLimit"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimit"."resetAt" <= now()
          THEN now() + (${windowMs} * interval '1 millisecond')
        ELSE "RateLimit"."resetAt"
      END
    RETURNING "count", "resetAt"
  `;

  const row = rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0 };

  const allowed = Number(row.count) <= limit;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(
          0,
          Math.ceil((new Date(row.resetAt).getTime() - Date.now()) / 1000),
        ),
  };
}

/** Nullstiller tellere etter en vellykket innlogging. */
export async function resetRateLimitDb(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (rateLimitDriver() === "redis") {
    await resetRateLimitRedis(...keys).catch(() => undefined);
  }
  // DB ryddes uansett, slik at en teller fra før Redis ble slått på ikke
  // fortsetter å blokkere etter en vellykket innlogging.
  await prisma.rateLimit.deleteMany({ where: { key: { in: keys } } });
}

/** Fjerner utløpte tellere. Kalles periodisk av bakgrunnsjobben. */
export async function cleanupRateLimits(): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { resetAt: { lt: new Date() } },
  });
  return result.count;
}
