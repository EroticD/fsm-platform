/**
 * Orkestrering av PIN-låsen rundt offline-kladdene.
 *
 * `crypto.ts` eier nøkler og kryptering, `db.ts` eier IndexedDB. Denne modulen
 * binder dem sammen slik at UI-et slipper å kjenne rekkefølgen: etter oppsett
 * eller opplåsing må eventuelle gamle klartekstkladder migreres før de kan
 * listes. Ingen rå nøkkel eller klartekst forlater funksjonene her.
 */
import {
  changeOfflinePin,
  createOfflineKey,
  hasOfflineKey,
  isOfflineUnlocked,
  lockAllOfflineSessions,
  OFFLINE_UNLOCK_REQUEST_EVENT,
  OfflineCryptoUnavailableError,
  removeOfflineKey,
  unlockOfflineKey,
  validateOfflinePin,
  type PinValidation,
} from "./crypto";
import {
  clearOfflineDataForUser,
  discardPlaintextOfflineDataForUser,
  inspectOfflineStorage,
  migrateOfflineDataForUser,
  type OfflineMigrationResult,
} from "./db";

export {
  OFFLINE_IDLE_LOCK_MS,
  OFFLINE_LOCK_EVENT,
  OFFLINE_UNLOCK_REQUEST_EVENT,
  PIN_MIN_LENGTH,
  isOfflineLockedError,
  isOfflinePinError,
  isOfflineTamperError,
  lockAllOfflineSessions,
  lockOfflineSession,
  OfflineLockedError,
  OfflinePinError,
  type PinValidation,
} from "./crypto";

export type OfflineLockStatus = {
  /** WebCrypto og localStorage er tilgjengelig. */
  supported: boolean;
  /** En innpakket nøkkel finnes for brukeren. */
  hasKey: boolean;
  /** Nøkkelen er låst opp i denne faneøkten. */
  unlocked: boolean;
  drafts: number;
  outbox: number;
  /** Klartekstposter fra før kryptering ble innført. */
  plaintext: number;
};

export function offlineCryptoSupported(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      Boolean(globalThis.crypto?.subtle)
    );
  } catch {
    return false;
  }
}

/**
 * Leser låsetilstanden uten å kreve opplåst nøkkel. Når nøkkelen er opplåst,
 * migreres eventuelle klartekstposter automatisk (idempotent).
 */
export async function getOfflineLockStatus(
  userId: string,
): Promise<OfflineLockStatus> {
  const supported = offlineCryptoSupported();
  const hasKey = supported && hasOfflineKey(userId);
  const unlocked = hasKey && isOfflineUnlocked(userId);

  if (unlocked) {
    try {
      await migrateOfflineDataForUser(userId);
    } catch {
      // Migrering feiler bare dersom nøkkelen ble låst mellom sjekkene. Da
      // viser UI-et låst tilstand og brukeren kan prøve igjen.
    }
  }

  let inspection = {
    drafts: 0,
    outbox: 0,
    plaintextDrafts: 0,
    plaintextOutbox: 0,
  };
  try {
    inspection = await inspectOfflineStorage(userId);
  } catch {
    // IndexedDB utilgjengelig: behold nulltellingene.
  }

  return {
    supported,
    hasKey: supported && hasOfflineKey(userId),
    unlocked: supported && hasOfflineKey(userId) && isOfflineUnlocked(userId),
    drafts: inspection.drafts,
    outbox: inspection.outbox,
    plaintext: inspection.plaintextDrafts + inspection.plaintextOutbox,
  };
}

export function validateNewPin(pin: string, confirmation: string): PinValidation {
  const validation = validateOfflinePin(pin);
  if (!validation.ok) return validation;
  if (pin !== confirmation) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/** Setter PIN for første gang og krypterer eksisterende klartekstkladder. */
export async function setupOfflinePin(
  userId: string,
  pin: string,
): Promise<OfflineMigrationResult> {
  if (!offlineCryptoSupported()) throw new OfflineCryptoUnavailableError();
  await createOfflineKey(userId, pin);
  return migrateOfflineDataForUser(userId);
}

/** Låser opp og migrerer klartekstkladder som måtte finnes. */
export async function unlockOfflineDrafts(
  userId: string,
  pin: string,
): Promise<OfflineMigrationResult> {
  if (!offlineCryptoSupported()) throw new OfflineCryptoUnavailableError();
  await unlockOfflineKey(userId, pin);
  return migrateOfflineDataForUser(userId);
}

export async function changeOfflinePinForUser(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<void> {
  if (!offlineCryptoSupported()) throw new OfflineCryptoUnavailableError();
  await changeOfflinePin(userId, currentPin, newPin);
}

/** Forkaster alle poster for brukeren og fjerner den innpakkede nøkkelen. */
export async function discardOfflineDraftsAndKey(
  userId: string,
): Promise<void> {
  await clearOfflineDataForUser(userId);
  removeOfflineKey(userId);
}

/** Forkaster bare gamle klartekstposter, etter eksplisitt bekreftelse. */
export async function discardLegacyOfflineDrafts(
  userId: string,
): Promise<void> {
  await discardPlaintextOfflineDataForUser(userId);
}

/** Låser alle nøkler, f.eks. ved utlogging eller utløpt økt. */
export function lockOfflineDrafts(): void {
  lockAllOfflineSessions();
}

/** Ber det globale PIN-panelet om å åpne seg. */
export function requestOfflineUnlock(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(OFFLINE_UNLOCK_REQUEST_EVENT));
  } catch {
    // Uten Event-støtte er det ingenting å varsle.
  }
}
