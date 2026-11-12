/**
 * Integrasjonstest for IndexedDB-laget bak statuskøen.
 *
 * `visit-status-outbox.test.ts` mocker `./db` for å teste selve kølogikken.
 * Her kjøres de ekte db-funksjonene mot en liten IndexedDB-attrapp, slik at
 * lagring, duplikatnøkkel og opprydding også er dekket.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingVisitStatuses,
  listPendingVisitStatuses,
  putPendingVisitStatus,
  removePendingVisitStatus,
  type PendingVisitStatus,
} from "./db";

type Row = Record<string, unknown>;

type FakeRequest<T> = {
  result: T | undefined;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

type FakeTransaction = {
  error: unknown;
  objectStore: () => Record<string, (...args: never[]) => unknown>;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
};

function installFakeIndexedDb() {
  const stores = new Map<string, Map<string, Row>>([
    ["drafts", new Map()],
    ["outbox", new Map()],
    ["visit-statuses", new Map()],
  ]);

  /** Kjører forespørselen asynkront, som IndexedDB gjør. */
  function requestResult<T>(
    transaction: FakeTransaction,
    run: () => T,
  ): FakeRequest<T> {
    const request: FakeRequest<T> = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => {
      try {
        request.result = run();
        request.onsuccess?.();
      } catch (error) {
        // En feilet forespørsel avbryter transaksjonen, som i IndexedDB.
        request.error = error;
        transaction.error = error;
        request.onerror?.();
        transaction.onabort?.();
      }
    }, 0);
    return request;
  }

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
    },
    transaction(name: string) {
      const values = stores.get(name);
      if (!values) throw new Error(`Ukjent store ${name}`);

      const transaction: FakeTransaction = {
        error: null,
        objectStore: () => store,
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      const store = {
        add: (value: Row) =>
          requestResult(transaction, () => {
            const key = String(value.key ?? "");
            if (values.has(key)) {
              throw Object.assign(new Error("ConstraintError"), {
                name: "ConstraintError",
              });
            }
            values.set(key, value);
            return key;
          }),
        getAll: () => requestResult(transaction, () => [...values.values()]),
        delete: (key: string) =>
          requestResult(transaction, () => {
            values.delete(key);
            return undefined;
          }),
        clear: () =>
          requestResult(transaction, () => {
            values.clear();
            return undefined;
          }),
      };

      setTimeout(() => {
        if (transaction.error) transaction.onerror?.();
        else transaction.oncomplete?.();
      }, 5);
      return transaction;
    },
    close() {},
  };

  vi.stubGlobal("indexedDB", {
    open() {
      const openRequest = {
        result: db,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      setTimeout(() => {
        openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      }, 0);
      return openRequest;
    },
  });

  return stores;
}

function item(overrides: Partial<PendingVisitStatus> = {}): PendingVisitStatus {
  const at = Date.now() - 60_000;
  return {
    key: `visit-1:EN_ROUTE:${at}`,
    visitId: "visit-1",
    status: "EN_ROUTE",
    at,
    userId: "u1",
    queuedAt: at,
    ...overrides,
  };
}

let stores: ReturnType<typeof installFakeIndexedDb>;

beforeEach(() => {
  stores = installFakeIndexedDb();
});

describe("IndexedDB-køen for visittstatus", () => {
  it("lagrer en registrering og leser den tilbake", async () => {
    const entry = item();

    await expect(putPendingVisitStatus(entry)).resolves.toBe("queued");
    await expect(listPendingVisitStatuses()).resolves.toEqual([entry]);
    expect(stores.get("visit-statuses")?.size).toBe(1);
  });

  it("avviser samme nøkkel to ganger uten å overskrive posten", async () => {
    const entry = item();

    await expect(putPendingVisitStatus(entry)).resolves.toBe("queued");
    await expect(
      putPendingVisitStatus({ ...entry, queuedAt: entry.queuedAt + 1 }),
    ).resolves.toBe("duplicate");

    const stored = await listPendingVisitStatuses();
    expect(stored).toHaveLength(1);
    expect(stored[0].queuedAt).toBe(entry.queuedAt);
  });

  it("sletter enkeltposter og tømmer hele køen", async () => {
    const first = item({ key: "a" });
    const second = item({ key: "b" });
    await putPendingVisitStatus(first);
    await putPendingVisitStatus(second);

    await removePendingVisitStatus("a");
    await expect(listPendingVisitStatuses()).resolves.toEqual([second]);

    await clearPendingVisitStatuses();
    await expect(listPendingVisitStatuses()).resolves.toEqual([]);
  });
});
