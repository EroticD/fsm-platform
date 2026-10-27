/**
 * Prosesslokal, minimal rate limiter for uautentiserte helse- og
 * sanntidskall. Den er ikke en sikkerhetsgrense på tvers av instanser – den
 * finnes bare for å hindre at én klient tvinger frem dyrt arbeid (diskkall,
 * databaseoppslag) på hver forespørsel. Distribuerte grenser ligger i
 * `rate-limit-db.ts`.
 */

export type MemoryLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

const globalForLimits = globalThis as typeof globalThis & {
  __fsmMemoryLimits?: Map<string, Bucket>;
  __fsmMemoryLimitOps?: number;
};

function store(): Map<string, Bucket> {
  if (!globalForLimits.__fsmMemoryLimits) {
    globalForLimits.__fsmMemoryLimits = new Map();
  }
  return globalForLimits.__fsmMemoryLimits;
}

function maybeCleanup(state: Map<string, Bucket>, now: number) {
  const operations = (globalForLimits.__fsmMemoryLimitOps ?? 0) + 1;
  globalForLimits.__fsmMemoryLimitOps = operations;
  if (operations % 500 !== 0) return;
  for (const [key, bucket] of state) {
    if (bucket.resetAt <= now) state.delete(key);
  }
}

export function allowRequestMemory(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): MemoryLimitResult {
  if (limit <= 0) return { allowed: false, retryAfterSeconds: 0 };

  const state = store();
  maybeCleanup(state, now);

  const bucket = state.get(key);
  if (!bucket || bucket.resetAt <= now) {
    state.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Bare for tester. */
export function resetMemoryLimitsForTests(): void {
  store().clear();
  globalForLimits.__fsmMemoryLimitOps = 0;
}
