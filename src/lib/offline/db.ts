/**
 * Minimal IndexedDB-wrapper for offline kladder og outbox.
 *
 * Brukes bare i nettleseren. Alle funksjoner er no-op når IndexedDB ikke er
 * tilgjengelig (eldre nettlesere, private modus), slik at appen fortsatt
 * fungerer uten offline-lagring.
 *
 * Siden SEC-01 skrives `payload` alltid som AES-GCM-ciphertext. Oppslag og
 * lister dekrypterer med den PIN-opplåste nøkkelen og kaster
 * `OfflineLockedError` når nøkkelen er låst. Metadata (eier, oppdrag, mal og
 * tid) er fortsatt lesbar uten nøkkel, slik at låse-UI og utløpsrydding kan
 * fungere uten å eksponere innholdet.
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
import {
  decryptOfflinePayload,
  encryptOfflinePayload,
  isSealedRecord,
  OfflineTamperError,
} from "./crypto";
import type { OfflineVisitStatus } from "./visit-status-rules";

const DB_NAME = "fsm-offline";
// Versjon 2 la til køen for offline-registrerte visittstatusser. Nye stores
// opprettes i `onupgradeneeded`, så eksisterende kladder og outbox beholdes.
const DB_VERSION = 2;
const DRAFT_STORE = "drafts";
const OUTBOX_STORE = "outbox";
const VISIT_STATUS_STORE = "visit-statuses";

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

export type EnqueueResult =
  | "queued"
  | "too-large"
  | "unavailable"
  | "locked";

/**
 * En statusregistrering fra feltportalen som venter på å bli sendt.
 *
 * Posten er bevisst ikke kryptert slik kladdene er: den inneholder bare id-er,
 * status og tidspunkt, og må kunne legges i køen før montøren har låst opp
 * PIN-nøkkelen. Den er også nødvendig for at en ankomst skal kunne tidfestes
 * når appen aldri får kontakt med serveren.
 */
export type PendingVisitStatus = {
  /** Idempotensnøkkel fra `visitStatusKey`. */
  key: string;
  visitId: string;
  status: OfflineVisitStatus;
  /** Montørens tidspunkt for handlingen (epoch ms). */
  at: number;
  /** Eieren av køen, eller null når brukeren ikke er kjent i nettleseren. */
  userId: string | null;
  /** Når posten ble lagt i køen (epoch ms). */
  queuedAt: number;
};

/** Resultat av å legge en statusregistrering i køen. */
export type EnqueueVisitStatusResult =
  | "queued"
  | "duplicate"
  | "unavailable";

/**
 * Postene som faktisk ligger i IndexedDB. `payload` er ciphertext for alle
 * poster som er skrevet etter at SEC-01 ble innført. Eldre poster uten `enc`
 * er klartekst og migreres ved første opplåsing.
 */
type StoredDraft = Omit<OfflineDraft, "payload"> & {
  payload: string;
  enc?: string;
  iv?: string;
};

type StoredOutboxItem = Omit<OutboxItem, "payload"> & {
  payload: string;
  enc?: string;
  iv?: string;
};

export type OfflineStorageInspection = {
  drafts: number;
  outbox: number;
  /** Poster som fortsatt ligger i klartekst fra en eldre versjon. */
  plaintextDrafts: number;
  plaintextOutbox: number;
};

export type OfflineMigrationResult = {
  drafts: number;
  outbox: number;
};

function draftAad(draft: Pick<OfflineDraft, "key">): string {
  return `draft:${draft.key}`;
}

function outboxAad(id: string): string {
  return `outbox:${id}`;
}

