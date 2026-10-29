/**
 * Minimal IndexedDB-wrapper for offline kladder og outbox.
 *
 * Brukes bare i nettleseren. Alle funksjoner er no-op når IndexedDB ikke er
 * tilgjengelig (eldre nettlesere, private modus), slik at appen fortsatt
 * fungerer uten offline-lagring.
 */
import {
  isAttemptLimitReached,
  isOutboxTerminal,
  isPayloadWithinLimit,
  itemReportIdentity,
  payloadReportIdentity,
  retryDelayMs,
  sameReport,
  sortOutboxOldestFirst,
  type ReportIdentity,
} from "./outbox-order";

const DB_NAME = "fsm-offline";
const DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const OUTBOX_STORE = "outbox";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OFFLINE_DRAFT_MAX_AGE_DAYS = 7;

/**
 * Standard maksimal alder for lokale rapportkladder.
 *
 * En kladd som har ligget urørt lenger enn dette, kan mangle endringer som er
 * gjort på serveren og skal ikke sendes automatisk. Den ryddes derfor bort når
 * den leses eller listes. En eventuell outbox-oppføring for samme rapport
 * beholdes, men markeres som feilet med `EXPIRED_DRAFT_FAILURE_REASON`, slik
 * at brukeren kan velge å prøve igjen eller forkaste den bevisst.
 *
 * Kan overstyres med `NEXT_PUBLIC_OFFLINE_DRAFT_MAX_AGE_DAYS` ved bygg fordi
 * verdien brukes i nettleseren.
 */
export const OFFLINE_DRAFT_MAX_AGE_DAYS = (() => {
  const configured = Number(
    process.env.NEXT_PUBLIC_OFFLINE_DRAFT_MAX_AGE_DAYS,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_OFFLINE_DRAFT_MAX_AGE_DAYS;
})();

export const OFFLINE_DRAFT_MAX_AGE_MS =
  OFFLINE_DRAFT_MAX_AGE_DAYS * DAY_MS;

/** Årsakskode for outbox-oppføringer som mistet sin lokale kladd til utløp. */
export const EXPIRED_DRAFT_FAILURE_REASON = "draft-expired";

/**
 * Er kladden eldre enn maksimal alder? Grensen er inklusiv: en kladd som er
 * nøyaktig `OFFLINE_DRAFT_MAX_AGE_MS` gammel, regnes fortsatt som fersk.
 * Manglende eller ugyldig tidsstempel regnes som utløpt, mens et tidspunkt i
 * fremtiden beholdes (klokkejustering skal ikke slette brukerens arbeid).
 */
export function isOfflineDraftExpired(
  updatedAt: number,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || !Number.isFinite(now)) {
    return true;
  }
  return now - updatedAt > OFFLINE_DRAFT_MAX_AGE_MS;
}

export type OfflineDraft = {
  key: string;
  userId: string;
  workOrderId: string;
  templateId: string;
  payload: string;
  updatedAt: number;
  /**
   * Tidspunktet kladden sist ble bekreftet lagret på serveren (eller sendt via
   * outboxen). En kladd regnes som ventende når `updatedAt > syncedAt`.
   */
  syncedAt?: number;
  /** Satt når kladden aldri kan sendes automatisk, f.eks. for stor payload. */
  syncError?: "payload-too-large";
};

export type OutboxItem = {
  id: string;
  /** Eieren av kladden. Outboxen skal aldri sendes på vegne av en annen bruker. */
  userId: string;
  payload: string;
  createdAt: number;
  attempts: number;
  /** Satt på nye oppføringer, så lik rapports kladd kan slås sammen uten parsing. */
  workOrderId?: string;
  templateId?: string;
  /** Tidspunkt for neste lovlige forsøk (epoch ms). */
  nextAttemptAt?: number;
  /** Satt når oppføringen har gitt opp; den sendes ikke automatisk igjen. */
  failedAt?: number;
  /** Kort årsakskode, f.eks. «payload-too-large» eller «http-500». */
  failureReason?: string;
};

export type EnqueueResult = "queued" | "too-large" | "unavailable";

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  if (!hasIndexedDb()) return null;
  const db = await openDb();
  try {
    const transaction = db.transaction(storeName, mode);
    const result = await action(transaction.objectStore(storeName));
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

/** Sletter én bestemt rapports outbox-oppføringer for en bruker. */
async function deleteOutboxForReport(
  store: IDBObjectStore,
  userId: string,
  identity: ReportIdentity | null,
): Promise<void> {
  if (!identity) return;
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const existing = cursor.value as OutboxItem;
      const existingIdentity = itemReportIdentity(existing);
      if (
        existing.userId === userId &&
        existingIdentity &&
        sameReport(existingIdentity, identity)
      ) {
        cursor.delete();
      }
      cursor.continue();
    };
  });
}

