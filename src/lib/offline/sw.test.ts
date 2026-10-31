import { readFileSync } from "node:fs";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kjører public/sw.js i en liten sandkasse og tester bare `sync`-håndteringen.
 * Fetch- og cache-håndteringen lastes, men kjøres ikke.
 */
const swSource = readFileSync(
  new URL("../../../public/sw.js", import.meta.url),
  "utf8",
);

const DB_NAME = "fsm-offline";
const META_CACHE = "fsm-offline-meta";
const OFFLINE_USER_KEY = "/__fsm/offline-user";

type OutboxItem = {
  id: string;
  userId: string;
  payload: string;
  createdAt: number;
  attempts: number;
  workOrderId?: string;
  templateId?: string;
  nextAttemptAt?: number;
  failedAt?: number;
  failureReason?: string;
};

function item(overrides: Partial<OutboxItem> & { id: string }): OutboxItem {
  return {
    userId: "u1",
    payload: JSON.stringify({
      workOrderId: overrides.workOrderId ?? "wo1",
      templateId: overrides.templateId ?? "tpl1",
      notes: overrides.id,
    }),
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

function deferredRequest<T>(result: T) {
  const request = {
    result: undefined as T | undefined,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  setTimeout(() => {
    request.result = result;
    request.onsuccess?.();
  }, 0);
  return request;
}

function installFakeIndexedDb(initial: OutboxItem[]) {
  const stores = new Map<string, Map<string, unknown>>([
    ["drafts", new Map()],
    ["outbox", new Map(initial.map((entry) => [entry.id, { ...entry }]))],
  ]);

  function storeFor(name: string) {
    const values = stores.get(name);
    if (!values) throw new Error(`Ukjent store ${name}`);
    return {
      getAll() {
        return deferredRequest([...values.values()]);
      },
      get(key: string) {
        return deferredRequest(values.get(key));
      },
      put(value: { id?: string; key?: string }) {
        values.set(value.id ?? value.key ?? "", { ...value });
        return deferredRequest(undefined);
      },
      delete(key: string) {
        values.delete(key);
        return deferredRequest(undefined);
      },
    };
  }

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
    },
    transaction(name: string) {
      const store = storeFor(name);
      const transaction = {
        objectStore: () => store,
        error: null,
        oncomplete: null as (() => void) | null,
        onerror: null,
        onabort: null,
      };
      let complete: (() => void) | null = null;
      Object.defineProperty(transaction, "oncomplete", {
        get: () => complete,
        set: (handler: (() => void) | null) => {
          complete = handler;
          if (handler) setTimeout(handler, 0);
        },
      });
      return transaction;
    },
    close() {},
  };

  const indexedDB = {
    open(name: string) {
      expect(name).toBe(DB_NAME);
      const request = {
        result: db,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      setTimeout(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };

  return { stores, indexedDB };
}

function installFakeCaches(userId: string | null) {
  const values = new Map<string, string>();
  if (userId) values.set(OFFLINE_USER_KEY, userId);

  return {
    async open(name: string) {
      expect(name).toBe(META_CACHE);
      return {
        async match(key: string) {
          const value = values.get(key);
          return value === undefined ? undefined : new Response(value);
        },
        async put(key: string, response: Response) {
          values.set(key, await response.text());
        },
        async delete(key: string) {
          values.delete(key);
        },
      };
    },
  };
}

function loadWorker(options: {
  userId: string | null;
  outbox: OutboxItem[];
  fetch: ReturnType<typeof vi.fn>;
  online?: boolean;
}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const clients = [{ postMessage: vi.fn() }];
  const { stores, indexedDB } = installFakeIndexedDb(options.outbox);
  const caches = installFakeCaches(options.userId);

  const self = {
    location: { origin: "https://fsm.example" },
    navigator: { onLine: options.online ?? true },
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler);
    },
    clients: {
      matchAll: vi.fn(async () => clients),
    },
    skipWaiting: vi.fn(),
    registration: { sync: { register: vi.fn() } },
  };

  const sandbox = {
    self,
    caches,
    indexedDB,
    fetch: options.fetch,
    URL,
    Response,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(swSource, sandbox, { filename: "public/sw.js" });

  async function dispatchSync(tag = "fsm-draft-sync") {
    const handler = listeners.get("sync");
    if (!handler) throw new Error("Mangler sync-handler");
    let pending: Promise<unknown> | undefined;
    handler({
      tag,
      waitUntil(promise: Promise<unknown>) {
        pending = promise;
      },
    });
    if (pending) await pending;
  }

  return { dispatchSync, clients, stores };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("service worker – sync-hendelse", () => {
  it("replayer bare gjeldende brukers nyeste kladd per rapport", async () => {
    const fetchMock = vi.fn(
      async (url: string, init: { body: string }) => {
        expect(url).toBe("https://fsm.example/api/offline/draft");
        expect(init.body).toContain("workOrderId");
        return new Response("{}", { status: 200 });
      },
    );
    const worker = loadWorker({
      userId: "u1",
      fetch: fetchMock,
      outbox: [
        item({ id: "old", createdAt: 1 }),
        item({ id: "new", createdAt: 2 }),
        item({ id: "other", workOrderId: "wo2", createdAt: 3 }),
        item({ id: "theirs", userId: "u2", createdAt: 4 }),
      ],
    });

    await worker.dispatchSync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map((call) =>
        JSON.parse((call[1] as { body: string }).body).notes,
      ),
    ).toEqual(["new", "other"]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://fsm.example/api/offline/draft",
    );

    const outbox = worker.stores.get("outbox");
    expect(outbox?.has("old")).toBe(false);
    expect(outbox?.has("new")).toBe(false);
    expect(outbox?.has("other")).toBe(false);
    expect(outbox?.has("theirs")).toBe(true);
    expect(worker.clients[0].postMessage).toHaveBeenCalledWith({
      type: "FSM_DRAFT_SYNC_RESULT",
      result: { sent: 2, pending: 0, failed: 0 },
    });
  });

  it("markerer 413 som terminal og fortsetter med neste rapport", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { workOrderId: string };
      return new Response("{}", {
        status: body.workOrderId === "wo1" ? 413 : 200,
      });
    });
    const worker = loadWorker({
      userId: "u1",
      fetch: fetchMock,
      outbox: [
        item({ id: "too-large", workOrderId: "wo1" }),
        item({ id: "ok", workOrderId: "wo2" }),
      ],
    });

    await worker.dispatchSync();

    const outbox = worker.stores.get("outbox");
    const failed = outbox?.get("too-large") as OutboxItem;
    expect(failed.failedAt).toBeGreaterThan(0);
    expect(failed.failureReason).toBe("payload-too-large");
    expect(outbox?.has("ok")).toBe(false);
    expect(worker.clients[0].postMessage).toHaveBeenCalledWith({
      type: "FSM_DRAFT_SYNC_RESULT",
      result: { sent: 1, pending: 0, failed: 1 },
    });
  });

  it("respekterer backoff uten å sende eller avvise hendelsen", async () => {
    const fetchMock = vi.fn();
    const worker = loadWorker({
      userId: "u1",
      fetch: fetchMock,
      outbox: [
        item({ id: "waiting", nextAttemptAt: Date.now() + 60_000 }),
      ],
    });

    await expect(worker.dispatchSync()).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(worker.clients[0].postMessage).toHaveBeenCalledWith({
      type: "FSM_DRAFT_SYNC_RESULT",
      result: { sent: 0, pending: 1, failed: 0 },
    });
  });

  it("gjør ingenting når ingen offline-bruker er kjent", async () => {
    const fetchMock = vi.fn();
    const worker = loadWorker({
      userId: null,
      fetch: fetchMock,
      outbox: [item({ id: "o1" })],
    });

    await expect(worker.dispatchSync()).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(worker.clients[0].postMessage).not.toHaveBeenCalled();
  });

  it("avviser hendelsen ved nettverksfeil så nettleseren prøver igjen", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    const worker = loadWorker({
      userId: "u1",
      fetch: fetchMock,
      outbox: [item({ id: "o1" })],
    });

    await expect(worker.dispatchSync()).rejects.toThrow("draft-sync-retry");

    const stored = worker.stores.get("outbox")?.get("o1") as OutboxItem;
    expect(stored.attempts).toBe(1);
    expect(stored.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(worker.clients[0].postMessage).toHaveBeenCalledWith({
      type: "FSM_DRAFT_SYNC_RESULT",
      result: { sent: 0, pending: 1, failed: 0 },
    });
  });

  it("beholder kladden uten å brenne forsøk når økten er utløpt", async () => {
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 401 }),
    );
    const worker = loadWorker({
      userId: "u1",
      fetch: fetchMock,
      outbox: [item({ id: "o1" })],
    });

    await expect(worker.dispatchSync()).resolves.toBeUndefined();

    const stored = worker.stores.get("outbox")?.get("o1") as OutboxItem;
    expect(stored.attempts).toBe(0);
    expect(stored.failedAt).toBeUndefined();
    expect(worker.clients[0].postMessage).toHaveBeenCalledWith({
      type: "FSM_DRAFT_SYNC_RESULT",
      result: { sent: 0, pending: 1, failed: 0 },
    });
  });

  it("avviser hendelsen når nettleseren fortsatt er offline", async () => {
    const fetchMock = vi.fn();
    const worker = loadWorker({
      userId: "u1",
      fetch: fetchMock,
      outbox: [item({ id: "o1" })],
      online: false,
    });

    await expect(worker.dispatchSync()).rejects.toThrow("draft-sync-offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignorerer andre sync-tagger", async () => {
    const fetchMock = vi.fn();
    const worker = loadWorker({
      userId: "u1",
      fetch: fetchMock,
      outbox: [item({ id: "o1" })],
    });

    await expect(worker.dispatchSync("other-tag")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
