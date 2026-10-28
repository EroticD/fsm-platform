/**
 * Minimal IndexedDB-wrapper for offline kladder og outbox.
 *
 * Brukes bare i nettleseren. Alle funksjoner er no-op når IndexedDB ikke er
 * tilgjengelig (eldre nettlesere, private modus), slik at appen fortsatt
 * fungerer uten offline-lagring.
 */
const DB_NAME = "fsm-offline";
const DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const OUTBOX_STORE = "outbox";

export type OfflineDraft = {
  key: string;
  userId: string;
  workOrderId: string;
  templateId: string;
  payload: string;
  updatedAt: number;
};

export type OutboxItem = {
  id: string;
  /** Eieren av kladden. Outboxen skal aldri sendes på vegne av en annen bruker. */
  userId: string;
  payload: string;
  createdAt: number;
  attempts: number;
};

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

export async function putOfflineDraft(draft: OfflineDraft): Promise<void> {
  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    store.put(draft);
    return undefined;
  });
}

export async function getOfflineDraft(
  key: string,
): Promise<OfflineDraft | null> {
  const result = await withStore(DRAFT_STORE, "readonly", async (store) =>
    requestResult<OfflineDraft | undefined>(store.get(key)),
  );
  return result ?? null;
}

export async function deleteOfflineDraft(key: string): Promise<void> {
  await withStore(DRAFT_STORE, "readwrite", async (store) => {
    store.delete(key);
    return undefined;
  });
}

export async function enqueueOutbox(
  payload: string,
  userId: string,
): Promise<void> {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    userId,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    store.put(item);
    return undefined;
  });
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const result = await withStore(OUTBOX_STORE, "readonly", async (store) =>
    requestResult<OutboxItem[]>(store.getAll()),
  );
  return result ?? [];
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

export async function incrementOutboxAttempt(
  item: OutboxItem,
): Promise<void> {
  await withStore(OUTBOX_STORE, "readwrite", async (store) => {
    store.put({ ...item, attempts: item.attempts + 1 });
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
 * Sletter alle kladder og outbox-oppføringer som tilhører én bruker. Brukes
 * ved utlogging fra en delt enhet, uten å røre en annen brukers data.
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

/** Sletter alle lokale kladder og outbox-oppføringer (brukes ved utlogging). */
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
