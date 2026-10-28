import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineDraft, OutboxItem } from "./db";

const mocks = vi.hoisted(() => ({
  putOfflineDraft: vi.fn(),
  getOfflineDraft: vi.fn(),
  deleteOfflineDraft: vi.fn(),
  listDraftsForUser: vi.fn(),
  enqueueOutbox: vi.fn(),
  listOutboxForUser: vi.fn(),
  removeOutbox: vi.fn(),
  recordOutboxFailure: vi.fn(),
  resetFailedOutbox: vi.fn(),
  clearOfflineDataForUser: vi.fn(),
}));

vi.mock("./db", () => mocks);

import {
  clearOfflineUserData,
  currentOfflineUserId,
  flushDraftOutbox,
  payloadMatchesReport,
  pendingDraftCount,
  pendingDraftSummary,
  queueDraftForRetry,
  removeOutboxForReport,
  retryFailedDrafts,
  saveDraftLocally,
} from "./draft-outbox";

type State = {
  drafts: OfflineDraft[];
  outbox: OutboxItem[];
};

const state: State = { drafts: [], outbox: [] };

function installLocalStorage() {
  const store = new Map<string, string>();
  const fake = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", fake);
  return fake;
}

function draft(overrides: Partial<OfflineDraft>): OfflineDraft {
  return {
    key: "u1:wo1:tpl1",
    userId: "u1",
    workOrderId: "wo1",
    templateId: "tpl1",
    payload: JSON.stringify({ notes: "a" }),
    updatedAt: 1,
    ...overrides,
  };
}

function outboxItem(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "o1",
    userId: "u1",
    payload: JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.drafts = [];
  state.outbox = [];
  installLocalStorage();
  vi.stubGlobal("navigator", { onLine: true });

  mocks.listDraftsForUser.mockImplementation(async (userId: string) =>
    state.drafts.filter((entry) => entry.userId === userId),
  );
  mocks.listOutboxForUser.mockImplementation(async (userId: string) =>
    state.outbox.filter((item) => item.userId === userId),
  );
  mocks.enqueueOutbox.mockResolvedValue("queued");
  mocks.putOfflineDraft.mockImplementation(async (entry: OfflineDraft) => {
    state.drafts = state.drafts
      .filter((existing) => existing.key !== entry.key)
      .concat(entry);
  });
  mocks.getOfflineDraft.mockImplementation(
    async (key: string) => state.drafts.find((entry) => entry.key === key) ?? null,
  );
  mocks.deleteOfflineDraft.mockImplementation(async (key: string) => {
    state.drafts = state.drafts.filter((entry) => entry.key !== key);
  });
  mocks.removeOutbox.mockImplementation(async (id: string) => {
    state.outbox = state.outbox.filter((item) => item.id !== id);
  });
  mocks.recordOutboxFailure.mockImplementation(
    async (
      item: OutboxItem,
      options: { terminal?: boolean; reason?: string } = {},
    ) => {
      const attempts = item.attempts + 1;
      const terminal = options.terminal === true || attempts >= 10;
      state.outbox = state.outbox.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              attempts,
              ...(terminal
                ? {
                    failedAt: Date.now(),
                    failureReason: options.reason ?? "attempts-exhausted",
                  }
                : { nextAttemptAt: Date.now() + 15_000 }),
            }
          : entry,
      );
    },
  );
  mocks.resetFailedOutbox.mockImplementation(async (userId: string) => {
    state.outbox = state.outbox.map((item) => {
      if (item.userId !== userId || !item.failedAt) return item;
      const next = { ...item, attempts: 0, nextAttemptAt: 0 };
      delete next.failedAt;
      delete next.failureReason;
      return next;
    });
    return 1;
  });
  mocks.clearOfflineDataForUser.mockResolvedValue(undefined);
});

