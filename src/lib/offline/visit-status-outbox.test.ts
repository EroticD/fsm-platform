import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingVisitStatus } from "./db";

const mocks = vi.hoisted(() => ({
  putPendingVisitStatus: vi.fn(),
  listPendingVisitStatuses: vi.fn(),
  removePendingVisitStatus: vi.fn(),
  clearPendingVisitStatuses: vi.fn(),
}));

vi.mock("./db", () => mocks);

import {
  clearVisitStatusOutbox,
  flushVisitStatuses,
  listPendingVisitStatuses,
  queueVisitStatus,
  sortPendingVisitStatuses,
  VISIT_STATUS_MAX_AGE_MS,
} from "./visit-status-outbox";
import type { VisitStatusSender } from "./visit-status-outbox";

const store = new Map<string, PendingVisitStatus>();

function installLocalStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
}

function pending(overrides: Partial<PendingVisitStatus> = {}): PendingVisitStatus {
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

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  installLocalStorage();
  vi.stubGlobal("navigator", { onLine: true });

  mocks.putPendingVisitStatus.mockImplementation(
    async (item: PendingVisitStatus) => {
      if (store.has(item.key)) return "duplicate";
      store.set(item.key, item);
      return "queued";
    },
  );
  mocks.listPendingVisitStatuses.mockImplementation(async () => [
    ...store.values(),
  ]);
  mocks.removePendingVisitStatus.mockImplementation(async (key: string) => {
    store.delete(key);
  });
  mocks.clearPendingVisitStatuses.mockImplementation(async () => {
    store.clear();
  });
});

describe("queueVisitStatus", () => {
  it("lagrer statusen med idempotensnøkkel for visitt, status og tidspunkt", async () => {
    const at = Date.now() - 60_000;

    await expect(
      queueVisitStatus({ visitId: "visit-1", status: "ON_SITE", at }),
    ).resolves.toBe("queued");

    expect(mocks.putPendingVisitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `visit-1:ON_SITE:${at}`,
        visitId: "visit-1",
        status: "ON_SITE",
        at,
      }),
    );
    expect(store.size).toBe(1);
  });

  it("legger samme handling bare én gang i køen", async () => {
    const at = Date.now() - 60_000;

    await expect(
      queueVisitStatus({ visitId: "visit-1", status: "EN_ROUTE", at }),
    ).resolves.toBe("queued");
    await expect(
      queueVisitStatus({ visitId: "visit-1", status: "EN_ROUTE", at }),
    ).resolves.toBe("duplicate");

    expect(store.size).toBe(1);
  });

  it("avviser statuser som ikke kan registreres offline", async () => {
    await expect(
      queueVisitStatus({
        visitId: "visit-1",
        // Fullføring krever rapport og PDF og skal aldri køes.
        status: "DONE" as never,
        at: Date.now(),
      }),
    ).resolves.toBe("invalid");

    expect(mocks.putPendingVisitStatus).not.toHaveBeenCalled();
  });

  it("avviser et tidsstempel utenfor vinduet", async () => {
    await expect(
      queueVisitStatus({
        visitId: "visit-1",
        status: "EN_ROUTE",
        at: Date.now() - VISIT_STATUS_MAX_AGE_MS - 1,
      }),
    ).resolves.toBe("invalid");

    expect(mocks.putPendingVisitStatus).not.toHaveBeenCalled();
  });
});

describe("listPendingVisitStatuses", () => {
  it("sorterer kronologisk, slik at avreise sendes før ankomst", () => {
    const enRoute = pending({ status: "EN_ROUTE", at: 1_000 });
    const onSite = pending({ status: "ON_SITE", at: 2_000 });

    expect(sortPendingVisitStatuses([onSite, enRoute])).toEqual([
      enRoute,
      onSite,
    ]);
  });

  it("holder hver brukers kø for seg", async () => {
    store.set("a", pending({ key: "a", userId: "u1" }));
    store.set("b", pending({ key: "b", userId: "u2" }));
    store.set("c", pending({ key: "c", userId: null }));

    const mine = await listPendingVisitStatuses("u1");

    // Poster uten kjent eier er lagt inn før innloggingen rakk å huske
    // brukeren, og skal ikke bli liggende igjen for alltid.
    expect(mine.map((item) => item.key)).toEqual(["a", "c"]);
  });
});