async function openStoredPayload(
  record: { userId: string; payload: string; enc?: string; iv?: string },
  aad: string,
): Promise<string> {
  if (!record.enc) return record.payload;
  if (!isSealedRecord(record)) throw new OfflineTamperError();
  return decryptOfflinePayload(record.userId, aad, record);
}

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
      if (!db.objectStoreNames.contains(VISIT_STATUS_STORE)) {
        db.createObjectStore(VISIT_STATUS_STORE, { keyPath: "key" });
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
  const sealed = await encryptOfflinePayload(
    draft.userId,
    draftAad(draft),
    draft.payload,
  );
  const stored: StoredDraft = { ...draft, ...sealed };
  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    store.put(stored);
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
type DraftMetadata = Pick<
  OfflineDraft,
  "key" | "userId" | "workOrderId" | "templateId" | "updatedAt"
>;

async function markOutboxExpiredForDraft(
  draft: DraftMetadata,
): Promise<void> {
  const identity: ReportIdentity = {
    workOrderId: draft.workOrderId,
    templateId: draft.templateId,
  };
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    const items =
      (await requestResult<StoredOutboxItem[]>(store.getAll())) ?? [];
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
async function expireDrafts(drafts: DraftMetadata[]): Promise<void> {
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
    requestResult<StoredDraft | undefined>(store.get(key)),
  );
  const stored = result ?? null;
  if (!stored) return null;
  if (!isOfflineDraftExpired(stored.updatedAt, now)) {
    return {
      ...stored,
      payload: await openStoredPayload(stored, draftAad(stored)),
    };
  }
  await expireDrafts([stored]);
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
    requestResult<StoredDraft[]>(store.getAll()),
  );
  const drafts = (result ?? []).filter((draft) => draft.userId === userId);
  const fresh = drafts.filter(
    (draft) => !isOfflineDraftExpired(draft.updatedAt, now),
  );
  const expired = drafts.filter((draft) =>
    isOfflineDraftExpired(draft.updatedAt, now),
  );
  await expireDrafts(expired);
  return Promise.all(
    fresh.map(async (draft) => ({
      ...draft,
      payload: await openStoredPayload(draft, draftAad(draft)),
    })),
  );
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

  const id = crypto.randomUUID();
  const sealed = await encryptOfflinePayload(
    userId,
    outboxAad(id),
    payload,
  );
  const item: StoredOutboxItem = {
    id,
    userId,
    payload: sealed.payload,
    enc: sealed.enc,
    iv: sealed.iv,
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
        const existing = cursor.value as StoredOutboxItem;
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

async function readStoredOutbox(
  userId?: string,
): Promise<StoredOutboxItem[]> {
  const result = await withStore(OUTBOX_STORE, "readonly", async (store) =>
    requestResult<StoredOutboxItem[]>(store.getAll()),
  );
  // IndexedDB sorterer etter primærnøkkel (tilfeldig UUID). Selve outboxen må
  // sendes i kronologisk rekkefølge, ellers kan en eldre kladd vinne.
  return sortOutboxOldestFirst(
    (result ?? []).filter((item) => !userId || item.userId === userId),
  );
}

async function openOutboxItems(
  items: StoredOutboxItem[],
): Promise<OutboxItem[]> {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      payload: await openStoredPayload(item, outboxAad(item.id)),
    })),
  );
}

export async function listOutbox(): Promise<OutboxItem[]> {
  return openOutboxItems(await readStoredOutbox());
}

