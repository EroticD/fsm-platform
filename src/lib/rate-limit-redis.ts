// i18n-ignore-file: rate limiting er driftsdata.
import type { Redis } from "ioredis";
import { getRedisClient } from "@/lib/infra/redis";
import type { RateLimitResult } from "@/lib/rate-limit-db";

const PREFIX = "fsm:ratelimit:";

/**
 * Atomisk teller i Redis. Lua gjør INCR og PEXPIRE til én operasjon, slik at
 * en krasjet prosess ikke kan etterlate en teller uten utløp. Redis brukes når
 * `RATE_LIMIT_DRIVER=redis` (eller `QUEUE_DRIVER=redis` uten egen overstyring).
 */
const WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

export async function allowRequestRedis(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  if (limit <= 0) return { allowed: false, retryAfterSeconds: 0 };
  const client = (await getRedisClient()) as Redis | null;
  if (!client) return null;

  const response = await client.eval(
    WINDOW_SCRIPT,
    1,
    `${PREFIX}${key}`,
    String(Math.max(1, Math.round(windowMs))),
  );
  if (!Array.isArray(response) || response.length < 2) {
    throw new Error("Uventet svar fra Redis rate limit");
  }
  const count = Number(response[0]);
  const ttl = Number(response[1]);
  if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
    throw new Error("Ugyldig svar fra Redis rate limit");
  }

  const allowed = count <= limit;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(0, Math.ceil(Math.max(0, ttl) / 1000)),
  };
}

export async function resetRateLimitRedis(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const client = (await getRedisClient()) as Redis | null;
  if (!client) return;
  await client.del(...keys.map((key) => `${PREFIX}${key}`));
}
