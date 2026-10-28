import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  putOfflineDraft: vi.fn(),
  getOfflineDraft: vi.fn(),
  deleteOfflineDraft: vi.fn(),
  enqueueOutbox: vi.fn(),
  listOutbox: vi.fn(),
  listOutboxForUser: vi.fn(),
  countOutbox: vi.fn(),
  countOutboxForUser: vi.fn(),
  removeOutbox: vi.fn(),
  incrementOutboxAttempt: vi.fn(),
  clearOfflineDataForUser: vi.fn(),
}));

vi.mock("./db", () => mocks);

import {
  clearOfflineUserData,
  currentOfflineUserId,
  flushDraftOutbox,
  payloadMatchesReport,
  pendingDraftCount,
  queueDraftForRetry,
  removeOutboxForReport,
  saveDraftLocally,
} from "./draft-outbox";

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

beforeEach(() => {
  vi.clearAllMocks();
  installLocalStorage();
  mocks.countOutboxForUser.mockResolvedValue(0);
  mocks.listOutboxForUser.mockResolvedValue([]);
  mocks.listOutbox.mockResolvedValue([]);
  mocks.removeOutbox.mockResolvedValue(undefined);
});

describe("offline outbox – brukerscoping", () => {
  it("lagrer eieren på outbox-oppføringen", async () => {
    await saveDraftLocally({
      userId: "u1",
      workOrderId: "wo1",
      templateId: "tpl1",
      payload: { notes: "a" },
    });

    expect(currentOfflineUserId()).toBe("u1");

    await queueDraftForRetry({ workOrderId: "wo1" });

    expect(mocks.enqueueOutbox).toHaveBeenCalledWith(
      JSON.stringify({ workOrderId: "wo1" }),
      "u1",
    );
  });

  it("sender bare gjeldende brukers kladder", async () => {
    localStorage.setItem("fsm:offline-user", "u2");
    mocks.listOutboxForUser.mockResolvedValue([
      {
        id: "o2",
        userId: "u2",
        payload: "{}",
        createdAt: 1,
        attempts: 0,
      },
    ]);
    mocks.countOutboxForUser.mockResolvedValue(0);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const result = await flushDraftOutbox();

    expect(result).toEqual({ sent: 1, pending: 0 });
    expect(mocks.listOutboxForUser).toHaveBeenCalledWith("u2");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sender ingenting når ingen bruker er kjent", async () => {
    const result = await flushDraftOutbox();

    expect(result).toEqual({ sent: 0, pending: 0 });
    expect(mocks.listOutboxForUser).not.toHaveBeenCalled();
  });

  it("teller bare gjeldende brukers ventende kladder", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    mocks.countOutboxForUser.mockResolvedValue(3);

    await expect(pendingDraftCount()).resolves.toBe(3);
    expect(mocks.countOutboxForUser).toHaveBeenCalledWith("u1");
  });

  it("rydder brukerens kladder og glemmer eieren ved utlogging", async () => {
    localStorage.setItem("fsm:offline-user", "u1");

    await clearOfflineUserData();

    expect(mocks.clearOfflineDataForUser).toHaveBeenCalledWith("u1");
    expect(currentOfflineUserId()).toBeNull();
  });
});

describe("offline outbox – rekkefølge og sammenslåing", () => {
  it("sender bare nyeste kladd per rapport, og eldre duplikater fjernes", async () => {
    localStorage.setItem("fsm:offline-user", "u1");
    const older = {
      id: "old",
      userId: "u1",
      payload: JSON.stringify({
        workOrderId: "wo1",
        templateId: "tpl1",
        notes: "gammel",
      }),
      createdAt: 1,
      attempts: 0,
    };
    const newer = {
      id: "new",
      userId: "u1",
      payload: JSON.stringify({
        workOrderId: "wo1",
        templateId: "tpl1",
        notes: "ny",
      }),
      createdAt: 5,
      attempts: 0,
    };
    const other = {
      id: "other",
      userId: "u1",
      payload: JSON.stringify({
        workOrderId: "wo2",
        templateId: "tpl1",
        notes: "annet",
      }),
      createdAt: 3,
      attempts: 0,
    };
    // Listen er bevisst usortert, slik IndexedDB kan levere den.
    mocks.listOutboxForUser.mockResolvedValue([newer, other, older]);
    mocks.countOutboxForUser.mockResolvedValue(0);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(
      async (_url: string, init: { body: string }) =>
        new Response(init.body, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await flushDraftOutbox();

    expect(result).toEqual({ sent: 2, pending: 0 });
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
    mocks.listOutboxForUser.mockResolvedValue([
      {
        id: "newest",
        userId: "u1",
        payload: "{}",
        createdAt: 10,
        attempts: 0,
      },
      {
        id: "oldest",
        userId: "u1",
        payload: "{}",
        createdAt: 1,
        attempts: 0,
      },
    ]);
    mocks.countOutboxForUser.mockResolvedValue(0);
    vi.stubGlobal("navigator", { onLine: true });
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
    mocks.listOutboxForUser.mockResolvedValue([
      {
        id: "a",
        payload: JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
        createdAt: 1,
        attempts: 0,
      },
      {
        id: "b",
        payload: JSON.stringify({ workOrderId: "wo1", templateId: "tpl2" }),
        createdAt: 2,
        attempts: 0,
      },
      {
        id: "c",
        payload: "ugyldig",
        createdAt: 3,
        attempts: 0,
      },
    ]);

    await expect(
      removeOutboxForReport({ workOrderId: "wo1", templateId: "tpl1" }),
    ).resolves.toBe(1);
    expect(mocks.listOutboxForUser).toHaveBeenCalledWith("u1");
    expect(mocks.removeOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.removeOutbox).toHaveBeenCalledWith("a");
  });
});
