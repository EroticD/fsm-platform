import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPIRED_DRAFT_FAILURE_REASON,
  enqueueOutbox,
  getOfflineDraft,
  inspectOfflineStorage,
  listDraftsForUser,
  listOutbox,
  listOutboxForUser,
  migrateOfflineDataForUser,
  OFFLINE_DRAFT_MAX_AGE_DAYS,
  OFFLINE_DRAFT_MAX_AGE_MS,
  putOfflineDraft,
} from "./db";
import { MAX_OUTBOX_PAYLOAD_BYTES } from "./outbox-order";
import {
  createOfflineKey,
  lockAllOfflineSessions,
  lockOfflineSession,
  OFFLINE_ENCRYPTION_VERSION,
  OfflineLockedError,
  unlockOfflineKey,
} from "./crypto";

const TEST_PIN = "123456";
const TEST_ITERATIONS = 1_000;

function installLocalStorage() {
  const values = new Map<string, string>();
  const fake = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  vi.stubGlobal("localStorage", fake);
  return fake;
}

type Row = { id?: string; key?: string; [key: string]: unknown };

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

beforeEach(async () => {
  vi.unstubAllGlobals();
  lockAllOfflineSessions();
  installLocalStorage();
  stores = installFakeIndexedDb();
  await createOfflineKey("u1", TEST_PIN, { iterations: TEST_ITERATIONS });
  await createOfflineKey("u2", TEST_PIN, { iterations: TEST_ITERATIONS });
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

describe("offline-lagring – kryptering ved skriving", () => {
  it("skriver aldri kundenavn, notater eller signaturer i klartekst", async () => {
    const payload = JSON.stringify({
      notes: "Kunde Ola Nordmann, Storgata 1",
      signature: "data:image/png;base64,c2lnbmF0dXJl",
      units: [{ serial: "SN-123" }],
    });

    await putOfflineDraft({
      key: "u1:wo1:tpl1",
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload,
      updatedAt: Date.now(),
    });
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1", notes: payload }),
      "u1",
    );

    const storedDraft = stores.get("drafts")?.get("u1:wo1:tpl1") as Record<
      string,
      unknown
    >;
    expect(storedDraft.enc).toBe(OFFLINE_ENCRYPTION_VERSION);
    expect(JSON.stringify(storedDraft)).not.toContain("Ola Nordmann");
    expect(JSON.stringify(storedDraft)).not.toContain("Storgata");
    expect(JSON.stringify(storedDraft)).not.toContain("c2lnbmF0dXJl");

    const storedOutbox = [...(stores.get("outbox")?.values() ?? [])][0] as
      | Record<string, unknown>
      | undefined;
    expect(storedOutbox?.enc).toBe(OFFLINE_ENCRYPTION_VERSION);
    expect(JSON.stringify(storedOutbox)).not.toContain("Ola Nordmann");

    await expect(
      getOfflineDraft("u1:wo1:tpl1"),
    ).resolves.toMatchObject({ payload });
    const items = await listOutboxForUser("u1");
    expect(JSON.parse(items[0].payload).notes).toBe(payload);
  });

  it("krever opplåsing før kladden kan leses, og gjenoppretter eksakt payload", async () => {
    const payload = JSON.stringify({ notes: "nøyaktig innhold", units: [1, 2] });
    await putOfflineDraft({
      key: "u1:wo1:tpl1",
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload,
      updatedAt: Date.now(),
    });

    lockOfflineSession("u1");
    await expect(getOfflineDraft("u1:wo1:tpl1")).rejects.toBeInstanceOf(
      OfflineLockedError,
    );
    await expect(listDraftsForUser("u1")).rejects.toBeInstanceOf(
      OfflineLockedError,
    );

    await unlockOfflineKey("u1", TEST_PIN);
    await expect(getOfflineDraft("u1:wo1:tpl1")).resolves.toMatchObject({
      payload,
    });
  });
});

describe("offline-lagring – migrering av klartekst", () => {
  it("krypterer gamle kladder og outbox-poster uten å endre innholdet", async () => {
    const legacyDraftPayload = JSON.stringify({ notes: "gammel kladd" });
    stores.get("drafts")?.set("u1:wo9:tpl9", {
      key: "u1:wo9:tpl9",
      userId: "u1",
      workOrderId: "wo9",
      templateId: "tpl9",
      payload: legacyDraftPayload,
      updatedAt: Date.now(),
    });
    const legacyOutboxPayload = JSON.stringify({
      workOrderId: "wo9",
      templateId: "tpl9",
      notes: "gammel outbox",
    });
    stores.get("outbox")?.set("legacy-out", {
      id: "legacy-out",
      userId: "u1",
      payload: legacyOutboxPayload,
      createdAt: Date.now(),
      attempts: 0,
    });

    expect(await inspectOfflineStorage("u1")).toMatchObject({
      drafts: 1,
      outbox: 1,
      plaintextDrafts: 1,
      plaintextOutbox: 1,
    });

    await expect(migrateOfflineDataForUser("u1")).resolves.toEqual({
      drafts: 1,
      outbox: 1,
    });

    expect(await inspectOfflineStorage("u1")).toMatchObject({
      plaintextDrafts: 0,
      plaintextOutbox: 0,
    });
    const storedDraft = stores.get("drafts")?.get("u1:wo9:tpl9") as Record<
      string,
      unknown
    >;
    expect(storedDraft.enc).toBe(OFFLINE_ENCRYPTION_VERSION);
    await expect(getOfflineDraft("u1:wo9:tpl9")).resolves.toMatchObject({
      payload: legacyDraftPayload,
    });

    const storedOutbox = stores.get("outbox")?.get("legacy-out") as Record<
      string,
      unknown
    >;
    expect(storedOutbox.enc).toBe(OFFLINE_ENCRYPTION_VERSION);
    expect(storedOutbox.workOrderId).toBe("wo9");
    expect(storedOutbox.templateId).toBe("tpl9");
    const migrated = await listOutboxForUser("u1");
    expect(migrated[0].payload).toBe(legacyOutboxPayload);
  });

  it("nekter å migrere mens nøkkelen er låst", async () => {
    stores.get("drafts")?.set("u1:wo9:tpl9", {
      key: "u1:wo9:tpl9",
      userId: "u1",
      workOrderId: "wo9",
      templateId: "tpl9",
      payload: JSON.stringify({ notes: "klartekst" }),
      updatedAt: Date.now(),
    });
    lockOfflineSession("u1");

    await expect(migrateOfflineDataForUser("u1")).rejects.toBeInstanceOf(
      OfflineLockedError,
    );
  });

  it("lar en annen brukers låste nøkkel ikke blokkere min kø", async () => {
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo1", templateId: "tpl1", notes: "min" }),
      "u1",
    );
    await enqueueOutbox(
      JSON.stringify({ workOrderId: "wo2", templateId: "tpl2", notes: "deres" }),
      "u2",
    );

    lockOfflineSession("u2");

    const mine = await listOutboxForUser("u1");
    expect(mine).toHaveLength(1);
    expect(JSON.parse(mine[0].payload).notes).toBe("min");
    await expect(listOutboxForUser("u2")).rejects.toBeInstanceOf(
      OfflineLockedError,
    );
  });

  it("skiller brukere selv om de deler nettleserprofil", async () => {
    await putOfflineDraft({
      key: "u1:wo1:tpl1",
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: JSON.stringify({ notes: "bare u1" }),
      updatedAt: Date.now(),
    });

    await expect(listDraftsForUser("u2")).resolves.toEqual([]);
    await expect(getOfflineDraft("u1:wo1:tpl1")).resolves.toMatchObject({
      userId: "u1",
    });
  });
});