describe("flushVisitStatuses", () => {
  it("sender i rekkefølge og sletter det serveren kvitterer for", async () => {
    const at = Date.now() - 60_000;
    store.set("late", pending({ key: "late", status: "ON_SITE", at: at + 1_000 }));
    store.set("early", pending({ key: "early", status: "EN_ROUTE", at, userId: null }));

    const send = vi.fn<VisitStatusSender>(async () => ({ ok: true }));
    const result = await flushVisitStatuses(send);

    expect(send.mock.calls.map(([item]) => item.key)).toEqual([
      "early",
      "late",
    ]);
    // Tidsstempelet sendes uendret – det er hele poenget med køen.
    expect(send.mock.calls[0][0].at).toBe(at);
    expect(result).toEqual({ sent: 2, discarded: 0, pending: 0 });
    expect(store.size).toBe(0);
  });

  it("sender ikke samme post fra to samtidige tømminger", async () => {
    store.set("first", pending({ key: "first" }));

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn<VisitStatusSender>(async () => {
      await gate;
      return { ok: true };
    });

    const first = flushVisitStatuses(send);
    const second = await flushVisitStatuses(send);
    release();
    const firstResult = await first;

    expect(send).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
    expect(firstResult.sent).toBe(1);
  });

  it("beholder posten og stopper når sendingen feiler av nettårsaker", async () => {
    store.set("first", pending({ key: "first", at: Date.now() - 120_000 }));
    store.set("second", pending({ key: "second", at: Date.now() - 60_000 }));

    const send = vi
      .fn<VisitStatusSender>()
      .mockResolvedValueOnce({ ok: false, retryable: true, error: "http-503" })
      .mockResolvedValue({ ok: true });

    const result = await flushVisitStatuses(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 0, discarded: 0, pending: 2 });
    expect(store.has("first")).toBe(true);
    expect(store.has("second")).toBe(true);
  });

  it("beholder posten når kallet kaster (nettet forsvant)", async () => {
    store.set("first", pending({ key: "first" }));

    const send = vi
      .fn<VisitStatusSender>()
      .mockRejectedValue(new Error("offline"));

    const result = await flushVisitStatuses(send);

    expect(result).toEqual({ sent: 0, discarded: 0, pending: 1 });
    expect(store.has("first")).toBe(true);
  });

  it("fjerner en definitiv avvisning så den ikke blokkerer senere arbeid", async () => {
    store.set("rejected", pending({ key: "rejected", at: Date.now() - 120_000 }));
    store.set("next", pending({ key: "next", at: Date.now() - 60_000 }));

    const send = vi
      .fn<VisitStatusSender>()
      .mockResolvedValueOnce({
        ok: false,
        retryable: false,
        error: "statusTransition",
      })
      .mockResolvedValue({ ok: true });

    const result = await flushVisitStatuses(send);

    expect(result).toEqual({ sent: 1, discarded: 1, pending: 0 });
    expect(store.size).toBe(0);
  });

  it("rydder et tidsstempel serveren uansett ville avvist", async () => {
    const expired = pending({
      key: "expired",
      at: Date.now() - VISIT_STATUS_MAX_AGE_MS - 1,
    });
    store.set("expired", expired);

    const send = vi.fn<VisitStatusSender>(async () => ({ ok: true }));
    const result = await flushVisitStatuses(send);

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, discarded: 1, pending: 0 });
  });

  it("sender ingenting når nettleseren er offline", async () => {
    store.set("first", pending({ key: "first" }));
    vi.stubGlobal("navigator", { onLine: false });

    const send = vi.fn<VisitStatusSender>(async () => ({ ok: true }));
    const result = await flushVisitStatuses(send);

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, discarded: 0, pending: 1 });
  });
});

describe("clearVisitStatusOutbox", () => {
  it("tømmer hele køen", async () => {
    store.set("first", pending({ key: "first" }));

    await clearVisitStatusOutbox();

    expect(store.size).toBe(0);
  });
});