export async function putOfflineDraft(draft: OfflineDraft): Promise<void> {
  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    store.put(draft);
    return undefined;
  });
}

/** Sletter flere kladder i én transaksjon. */
async function deleteDrafts(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    for (const key of keys) store.delete(key);
    return undefined;
  });
}

/**
 * Markerer ventende outbox-oppføringer for en utløpt kladd som terminale.
 * Selve oppføringen slettes ikke: payloaden er brukerens eneste kopi når den
 * lokale kladden er ryddet, og skal kunne forsøkes eller forkastes bevisst.
 */
async function markOutboxExpiredForDraft(draft: OfflineDraft): Promise<void> {
  const identity: ReportIdentity = {
    workOrderId: draft.workOrderId,
    templateId: draft.templateId,
  };
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    const items =
      (await requestResult<OutboxItem[]>(store.getAll())) ?? [];
    const failedAt = Date.now();
    for (const item of items) {
      if (item.userId !== draft.userId || isOutboxTerminal(item)) continue;
      const itemIdentity = itemReportIdentity(item);
      if (!itemIdentity || !sameReport(itemIdentity, identity)) continue;
      store.put({
        ...item,
        failedAt,
        failureReason: EXPIRED_DRAFT_FAILURE_REASON,
        nextAttemptAt: 0,
      });
    }
    return undefined;
  });
}

/**
 * Rydder utløpte kladder og sørger for at en eventuell outbox-oppføring
 * fortsatt er synlig som feilet. Outboxen markeres før kladden slettes, slik
 * at et avbrutt ryddeforsøk ikke kan etterlate en automatisk sendbar gammel
 * payload uten lokal kladd.
 */
async function expireDrafts(drafts: OfflineDraft[]): Promise<void> {
  if (drafts.length === 0) return;
  for (const draft of drafts) {
    await markOutboxExpiredForDraft(draft);
  }
  await deleteDrafts(drafts.map((draft) => draft.key));
}

export async function getOfflineDraft(
  key: string,
  now = Date.now(),
): Promise<OfflineDraft | null> {
  const result = await withStore(DRAFT_STORE, "readonly", async (store) =>
    requestResult<OfflineDraft | undefined>(store.get(key)),
  );
  const draft = result ?? null;
  if (!draft) return null;
  if (!isOfflineDraftExpired(draft.updatedAt, now)) return draft;
  await expireDrafts([draft]);
  return null;
}

export async function deleteOfflineDraft(key: string): Promise<void> {
  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    store.delete(key);
    return undefined;
  });
}

export async function listDraftsForUser(
  userId: string,
  now = Date.now(),
): Promise<OfflineDraft[]> {
  const result = await withStore(DRAFT_STORE, "readonly", async (store) =>
    requestResult<OfflineDraft[]>(store.getAll()),
  );
  const drafts = (result ?? []).filter((draft) => draft.userId === userId);
  const fresh = drafts.filter(
    (draft) => !isOfflineDraftExpired(draft.updatedAt, now),
  );
  const expired = drafts.filter((draft) =>
    isOfflineDraftExpired(draft.updatedAt, now),
  );
  await expireDrafts(expired);
  return fresh;
}

/**
 * Legger en kladd i outboxen. Det finnes bare én ventende oppføring per
 * bruker+oppdrag+mal: en nyere kladd erstatter den eldre i samme transaksjon.
 * `createdAt` gjøres strengt stigende, slik at «nyeste vinner» også når to
 * lagringer skjer i samme millisekund.
 *
 * Payload over rutenes grense legges aldri i køen. En eventuell eldre kladd for
 * samme rapport fjernes, slik at den ikke senere replayer over en nyere lokal
 * kladd. Returverdien lar kalleren markere kladden som «kan ikke sendes».
 */
