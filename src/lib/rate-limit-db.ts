import prisma from "@/lib/prisma";

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
  await prisma.rateLimit.deleteMany({ where: { key: { in: keys } } });
}

/** Fjerner utløpte tellere. Kalles periodisk av bakgrunnsjobben. */
export async function cleanupRateLimits(): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { resetAt: { lt: new Date() } },
  });
  return result.count;
}