describe("offline outbox – lokal lagring", () => {
  it("legger hver lokal lagring i outboxen med skjemaverdier og ids", async () => {
    await saveDraftLocally({
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: {
        state: { units: [] },
        form: { notes: "a", workOrderId: "wo1", templateId: "tpl1" },
        notes: "a",
      },
    });

    expect(currentOfflineUserId()).toBe("u1");
    expect(mocks.putOfflineDraft).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueOutbox).toHaveBeenCalledTimes(1);
    const [serialized, userId] = mocks.enqueueOutbox.mock.calls[0];
    expect(userId).toBe("u1");
    expect(JSON.parse(serialized)).toEqual({
      notes: "a",
      workOrderId: "wo1",
      templateId: "tpl1",
    });
  });

  it("sammenslår lokale lagringer per rapport i outboxen (nyeste vinner)", async () => {
    await saveDraftLocally({
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: { notes: "gammel" },
    });
    await saveDraftLocally({
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: { notes: "ny" },
    });

    expect(mocks.enqueueOutbox).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.enqueueOutbox.mock.calls[1][0]).notes).toBe("ny");
    // Den ekte db-en slår sammen per bruker+oppdrag+mal. Her verifiserer vi at
    // begge lagringene faktisk går gjennom køen med samme identitet.
    expect(JSON.parse(mocks.enqueueOutbox.mock.calls[0][0])).toMatchObject({
      workOrderId: "wo1",
      templateId: "tpl1",
    });
  });

  it("markerer for stor payload som ikke sendbar uten å køe den", async () => {
    mocks.enqueueOutbox.mockResolvedValue("too-large");

    await saveDraftLocally({
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: { notes: "stor" },
    });

    expect(state.drafts[0].syncError).toBe("payload-too-large");
    await expect(pendingDraftSummary("u1")).resolves.toEqual({
      pending: 0,
      failed: 1,
    });
  });

  it("beholder eieren og lar queueDraftForRetry bruke den", async () => {
    await saveDraftLocally({
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: { notes: "a" },
    });

    await queueDraftForRetry({ workOrderId: "wo1" });

    expect(mocks.enqueueOutbox).toHaveBeenLastCalledWith(
      JSON.stringify({ workOrderId: "wo1" }),
      "u1",
    );
  });
});

