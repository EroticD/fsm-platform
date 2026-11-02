/**
 * Kryptografi for offline-kladder.
 *
 * Kladder og outbox-oppføringer lagres kryptert med AES-GCM i IndexedDB. Den
 * symmetriske nøkkelen finnes bare i minnet mens brukeren har låst opp med
 * PIN-koden sin. Nøkkelen pakkes inn (wrappes) med en PBKDF2-avledet nøkkel og
 * lagres i localStorage sammen med salt og iterations. Den rå nøkkelen lagres
 * aldri, og ciphertexten kan derfor ikke leses etter omstart eller ved at noen
 * åpner IndexedDB direkte.
 *
 * Modulen er bevisst uten React-avhengigheter og kan testes som ren logikk.
 * Alle funksjoner er trygge no-ops/feil med tydelige feiltyper når WebCrypto
 * eller localStorage ikke er tilgjengelig (privat modus, gamle nettlesere).
 */

/** Versjon på nøkkelposten i localStorage. */
export const OFFLINE_KEY_VERSION = 1;

/** Markør på krypterte IndexedDB-poster. */
export const OFFLINE_ENCRYPTION_VERSION = "aes-gcm-256-v1";

/**
 * PBKDF2-SHA-256-iterasjoner. 600 000 følger OWASP-anbefalingen for
 * passordbaserte nøkler (2023) og koster merkbart lite på en moderne telefon
 * (typisk under ett sekund) mens det gjør offline gjetting av en 6-sifret PIN
 * vesentlig dyrere.
 */
export const PBKDF2_ITERATIONS = 600_000;

/** Minste PIN-lengde. Seks sifre gir 1 000 000 kombinasjoner. */
export const PIN_MIN_LENGTH = 6;

/** Maksimal PIN-lengde, mest for å hindre misbruk av inputfeltet. */
export const PIN_MAX_LENGTH = 12;

/** Antall feilforsøk før PIN-en midlertidig låses. */
export const MAX_PIN_ATTEMPTS = 5;

/** Hvor lenge en PIN er låst etter for mange feilforsøk. */
export const PIN_LOCKOUT_MS = 5 * 60_000;

/**
 * Hvor lenge en opplåst nøkkel lever uten aktivitet. Etter dette må brukeren
 * taste PIN på nytt, også om fanen står åpen.
 */
export const OFFLINE_IDLE_LOCK_MS = 15 * 60_000;

const KEY_STORAGE_PREFIX = "fsm:offline-key:";
const ATTEMPT_STORAGE_PREFIX = "fsm:offline-pin-attempts:";

const KEY_AAD_PREFIX = "fsm-offline-key-v1:";
const PAYLOAD_AAD_PREFIX = "fsm-offline-payload-v1:";

/** Hendelse som varsler UI om at låsetilstanden er endret. */
export const OFFLINE_LOCK_EVENT = "fsm:offline-lock-changed";

/** Hendelse fra skjemaet om at brukeren vil låse opp/sette PIN. */
export const OFFLINE_UNLOCK_REQUEST_EVENT = "fsm:offline-unlock-request";

export type OfflineKeyRecord = {
  version: typeof OFFLINE_KEY_VERSION;
  userId: string;
  /** Base64-kodet salt til PBKDF2. */
  salt: string;
  iterations: number;
  /** Base64-kodet IV for innpakningen av data-nøkkelen. */
  wrapIv: string;
  /** Base64-kodet AES-GCM-ciphertext av den rå data-nøkkelen. */
  wrappedKey: string;
  createdAt: number;
  updatedAt: number;
};

export type OfflineAttemptState = {
  failed: number;
  /** Epoch ms. 0 betyr at PIN-en ikke er låst. */
  lockedUntil: number;
};

export type OfflineSessionInfo = {
  key: CryptoKey;
  rawKey: Uint8Array;
  lastUsedAt: number;
};

