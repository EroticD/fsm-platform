import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_SYNC_TAG,
  SYNC_END_EVENT,
  SYNC_PROGRESS_EVENT,
  SYNC_START_EVENT,
  emitSyncEnd,
  emitSyncProgress,
  emitSyncStart,
  requestDraftBackgroundSync,
  type SyncResultDetail,
} from "./sync";

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestDraftBackgroundSync", () => {
  it("registrerer den stabile taggen når SyncManager finnes", async () => {
    const register = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({})),
        ready: Promise.resolve({ sync: { register } }),
      },
    });

    await expect(requestDraftBackgroundSync()).resolves.toBe(true);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(DRAFT_SYNC_TAG);
    expect(DRAFT_SYNC_TAG).toBe("fsm-draft-sync");
  });

  it("er en no-op uten service worker", async () => {
    vi.stubGlobal("navigator", {});

    await expect(requestDraftBackgroundSync()).resolves.toBe(false);
  });

  it("er en no-op når SyncManager mangler", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({})),
        ready: Promise.resolve({}),
      },
    });

    await expect(requestDraftBackgroundSync()).resolves.toBe(false);
  });

  it("er en no-op når ingen service worker er registrert", async () => {
    const ready = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => undefined),
        ready: { then: ready },
      },
    });

    await expect(requestDraftBackgroundSync()).resolves.toBe(false);
    expect(ready).not.toHaveBeenCalled();
  });

  it("svelger avvist registrering og kaster aldri", async () => {
    const register = vi.fn(async () => {
      throw new Error("permission denied");
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({})),
        ready: Promise.resolve({ sync: { register } }),
      },
    });

    await expect(requestDraftBackgroundSync()).resolves.toBe(false);
  });
});

describe("synkestatus-events", () => {
  it("sender typede start-, fremdrifts- og slutt-events", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const seen: Array<{ type: string; detail: SyncResultDetail }> = [];
    for (const type of [SYNC_START_EVENT, SYNC_PROGRESS_EVENT, SYNC_END_EVENT]) {
      target.addEventListener(type, (event) => {
        seen.push({
          type,
          detail: (event as CustomEvent<SyncResultDetail>).detail,
        });
      });
    }

    emitSyncStart({ sent: 0, pending: 2, failed: 0 });
    emitSyncProgress({ sent: 1, pending: 1, failed: 0 });
    emitSyncEnd({ sent: 2, pending: 0, failed: 0 });

    expect(seen).toEqual([
      {
        type: SYNC_START_EVENT,
        detail: { sent: 0, pending: 2, failed: 0 },
      },
      {
        type: SYNC_PROGRESS_EVENT,
        detail: { sent: 1, pending: 1, failed: 0 },
      },
      {
        type: SYNC_END_EVENT,
        detail: { sent: 2, pending: 0, failed: 0 },
      },
    ]);
  });

  it("er en no-op uten window", () => {
    expect(() =>
      emitSyncStart({ sent: 0, pending: 1, failed: 0 }),
    ).not.toThrow();
  });
});