describe("offline outbox – telling og brukerscoping", () => {
  it("teller unionen av lokale kladder og outbox uten dobbelttelling", async () => {
    state.drafts = [
      draft({ key: "u1:wo1:tpl1", updatedAt: 5 }),
      draft({
        key: "u1:wo2:tpl1",
        workOrderId: "wo2",
        updatedAt: 3,
      }),
      draft({
        key: "u1:wo3:tpl1",
        workOrderId: "wo3",
        updatedAt: 2,
        syncedAt: 2,
      }),
    ];
    state.outbox = [
      outboxItem({ id: "same", createdAt: 6 }),
      outboxItem({
        id: "other",
        workOrderId: "wo4",
        payload: JSON.stringify({ workOrderId: "wo4", templateId: "tpl1" }),
        createdAt: 4,
      }),
    ];

    await expect(pendingDraftSummary("u1")).resolves.toEqual({
      pending: 3,
      failed: 0,
    });
    await expect(pendingDraftCount("u1")).resolves.toBe(3);
  });

  it("skiller terminale feil fra ventende kladder", async () => {
    state.outbox = [
      outboxItem({ id: "failed", failedAt: 1, failureReason: "rejected" }),
      outboxItem({
        id: "waiting",
        userId: "u2",
        payload: JSON.stringify({ workOrderId: "wo2", templateId: "tpl1" }),
      }),
    ];

    await expect(pendingDraftSummary("u1")).resolves.toEqual({
      pending: 0,
      failed: 1,
    });
  });

  it("sender bare gjeldende brukers kladder", async () => {
    localStorage.setItem("fsm:offline-user", "u2");
    state.outbox = [
      outboxItem({ id: "o2", userId: "u2" }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const result = await flushDraftOutbox();

    expect(result).toEqual({ sent: 1, pending: 0, failed: 0 });
    expect(mocks.listOutboxForUser).toHaveBeenCalledWith("u2");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sender ingenting når ingen bruker er kjent", async () => {
    const result = await flushDraftOutbox();

    expect(result).toEqual({ sent: 0, pending: 0, failed: 0 });
    expect(mocks.listOutboxForUser).not.toHaveBeenCalled();
  });

  it("rydder brukerens kladder og glemmer eieren ved utlogging", async () => {
    localStorage.setItem("fsm:offline-user", "u1");

    await clearOfflineUserData();

    expect(mocks.clearOfflineDataForUser).toHaveBeenCalledWith("u1");
    expect(currentOfflineUserId()).toBeNull();
  });
});

describe("offline outbox – retry-policy", () => {
  it("prøver på nytt med backoff og fortsetter under taket", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    state.outbox = [outboxItem({ attempts: 2 })];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );

    const result = await flushDraftOutbox();

    expect(mocks.recordOutboxFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "o1" }),
      { terminal: false, reason: "http-500" },
    );
    expect(result.failed).toBe(0);
    expect(result.pending).toBe(1);
  });

  it("markerer 413 som terminalt med en gang", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    state.outbox = [outboxItem()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 413 })),
    );

    const result = await flushDraftOutbox();

    expect(mocks.recordOutboxFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "o1" }),
      { terminal: true, reason: "payload-too-large" },
    );
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(0);
  });

  it("sender ikke en oppføring som allerede har brukt opp forsøkene", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    state.outbox = [outboxItem({ attempts: 10 })];
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await flushDraftOutbox();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.recordOutboxFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: "o1" }),
      { terminal: true, reason: "attempts-exhausted" },
    );
    expect(result.failed).toBe(1);
  });

  it("nullstiller terminale feil før manuell retry", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    state.outbox = [
      outboxItem({ failedAt: 1, failureReason: "rejected" }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    await retryFailedDrafts();

    expect(mocks.resetFailedOutbox).toHaveBeenCalledWith("u1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("offline outbox – rekkefølge og sammenslåing", () => {
  it("sender bare nyeste kladd per rapport, og eldre duplikater fjernes", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    const older = outboxItem({
      id: "old",
      createdAt: 1,
      payload: JSON.stringify({
        workOrderId: "wo1",
        templateId: "tpl1",
        notes: "gammel",
      }),
    });
    const newer = outboxItem({
      id: "new",
      createdAt: 5,
      payload: JSON.stringify({
        workOrderId: "wo1",
        templateId: "tpl1",
        notes: "ny",
      }),
    });
    const other = outboxItem({
      id: "other",
      createdAt: 3,
      payload: JSON.stringify({
        workOrderId: "wo2",
        templateId: "tpl1",
        notes: "annet",
      }),
    });
    // Listen er bevisst usortert, slik IndexedDB kan levere den.
    state.outbox = [newer, other, older];
    const fetchMock = vi.fn(
      async (_url: string, init: { body: string }) =>
        new Response(init.body, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await flushDraftOutbox();

    expect(result.sent).toBe(2);
    const sentBodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(call[1].body),
    );
    // Eldste først, nyeste for rapporten sist.
    expect(sentBodies.map((body) => body.notes)).toEqual(["annet", "ny"]);
    expect(mocks.removeOutbox).toHaveBeenCalledWith("old");
    expect(mocks.removeOutbox).toHaveBeenCalledWith("new");
    expect(mocks.removeOutbox).toHaveBeenCalledWith("other");
    expect(mocks.removeOutbox).not.toHaveBeenCalledWith("missing");
  });

  it("legger nyeste kladd bakerst når mange rapporter venter", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    state.outbox = [
      outboxItem({ id: "newest", createdAt: 10 }),
      outboxItem({ id: "oldest", createdAt: 1 }),
    ];
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await flushDraftOutbox();

    const order = mocks.removeOutbox.mock.calls.map((call) => call[0]);
    expect(order).toEqual(["oldest", "newest"]);
  });
});

describe("offline outbox – rapportopprydding", () => {
  it("gjenkjenner en outbox-oppføring for samme oppdrag og mal", () => {
    const payload = JSON.stringify({
      workOrderId: "wo1",
      templateId: "tpl1",
      notes: "Kladd",
    });

    expect(payloadMatchesReport(payload, "wo1", "tpl1")).toBe(true);
    expect(payloadMatchesReport(payload, "wo2", "tpl1")).toBe(false);
    expect(payloadMatchesReport("ikke-json", "wo1", "tpl1")).toBe(false);
  });

  it("fjerner bare oppføringer som hører til den innsendte rapporten", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    state.outbox = [
      outboxItem({
        id: "a",
        payload: JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
        createdAt: 1,
      }),
      outboxItem({
        id: "b",
        payload: JSON.stringify({ workOrderId: "wo1", templateId: "tpl2" }),
        createdAt: 2,
      }),
      outboxItem({ id: "c", payload: "ugyldig", createdAt: 3 }),
    ];
    state.drafts = [draft({ updatedAt: 1 })];

    await expect(
      removeOutboxForReport({ workOrderId: "wo1", templateId: "tpl1" }),
    ).resolves.toBe(1);
    expect(mocks.listOutboxForUser).toHaveBeenCalledWith("u1");
    expect(mocks.removeOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.removeOutbox).toHaveBeenCalledWith("a");
    expect(state.drafts[0].syncedAt).toBe(1);
  });
});