export async function enqueueOutbox(
  payload: string,
  userId: string,
): Promise<EnqueueResult> {
  const identity = payloadReportIdentity(payload);

  if (!isPayloadWithinLimit(payload)) {
    if (identity) {
      await withStore(OUTBOX_STORE, "readwrite", async (store) => {
        await deleteOutboxForReport(store, userId, identity);
        return undefined;
      });
    }
    return "too-large";
  }

  const item: OutboxItem = {
    id: crypto.randomUUID(),
    userId,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    ...(identity ?? {}),
  };
  const result = await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    let newest = 0;
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const existing = cursor.value as OutboxItem;
        if (existing.createdAt > newest) newest = existing.createdAt;
        const existingIdentity = itemReportIdentity(existing);
        if (
          identity &&
          existing.userId === userId &&
          existingIdentity &&
          sameReport(existingIdentity, identity)
        ) {
          cursor.delete();
        }
        cursor.continue();
      };
    });

    item.createdAt = Math.max(item.createdAt, newest + 1);
    store.put(item);
    return undefined;
  });

  return result === null ? "unavailable" : "queued";
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const result = await withStore(OUTBOX_STORE, "readonly", async (store) =>
    requestResult<OutboxItem[]>(store.getAll()),
  );
  // IndexedDB sorterer etter primærnøkkel (tilfeldig UUID). Selve outboxen må
  // sendes i kronologisk rekkefølge, ellers kan en eldre kladd vinne.
  return sortOutboxOldestFirst(result ?? []);
}

export async function listOutboxForUser(userId: string): Promise<OutboxItem[]> {
  const items = await listOutbox();
  return items.filter((item) => item.userId === userId);
}

export async function countOutboxForUser(userId: string): Promise<number> {
  const items = await listOutboxForUser(userId);
  return items.length;
}

export async function removeOutbox(id: string): Promise<void> {
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    store.delete(id);
    return undefined;
  });
}

/**
 * Oppdaterer en eksisterende outbox-oppføring uten å gjenopplive en som er
 * erstattet av en nyere kladd. `attempts`-sjekken hindrer at en sen,
 * overlappende flush skriver over en nyere tilstand.
 */
async function updateOutboxItem(
  item: OutboxItem,
  update: (current: OutboxItem) => OutboxItem,
): Promise<void> {
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    const current = await requestResult<OutboxItem | undefined>(
      store.get(item.id),
    );
    if (!current || current.attempts !== item.attempts) return undefined;
    store.put(update(current));
    return undefined;
  });
}

/**
 * Registrerer et mislykket forsøk. Terminal feil (413/400) eller utbrukt
 * forsøksbudsjett setter `failedAt`, slik at oppføringen kan vises som «kunne
 * ikke sendes» i stedet for å prøves i det uendelige.
 */
export async function recordOutboxFailure(
  item: OutboxItem,
  options: { terminal?: boolean; reason?: string } = {},
): Promise<void> {
  const attempts = item.attempts + 1;
  const terminal =
    options.terminal === true || isAttemptLimitReached(attempts);
  await updateOutboxItem(item, (current) => ({
    ...current,
    attempts,
    ...(terminal
      ? {
          failedAt: Date.now(),
          failureReason: options.reason ?? "attempts-exhausted",
          nextAttemptAt: 0,
        }
      : { nextAttemptAt: Date.now() + retryDelayMs(attempts) }),
  }));
}

/**
 * Nullstiller terminale oppføringer for brukeren, slik at «Prøv igjen» faktisk
 * gjør et nytt forsøk. Backoff og forsøksbudsjett starter på nytt.
 */
export async function resetFailedOutbox(userId: string): Promise<number> {
  if (!hasIndexedDb()) return 0;
  const result = await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    let reset = 0;
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const item = cursor.value as OutboxItem;
        if (
          item.userId === userId &&
          (item.failedAt || isAttemptLimitReached(item.attempts))
        ) {
          const next: OutboxItem = {
            ...item,
            attempts: 0,
            nextAttemptAt: 0,
          };
          delete next.failedAt;
          delete next.failureReason;
          cursor.update(next);
          reset += 1;
        }
        cursor.continue();
      };
    });
    return reset;
  });
  return result ?? 0;
}

export async function countOutbox(): Promise<number> {
  const result = await withStore(OUTBOX_STORE, "readonly", async (store) =>
    requestResult<number>(store.count()),
  );
  return result ?? 0;
}

/**
 * Sletter alle kladder og outbox-oppføringer som tilhører én bruker. Brukes
 * bare ved et eksplisitt valg om å forkaste egne kladder, eller av en
 * administratorstyrt rydding – aldri ved vanlig utlogging.
 */
export async function clearOfflineDataForUser(userId: string): Promise<void> {
  if (!hasIndexedDb()) return;

  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if ((cursor.value as OfflineDraft).userId === userId) cursor.delete();
        cursor.continue();
      };
    });
    return undefined;
  });

  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if ((cursor.value as OutboxItem).userId === userId) cursor.delete();
        cursor.continue();
      };
    });
    return undefined;
  });
}

/** Sletter alle lokale kladder og outbox-oppføringer for alle brukere. */
export async function clearOfflineData(): Promise<void> {
  if (!hasIndexedDb()) return;
  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    store.clear();
    return undefined;
  });
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    store.clear();
    return undefined;
  });
}
