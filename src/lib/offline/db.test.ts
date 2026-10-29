import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPIRED_DRAFT_FAILURE_REASON,
  enqueueOutbox,
  getOfflineDraft,
  listDraftsForUser,
  listOutbox,
  listOutboxForUser,
  OFFLINE_DRAFT_MAX_AGE_DAYS,
  OFFLINE_DRAFT_MAX_AGE_MS,
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
      get(key: string) {
        const request = {
          result: null as unknown,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        setTimeout(() => {
          request.result = values.get(key);
          request.onsuccess?.();
        }, 0);
        return request;
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

let stores: ReturnType<typeof installFakeIndexedDb>;

beforeEach(() => {
  vi.unstubAllGlobals();
  stores = installFakeIndexedDb();
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
    const now = Date.now();
    await putOfflineDraft({
      key: "u1:wo1:tpl1",
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: "a" }),
      updatedAt: now - 1_000,
    });
    await putOfflineDraft({
      key: "u2:wo1:tpl1",
      userId: "u2",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: "b" }),
      updatedAt: now - 500,
    });

    const drafts = await listDraftsForUser("u1", now);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].key).toBe("u1:wo1:tpl1");
  });
});

describe("utløp for lokale kladder", () => {
  const now = 1_800_000_000_000;

  function draft(overrides: {
    key: string;
    workOrderId: string;
    updatedAt: number;
  }) {
    return {
      userId: "u1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: overrides.key }),
      ...overrides,
    };
  }

  it("beholder en kladd på grensen og ignorerer en som er ett millisekund eldre", async () => {
    expect(OFFLINE_DRAFT_MAX_AGE_MS).toBe(
      OFFLINE_DRAFT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    );
    const boundary = now - OFFLINE_DRAFT_MAX_AGE_MS;
    await putOfflineDraft(
      draft({ key: "u1:wo1:tpl1", workOrderId: "wo1", updatedAt: boundary }),
    );
    await putOfflineDraft(
      draft({ key: "u1:wo2:tpl1", workOrderId: "wo2", updatedAt: boundary - 1 }),
    );

    const drafts = await listDraftsForUser("u1", now);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].key).toBe("u1:wo1:tpl1");
    expect(stores.get("drafts")?.has("u1:wo2:tpl1")).toBe(false);
    await expect(
      getOfflineDraft("u1:wo2:tpl1", now),
    ).resolves.toBeNull();
  });

  it("ignorerer og rydder en utløpt kladd ved direkte oppslag", async () => {
    await putOfflineDraft(
      draft({
        key: "u1:wo1:tpl1",
        workOrderId: "wo1",
        updatedAt: now - OFFLINE_DRAFT_MAX_AGE_MS - 1,
      }),
    );

    await expect(getOfflineDraft("u1:wo1:tpl1", now)).resolves.toBeNull();
    expect(stores.get("drafts")?.has("u1:wo1:tpl1")).toBe(false);
  });

  it("beholder outbox-oppføringen, men markerer den som utløpt", async () => {
    await putOfflineDraft(
      draft({
        key: "u1:wo1:tpl1",
        workOrderId: "wo1",
        updatedAt: now - OFFLINE_DRAFT_MAX_AGE_MS - 1,
      }),
    );
    await enqueueOutbox(
      JSON.stringify({
        workOrderId: "wo1",
        templateId: "tpl1",
        notes: "gammel",
      }),
      "u1",
    );

    await expect(listDraftsForUser("u1", now)).resolves.toEqual([]);

    const items = await listOutboxForUser("u1");
    expect(items).toHaveLength(1);
    expect(items[0].failedAt).toBeGreaterThan(0);
    expect(items[0].failureReason).toBe(EXPIRED_DRAFT_FAILURE_REASON);
  });

  it("markerer ikke en fersk kladds outbox-oppføring som feilet", async () => {
    await putOfflineDraft(
      draft({
        key: "u1:wo1:tpl1",
        workOrderId: "wo1",
        updatedAt: now - OFFLINE_DRAFT_MAX_AGE_MS,
      }),
    );
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
      "u1",
    );

    await expect(listDraftsForUser("u1", now)).resolves.toHaveLength(1);

    const items = await listOutboxForUser("u1");
    expect(items).toHaveLength(1);
    expect(items[0].failedAt).toBeUndefined();
    expect(items[0].failureReason).toBeUndefined();
  });
});