export async function listOutboxForUser(userId: string): Promise<OutboxItem[]> {
  // Filtrer på eier før dekryptering. Ellers ville en annen brukers låste
  // nøkkel blokkert denne brukerens kø.
  return openOutboxItems(await readStoredOutbox(userId));
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
  update: (current: StoredOutboxItem) => StoredOutboxItem,
): Promise<void> {
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    const current = await requestResult<StoredOutboxItem | undefined>(
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
        const item = cursor.value as StoredOutboxItem;
        if (
          item.userId === userId &&
          (item.failedAt || isAttemptLimitReached(item.attempts))
        ) {
          const next: StoredOutboxItem = {
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

/** Er feilen IndexedDBs «nøkkelen finnes allerede»? */
function isConstraintError(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "ConstraintError"
  );
}

/**
 * Legger en statusregistrering i køen.
 *
 * `add` avviser en nøkkel som allerede finnes. Dermed kan samme
 * visitt+status+at aldri ligge to ganger, heller ikke når to faner legger inn
 * den samme handlingen samtidig. Returverdien lar kalleren skille et ekte
 * duplikat fra en utilgjengelig IndexedDB.
 */
export async function putPendingVisitStatus(
  item: PendingVisitStatus,
): Promise<EnqueueVisitStatusResult> {
  try {
    const result = await withStore(
      VISIT_STATUS_STORE,
      "readwrite",
      async (store) => {
        store.add(item);
        return undefined;
      },
    );
    return result === null ? "unavailable" : "queued";
  } catch (error) {
    if (isConstraintError(error)) return "duplicate";
    throw error;
  }
}

/**
 * Alle køede statusregistreringer, uten brukerfilter. Rekkefølgen er
 * IndexedDBs nøkkelrekkefølge; `visit-status-outbox` sorterer kronologisk før
 * sending, fordi en ankomst aldri kan sendes før avreisen.
 */
export async function listPendingVisitStatuses(): Promise<
  PendingVisitStatus[]
> {
  const result = await withStore(VISIT_STATUS_STORE, "readonly", async (store) =>
    requestResult<PendingVisitStatus[]>(store.getAll()),
  );
  return result ?? [];
}

export async function removePendingVisitStatus(key: string): Promise<void> {
  await withStore(VISIT_STATUS_STORE, "readwrite", async (store) => {
    store.delete(key);
    return undefined;
  });
}

/** Tømmer hele statuskøen. Brukes av tester og ved bevisst opprydding. */
export async function clearPendingVisitStatuses(): Promise<void> {
  await withStore(VISIT_STATUS_STORE, "readwrite", async (store) => {
    store.clear();
    return undefined;
  });
}

export async function countOutbox(): Promise<number> {
  const result = await withStore(OUTBOX_STORE, "readonly", async (store) =>
    requestResult<number>(store.count()),
  );
  return result ?? 0;
}

/**
 * Teller poster uten å dekryptere. Brukes av låse-UI-et, som må kunne vise at
 * det finnes kladder selv når nøkkelen er låst.
 */
export async function inspectOfflineStorage(
  userId?: string,
): Promise<OfflineStorageInspection> {
  const [draftRows, outboxRows] = await Promise.all([
    withStore(DRAFT_STORE, "readonly", async (store) =>
      requestResult<StoredDraft[]>(store.getAll()),
    ),
    withStore(OUTBOX_STORE, "readonly", async (store) =>
      requestResult<StoredOutboxItem[]>(store.getAll()),
    ),
  ]);
  const drafts = (draftRows ?? []).filter(
    (draft) => !userId || draft.userId === userId,
  );
  const outbox = (outboxRows ?? []).filter(
    (item) => !userId || item.userId === userId,
  );
  return {
    drafts: drafts.length,
    outbox: outbox.length,
    plaintextDrafts: drafts.filter((draft) => !draft.enc).length,
    plaintextOutbox: outbox.filter((item) => !item.enc).length,
  };
}

/**
 * Krypterer eksisterende klartekstkladder for én bruker. Må kjøres etter at
 * brukeren har låst opp (eller satt) PIN. Postene skrives én og én, slik at et
 * avbrutt migreringsforsøk kan fortsette senere uten datatap.
 */
export async function migrateOfflineDataForUser(
  userId: string,
): Promise<OfflineMigrationResult> {
  // Les, krypter og skriv i separate transaksjoner. WebCrypto-promiser kan
  // fullføres etter at IndexedDB-transaksjonen er inaktiv, og da ville skrivingen
  // blitt avvist. En avbrutt migrering kan trygt kjøres igjen.
  const draftRows =
    (await withStore(DRAFT_STORE, "readonly", async (store) =>
      requestResult<StoredDraft[]>(store.getAll()),
    )) ?? [];
  const draftsToSeal = draftRows.filter(
    (row) => row.userId === userId && !row.enc && typeof row.payload === "string",
  );
  const sealedDrafts: StoredDraft[] = [];
  for (const row of draftsToSeal) {
    const sealed = await encryptOfflinePayload(
      userId,
      draftAad(row),
      row.payload,
    );
    sealedDrafts.push({ ...row, ...sealed });
  }
  if (sealedDrafts.length > 0) {
    await withStore(DRAFT_STORE, "readwrite", async (store) => {
      for (const row of sealedDrafts) store.put(row);
      return undefined;
    });
  }

  const outboxRows =
    (await withStore(OUTBOX_STORE, "readonly", async (store) =>
      requestResult<StoredOutboxItem[]>(store.getAll()),
    )) ?? [];
  const outboxToSeal = outboxRows.filter(
    (row) => row.userId === userId && !row.enc && typeof row.payload === "string",
  );
  const sealedOutbox: StoredOutboxItem[] = [];
  for (const row of outboxToSeal) {
    // Eldre outbox-poster kan mangle id-feltene. Les dem fra klarteksten før
    // den krypteres, slik at sammenslåing og sletting fortsatt virker.
    const identity = itemReportIdentity(row);
    const sealed = await encryptOfflinePayload(
      userId,
      outboxAad(row.id),
      row.payload,
    );
    sealedOutbox.push({
      ...row,
      ...sealed,
      ...(identity && !row.workOrderId ? identity : {}),
    });
  }
  if (sealedOutbox.length > 0) {
    await withStore(OUTBOX_STORE, "readwrite", async (store) => {
      for (const row of sealedOutbox) store.put(row);
      return undefined;
    });
  }

  return { drafts: sealedDrafts.length, outbox: sealedOutbox.length };
}

/** Sletter bare klartekstposter for brukeren, etter et eksplisitt valg. */
export async function discardPlaintextOfflineDataForUser(
  userId: string,
): Promise<void> {
  for (const storeName of [DRAFT_STORE, OUTBOX_STORE]) {
    await withStore(storeName, "readwrite", async (store) => {
      await new Promise<void>((resolve, reject) => {
        const request = store.openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as { userId?: string; enc?: string };
          if (value.userId === userId && !value.enc) cursor.delete();
          cursor.continue();
        };
      });
      return undefined;
    });
  }
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
  await withStore(VISIT_STATUS_STORE, "readwrite", async (store) => {
    store.clear();
    return undefined;
  });
}