export class OfflineLockedError extends Error {
  readonly code = "locked";
  constructor(message = "Offline drafts are locked") {
    super(message);
    this.name = "OfflineLockedError";
  }
}

export class OfflineCryptoUnavailableError extends Error {
  readonly code = "crypto-unavailable";
  constructor(
    message = "WebCrypto or local storage is unavailable",
  ) {
    super(message);
    this.name = "OfflineCryptoUnavailableError";
  }
}

export class OfflineKeyMissingError extends Error {
  readonly code = "key-missing";
  constructor(message = "No PIN found for offline drafts") {
    super(message);
    this.name = "OfflineKeyMissingError";
  }
}

export class OfflineKeyCorruptError extends Error {
  readonly code = "key-corrupt";
  constructor(message = "The PIN key is corrupt or invalid") {
    super(message);
    this.name = "OfflineKeyCorruptError";
  }
}

export class OfflinePinError extends Error {
  readonly code: "wrong-pin" | "locked";
  readonly remainingAttempts: number;
  readonly lockedUntil: number;
  constructor(
    code: "wrong-pin" | "locked",
    options: { remainingAttempts: number; lockedUntil?: number },
  ) {
    super(code === "wrong-pin" ? "Wrong PIN" : "PIN temporarily locked");
    this.name = "OfflinePinError";
    this.code = code;
    this.remainingAttempts = options.remainingAttempts;
    this.lockedUntil = options.lockedUntil ?? 0;
  }
}

export class OfflineTamperError extends Error {
  readonly code = "tamper";
  constructor(message = "Could not decrypt draft: data has been modified") {
    super(message);
    this.name = "OfflineTamperError";
  }
}

export function isOfflineLockedError(error: unknown): error is OfflineLockedError {
  return error instanceof OfflineLockedError;
}

export function isOfflineTamperError(error: unknown): error is OfflineTamperError {
  return error instanceof OfflineTamperError;
}

export function isOfflinePinError(error: unknown): error is OfflinePinError {
  return error instanceof OfflinePinError;
}

/* -------------------------------------------------------------------------
 * Base64 og tilfeldige bytes
 * ---------------------------------------------------------------------- */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  webCrypto().getRandomValues(bytes);
  return bytes;
}

function webCrypto(): Crypto {
  const value = globalThis.crypto;
  if (!value || !value.subtle) {
    throw new OfflineCryptoUnavailableError();
  }
  return value;
}

function encoder(): TextEncoder {
  return new TextEncoder();
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function requireStorage(): Storage {
  const value = storage();
  if (!value) throw new OfflineCryptoUnavailableError();
  return value;
}

/* -------------------------------------------------------------------------
 * PIN-validering
 * ---------------------------------------------------------------------- */

export type PinValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "empty" | "too-short" | "too-long" | "not-digits" | "mismatch";
    };

export function validateOfflinePin(pin: string): PinValidation {
  if (!pin) return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(pin)) return { ok: false, reason: "not-digits" };
  if (pin.length < PIN_MIN_LENGTH) return { ok: false, reason: "too-short" };
  if (pin.length > PIN_MAX_LENGTH) return { ok: false, reason: "too-long" };
  return { ok: true };
}

/* -------------------------------------------------------------------------
 * Nøkkelpost i localStorage
 * ---------------------------------------------------------------------- */

export function offlineKeyStorageKey(userId: string): string {
  return `${KEY_STORAGE_PREFIX}${userId}`;
}

function attemptStorageKey(userId: string): string {
  return `${ATTEMPT_STORAGE_PREFIX}${userId}`;
}

