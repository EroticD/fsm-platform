import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueOutbox,
  listDraftsForUser,
  listOutbox,
  listOutboxForUser,
  putOfflineDraft,
} from "./db";
import { MAX_OUTBOX_PAYLOAD_BYTES } from "./outbox-order";

type Row = { id?: string; key?: string };

function installFakeIndexedDb() {
  const stores = new Map<string, Map<string, Row>>([
    ["drafts", new Map()],
    ["outbox", new Map()],
  ]);

  function storeFor(name: string) {
    const values = stores.get(name);
    if (!values) throw new Error(`Ukjent store ${name}`);
    return {
      put(value: Row) {
        values.set(value.id ?? value.key ?? "", value);
      },
      delete(key: string) {
        values.delete(key);
      },
      getAll() {
        const request = {
          result: null as unknown,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        setTimeout(() => {
          request.result = [...values.values()];
          request.onsuccess?.();
        }, 0);
        return request;
      },
      openCursor() {
        const rows = [...values.values()];
        let index = 0;
        const request = {
          result: null as unknown,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        } as {
          result: unknown;
          onsuccess: (() => void) | null;
          onerror: (() => void) | null;
        };
        const step = () => {
          if (index >= rows.length) {
            request.result = null;
            request.onsuccess?.();
            return;
          }
          const value = rows[index++];
          request.result = {
            value,
            delete: () => values.delete(value.id ?? value.key ?? ""),
            continue: () => setTimeout(step, 0),
          };
          request.onsuccess?.();
        };
        setTimeout(step, 0);
        return request;
      },
      count() {
        return values.size;
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
      let complete: (() => void) | null = null;
      const transaction = {
        objectStore: () => store,
        error: null,
        get oncomplete() {
          return complete;
        },
        set oncomplete(handler: (() => void) | null) {
          complete = handler;
          if (handler) setTimeout(handler, 0);
        },
        onerror: null,
        onabort: null,
      };
      return transaction;
    },
    close() {},
  };

  vi.stubGlobal("indexedDB", {
    open() {
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
  });

  return stores;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  installFakeIndexedDb();
});

describe("enqueueOutbox", () => {
  it("erstatter eldre kladd for samme bruker, oppdrag og mal", async () => {
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1", notes: "gammel" }),
      "u1",
    );
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1", notes: "ny" }),
      "u1",
    );

    const items = await listOutboxForUser("u1");
    expect(items).toHaveLength(1);
    expect(JSON.parse(items[0].payload).notes).toBe("ny");
  });

  it("beholder separate maler og brukere, og sorterer eldst først", async () => {
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
      "u1",
    );
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl2" }),
      "u1",
    );
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
      "u2",
    );

    const all = await listOutbox();
    expect(all).toHaveLength(3);
    expect(all[0].createdAt).toBeLessThanOrEqual(all[1].createdAt);
    expect(all[1].createdAt).toBeLessThanOrEqual(all[2].createdAt);
    expect(await listOutboxForUser("u1")).toHaveLength(2);
    expect(await listOutboxForUser("u2")).toHaveLength(1);
  });

  it("køer ikke payload over API-grensen, og fjerner eldre kladd for rapporten", async () => {
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1", notes: "gammel" }),
      "u1",
    );

    const tooLarge = JSON.stringify({
      workOrderId: "wo1",
      templateId: "tpl1",
      notes: "x".repeat(MAX_OUTBOX_PAYLOAD_BYTES),
    });
    await expect(enqueueOutbox(tooLarge, "u1")).resolves.toBe("too-large");

    expect(await listOutboxForUser("u1")).toHaveLength(0);
  });
});

describe("listDraftsForUser", () => {
  it("returnerer bare brukerens egne kladder", async () => {
    await putOfflineDraft({
      key: "u1:wo1:tpl1",
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: "a" }),
      updatedAt: 1,
    });
    await putOfflineDraft({
      key: "u2:wo1:tpl1",
      userId: "u2",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: "b" }),
      updatedAt: 2,
    });

    const drafts = await listDraftsForUser("u1");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].key).toBe("u1:wo1:tpl1");
  });
});
