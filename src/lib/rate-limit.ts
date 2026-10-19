/**
 * Enkel innloggingsbegrensning i minnet.
 *
 * Appen kjører som én Node-prosess (Docker), så et in-memory-vindu er nok for å
 * stoppe passordgjetting. Ved flere instanser bør dette flyttes til Redis eller
 * tilsvarende, slik at alle instansene deler telleverket.
 */

const WINDOW_MS = 15 * 60 * 1000; // Teller nullstilles etter 15 minutter.
const BLOCK_MS = 15 * 60 * 1000; // Hvor lenge en nøkkel er sperret.
const MAX_KEYS = 10_000;

type Entry = {
  failures: number;
  firstFailure: number;
  blockedUntil: number;
};

const entries = new Map<string, Entry>();

function prune(now: number) {
  if (entries.size <= MAX_KEYS) return;
  for (const [key, entry] of entries) {
    if (entry.blockedUntil <= now && now - entry.firstFailure > WINDOW_MS) {
      entries.delete(key);
    }
  }
}

/** Er alle nøklene sluppet gjennom, eller er én av dem sperret? */
export function checkLoginRateLimit(keys: string[]): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  let retryAfterSeconds = 0;

  for (const key of keys) {
    const entry = entries.get(key);
    if (entry && entry.blockedUntil > now) {
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        Math.ceil((entry.blockedUntil - now) / 1000),
      );
    }
  }

  return retryAfterSeconds > 0
    ? { allowed: false, retryAfterSeconds }
    : { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Registrerer ett mislykket forsøk. `limit` gjør at e-post og IP kan ha ulike
 * terskler: en enkelt konto sperres raskere enn en delt kontor-IP.
 */
export function recordLoginFailure(key: string, limit: number) {
  const now = Date.now();
  const entry = entries.get(key);

  if (!entry || now - entry.firstFailure > WINDOW_MS || entry.blockedUntil > 0 && entry.blockedUntil <= now) {
    entries.set(key, { failures: 1, firstFailure: now, blockedUntil: 0 });
  } else {
    entry.failures += 1;
    if (entry.failures >= limit) {
      entry.blockedUntil = now + BLOCK_MS;
      entry.failures = 0;
      entry.firstFailure = now;
    }
  }

  prune(now);
}

/** Nullstiller tellingen etter en vellykket innlogging. */
export function clearLoginFailures(keys: string[]) {
  for (const key of keys) entries.delete(key);
}

/** Bare for tester. */
export function resetLoginRateLimit() {
  entries.clear();
}