export function hasOfflineKey(userId: string): boolean {
  if (!userId) return false;
  try {
    return requireStorage().getItem(offlineKeyStorageKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function readOfflineKeyRecord(
  userId: string,
): OfflineKeyRecord | null {
  const raw = requireStorage().getItem(offlineKeyStorageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineKeyRecord>;
    if (
      parsed.version !== OFFLINE_KEY_VERSION ||
      parsed.userId !== userId ||
      typeof parsed.salt !== "string" ||
      typeof parsed.iterations !== "number" ||
      !Number.isFinite(parsed.iterations) ||
      parsed.iterations < 1 ||
      parsed.iterations > 10_000_000 ||
      typeof parsed.wrapIv !== "string" ||
      typeof parsed.wrappedKey !== "string"
    ) {
      throw new OfflineKeyCorruptError();
    }
    return {
      version: OFFLINE_KEY_VERSION,
      userId,
      salt: parsed.salt,
      iterations: Math.floor(parsed.iterations),
      wrapIv: parsed.wrapIv,
      wrappedKey: parsed.wrappedKey,
      createdAt:
        typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch (error) {
    if (error instanceof OfflineKeyCorruptError) throw error;
    throw new OfflineKeyCorruptError();
  }
}

function writeOfflineKeyRecord(record: OfflineKeyRecord): void {
  requireStorage().setItem(
    offlineKeyStorageKey(record.userId),
    JSON.stringify(record),
  );
}

/** Fjerner nøkkelposten. Selve ciphertexten røres ikke. */
export function removeOfflineKey(userId: string): void {
  try {
    const target = storage();
    target?.removeItem(offlineKeyStorageKey(userId));
    target?.removeItem(attemptStorageKey(userId));
  } catch {
    // Uten localStorage finnes ingen nøkkel å fjerne.
  }
  lockOfflineSession(userId);
  emitLockChange();
}

/* -------------------------------------------------------------------------
 * Forsøksgrense og utlåsing
 * ---------------------------------------------------------------------- */

/**
 * Normaliserer en lagret forsøkstilstand: en utløpt låseperiode starter med
 * blanke ark, slik at brukeren får nye forsøk etter at tiden er ute.
 */
export function normalizeAttemptState(
  state: OfflineAttemptState,
  now = Date.now(),
): OfflineAttemptState {
  if (state.lockedUntil > 0 && now >= state.lockedUntil) {
    return { failed: 0, lockedUntil: 0 };
  }
  return {
    failed: Number.isFinite(state.failed) ? Math.max(0, state.failed) : 0,
    lockedUntil:
      Number.isFinite(state.lockedUntil) && state.lockedUntil > now
        ? state.lockedUntil
        : 0,
  };
}

export function readAttemptState(
  userId: string,
  now = Date.now(),
): OfflineAttemptState {
  try {
    const raw = requireStorage().getItem(attemptStorageKey(userId));
    if (!raw) return { failed: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<OfflineAttemptState>;
    return normalizeAttemptState(
      {
        failed:
          typeof parsed.failed === "number" ? parsed.failed : 0,
        lockedUntil:
          typeof parsed.lockedUntil === "number"
            ? parsed.lockedUntil
            : 0,
      },
      now,
    );
  } catch {
    // En korrupt teller skal ikke låse brukeren ute permanent.
    return { failed: 0, lockedUntil: 0 };
  }
}

function writeAttemptState(userId: string, state: OfflineAttemptState): void {
  try {
    requireStorage().setItem(
      attemptStorageKey(userId),
      JSON.stringify(state),
    );
  } catch {
    // Uten lagring håndheves grensen bare i denne økten.
  }
}

/**
 * Regner ut neste tilstand etter ett feilforsøk. Ved taket nullstilles telleren
 * og PIN-en låses i `PIN_LOCKOUT_MS`, slik at en ny periode med forsøk starter
 * når låsen utløper.
 */
export function nextAttemptState(
  state: OfflineAttemptState,
  now = Date.now(),
): OfflineAttemptState {
  const current = normalizeAttemptState(state, now);
  if (current.lockedUntil > now) return current;
  const failed = current.failed + 1;
  if (failed >= MAX_PIN_ATTEMPTS) {
    return { failed: 0, lockedUntil: now + PIN_LOCKOUT_MS };
  }
  return { failed, lockedUntil: 0 };
}

export function remainingPinAttempts(
  state: OfflineAttemptState,
  now = Date.now(),
): number {
  const current = normalizeAttemptState(state, now);
  if (current.lockedUntil > now) return 0;
  return Math.max(0, MAX_PIN_ATTEMPTS - current.failed);
}

function clearAttemptState(userId: string): void {
  try {
    storage()?.removeItem(attemptStorageKey(userId));
  } catch {
    // Ignorer lagringsfeil.
  }
}

/* -------------------------------------------------------------------------
 * Nøkkelavledning og innpakning
 * ---------------------------------------------------------------------- */

async function derivePinKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const crypto = webCrypto();
  const material = await crypto.subtle.importKey(
    "raw",
    encoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importDataKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return webCrypto().subtle.importKey(
    "raw",
    rawKey as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrapDataKey(options: {
  userId: string;
  pin: string;
  salt: Uint8Array;
  iterations: number;
  rawKey: Uint8Array;
}): Promise<{ wrapIv: string; wrappedKey: string }> {
  const crypto = webCrypto();
  const kek = await derivePinKey(
    options.pin,
    options.salt,
    options.iterations,
  );
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: encoder().encode(
        `${KEY_AAD_PREFIX}${options.userId}`,
      ),
    },
    kek,
    options.rawKey as BufferSource,
  );
  return {
    wrapIv: bytesToBase64(iv),
    wrappedKey: bytesToBase64(new Uint8Array(wrapped)),
  };
}

async function unwrapDataKey(options: {
  userId: string;
  pin: string;
  salt: Uint8Array;
  iterations: number;
  wrapIv: Uint8Array;
  wrappedKey: Uint8Array;
}): Promise<Uint8Array> {
  const crypto = webCrypto();
  const kek = await derivePinKey(
    options.pin,
    options.salt,
    options.iterations,
  );
  const raw = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: options.wrapIv as BufferSource,
      additionalData: encoder().encode(
        `${KEY_AAD_PREFIX}${options.userId}`,
      ),
    },
    kek,
    options.wrappedKey as BufferSource,
  );
  return new Uint8Array(raw);
}

/* -------------------------------------------------------------------------
 * Øktsnøkkel i minnet
 * ---------------------------------------------------------------------- */

const sessions = new Map<string, OfflineSessionInfo>();
const lockListeners = new Set<() => void>();

function emitLockChange(): void {
  for (const listener of lockListeners) {
    try {
      listener();
    } catch {
      // En dårlig lytter skal ikke hindre de andre.
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event(OFFLINE_LOCK_EVENT));
    } catch {
      // Uten Event-støtte er det ingenting å varsle.
    }
  }
}

export function subscribeOfflineLock(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

function wipeSession(session: OfflineSessionInfo): void {
  // Den rå nøkkelen finnes bare for å kunne pakke den inn på nytt ved PIN-bytte.
  // Ved låsing overskrives bytesene, så en heap-dump ikke uten videre får den.
  session.rawKey.fill(0);
}

function expireIdleSession(userId: string, now: number): boolean {
  const session = sessions.get(userId);
  if (!session) return false;
  if (now - session.lastUsedAt <= OFFLINE_IDLE_LOCK_MS) return false;
  wipeSession(session);
  sessions.delete(userId);
  emitLockChange();
  return true;
}

/** Er nøkkelen låst opp akkurat nå (og ikke utløpt av inaktivitet)? */
export function isOfflineUnlocked(
  userId: string,
  now = Date.now(),
): boolean {
  if (!sessions.has(userId)) return false;
  if (expireIdleSession(userId, now)) return false;
  return true;
}

/** Oppdaterer siste aktivitet, slik at inaktivitetstimeren starter på nytt. */
export function touchOfflineSession(userId: string, now = Date.now()): void {
  const session = sessions.get(userId);
  if (session) session.lastUsedAt = now;
}

function sessionKey(userId: string): OfflineSessionInfo {
  expireIdleSession(userId, Date.now());
  const session = sessions.get(userId);
  if (!session) throw new OfflineLockedError();
  session.lastUsedAt = Date.now();
  return session;
}

/** Låser én brukers nøkkel. Ciphertexten blir liggende. */
export function lockOfflineSession(userId: string): void {
  const session = sessions.get(userId);
  if (!session) return;
  wipeSession(session);
  sessions.delete(userId);
  emitLockChange();
}

/** Låser alle nøkler, f.eks. ved utlogging eller utløpt økt. */
export function lockAllOfflineSessions(): void {
  if (sessions.size === 0) return;
  for (const session of sessions.values()) wipeSession(session);
  sessions.clear();
  emitLockChange();
}

/* -------------------------------------------------------------------------
 * Oppsett, opplåsing og PIN-bytte
 * ---------------------------------------------------------------------- */

export type OfflineKeyOptions = {
  /**
   * Overstyr PBKDF2-iterasjoner. Bare for tester; produksjonskall skal bruke
   * standardverdien.
   * @internal
   */
  iterations?: number;
};

function resolvedIterations(options?: OfflineKeyOptions): number {
  const value = options?.iterations;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1
  ) {
    return Math.floor(value);
  }
  return PBKDF2_ITERATIONS;
}

function setUnlockedSession(
  userId: string,
  key: CryptoKey,
  rawKey: Uint8Array,
  now = Date.now(),
): void {
  const previous = sessions.get(userId);
  if (previous) wipeSession(previous);
  sessions.set(userId, {
    key,
    rawKey: new Uint8Array(rawKey),
    lastUsedAt: now,
  });
  emitLockChange();
}

/**
 * Oppretter en ny data-nøkkel, pakker den inn med PIN og lagrer bare den
 * innpakkede nøkkelen. Nekter å overskrive en eksisterende nøkkel, slik at
 * eksisterende ciphertext ikke blir ulåsbar ved et uhell.
 */
export async function createOfflineKey(
  userId: string,
  pin: string,
  options?: OfflineKeyOptions,
): Promise<void> {
  if (!userId) throw new Error("Missing user for offline key");
  const validation = validateOfflinePin(pin);
  if (!validation.ok) throw validation;
  requireStorage();
  webCrypto();
  // En ny nøkkel ville gjort eksisterende ciphertext ulåsbar. Bytte av PIN skal
  // gå gjennom `changeOfflinePin`, og forkasting gjennom eksplisitt sletting.
  if (hasOfflineKey(userId)) {
    throw new Error("An offline key already exists for this user");
  }

  const iterations = resolvedIterations(options);
  const salt = randomBytes(16);
  const rawKey = randomBytes(32);
  const wrapped = await wrapDataKey({
    userId,
    pin,
    salt,
    iterations,
    rawKey,
  });
  const now = Date.now();
  writeOfflineKeyRecord({
    version: OFFLINE_KEY_VERSION,
    userId,
    salt: bytesToBase64(salt),
    iterations,
    wrapIv: wrapped.wrapIv,
    wrappedKey: wrapped.wrappedKey,
    createdAt: now,
    updatedAt: now,
  });
  clearAttemptState(userId);
  const key = await importDataKey(rawKey);
  setUnlockedSession(userId, key, rawKey, now);
}

/**
 * Låser opp med PIN. Feil PIN telles, og etter `MAX_PIN_ATTEMPTS` låses
 * forsøkene i `PIN_LOCKOUT_MS`. Returnerer `lockedUntil` via `OfflinePinError`.
 */
export async function unlockOfflineKey(
  userId: string,
  pin: string,
  now = Date.now(),
): Promise<void> {
  const record = readOfflineKeyRecord(userId);
  if (!record) throw new OfflineKeyMissingError();

  let state = readAttemptState(userId, now);
  if (state.lockedUntil > now) {
    throw new OfflinePinError("locked", {
      remainingAttempts: 0,
      lockedUntil: state.lockedUntil,
    });
  }

  try {
    const rawKey = await unwrapDataKey({
      userId,
      pin,
      salt: base64ToBytes(record.salt),
      iterations: record.iterations,
      wrapIv: base64ToBytes(record.wrapIv),
      wrappedKey: base64ToBytes(record.wrappedKey),
    });
    const key = await importDataKey(rawKey);
    clearAttemptState(userId);
    setUnlockedSession(userId, key, rawKey, now);
  } catch {
    state = nextAttemptState(state, now);
    writeAttemptState(userId, state);
    if (state.lockedUntil > now) {
      throw new OfflinePinError("locked", {
        remainingAttempts: 0,
        lockedUntil: state.lockedUntil,
      });
    }
    throw new OfflinePinError("wrong-pin", {
      remainingAttempts: remainingPinAttempts(state, now),
    });
  }
}

/**
 * Bytter PIN uten å generere ny data-nøkkel. Krever at gjeldende PIN er riktig;
 * en feil telles på samme måte som ved opplåsing.
 */
export async function changeOfflinePin(
  userId: string,
  currentPin: string,
  newPin: string,
  now = Date.now(),
): Promise<void> {
  const validation = validateOfflinePin(newPin);
  if (!validation.ok) throw validation;

  await unlockOfflineKey(userId, currentPin, now);
  const session = sessions.get(userId);
  const record = readOfflineKeyRecord(userId);
  if (!session || !record) throw new OfflineKeyMissingError();

  const iterations = record.iterations;
  const salt = randomBytes(16);
  const wrapped = await wrapDataKey({
    userId,
    pin: newPin,
    salt,
    iterations,
    rawKey: session.rawKey,
  });
  writeOfflineKeyRecord({
    ...record,
    salt: bytesToBase64(salt),
    wrapIv: wrapped.wrapIv,
    wrappedKey: wrapped.wrappedKey,
    updatedAt: Date.now(),
  });
  clearAttemptState(userId);
  session.lastUsedAt = now;
  emitLockChange();
}

/* -------------------------------------------------------------------------
 * Kryptering av payload
 * ---------------------------------------------------------------------- */

export type SealedPayload = {
  /** Marker som skiller krypterte poster fra eldre klartekstposter. */
  enc: typeof OFFLINE_ENCRYPTION_VERSION;
  iv: string;
  payload: string;
};

/** Krypterer én payload. AAD binder dataene til bruker og postens identitet. */
export async function encryptOfflinePayload(
  userId: string,
  aad: string,
  plaintext: string,
): Promise<SealedPayload> {
  const crypto = webCrypto();
  const session = sessionKey(userId);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: encoder().encode(`${PAYLOAD_AAD_PREFIX}${aad}`),
    },
    session.key,
    encoder().encode(plaintext),
  );
  return {
    enc: OFFLINE_ENCRYPTION_VERSION,
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/** Dekrypterer én payload. Feil nøkkel, IV eller AAD gir `OfflineTamperError`. */
export async function decryptOfflinePayload(
  userId: string,
  aad: string,
  sealed: Pick<SealedPayload, "iv" | "payload">,
): Promise<string> {
  const crypto = webCrypto();
  const session = sessionKey(userId);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(sealed.iv) as BufferSource,
        additionalData: encoder().encode(`${PAYLOAD_AAD_PREFIX}${aad}`),
      },
      session.key,
      base64ToBytes(sealed.payload) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new OfflineTamperError();
  }
}

/** Er en rå IndexedDB-post kryptert av denne versjonen? */
export function isSealedRecord(record: {
  enc?: unknown;
  iv?: unknown;
  payload?: unknown;
}): record is { enc: string; iv: string; payload: string } {
  return (
    record.enc === OFFLINE_ENCRYPTION_VERSION &&
    typeof record.iv === "string" &&
    typeof record.payload === "string"
  );
}
