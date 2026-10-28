import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forgetOfflineUser: vi.fn(),
}));

vi.mock("./draft-outbox", () => ({
  forgetOfflineUser: mocks.forgetOfflineUser,
}));

import {
  clearOfflineCaches,
  clearOfflinePage,
  offlinePageCacheName,
} from "./cache";

type FakeCache = {
  keys: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function request(path: string): Request {
  return new Request(`https://fsm.example${path}`);
}

function installCaches(requests: Request[]) {
  const pageCache: FakeCache = {
    keys: vi.fn(async () => [...requests]),
    delete: vi.fn(async (entry: Request) => {
      const index = requests.findIndex((item) => item.url === entry.url);
      if (index >= 0) requests.splice(index, 1);
      return true;
    }),
  };
  const deleteCache = vi.fn(async () => true);
  const cacheStorage = {
    keys: vi.fn(async () => [
      offlinePageCacheName("u1"),
      offlinePageCacheName("u2"),
    ]),
    has: vi.fn(
      async (name: string) => name === offlinePageCacheName("u1"),
    ),
    open: vi.fn(async (name: string) => {
      if (name !== offlinePageCacheName("u1")) {
        throw new Error(`Ukjent cache ${name}`);
      }
      return pageCache;
    }),
    delete: deleteCache,
  };
  vi.stubGlobal("caches", cacheStorage);
  return { pageCache, cacheStorage, deleteCache };
}

beforeEach(() => {
  vi.clearAllMocks();
  const store = new Map<string, string>([
    ["fsm:recent-searches", '["kunde"]'],
    ["fsm:offline-user", "u1"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  const postMessage = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: { controller: { postMessage } },
  });
});

describe("clearOfflineCaches", () => {
  it("fjerner cacher og nylige søk, men beholder ventende kladder", async () => {
    const { cacheStorage } = installCaches([]);

    await clearOfflineCaches();

    expect(mocks.forgetOfflineUser).toHaveBeenCalled();
    expect(localStorage.getItem("fsm:recent-searches")).toBeNull();
    expect(cacheStorage.keys).toHaveBeenCalled();
    expect(cacheStorage.delete).toHaveBeenCalledWith(
      offlinePageCacheName("u1"),
    );
    expect(cacheStorage.delete).toHaveBeenCalledWith(
      offlinePageCacheName("u2"),
    );
  });
});

describe("clearOfflinePage", () => {
  it("sletter bare den innsendte siden, både HTML og RSC", async () => {
    const formPath = "/mine-oppdrag/wo1/skjema/tpl1";
    const requests = [
      request(`${formPath}?__fsm=html`),
      request(`${formPath}?__fsm=rsc`),
      request("/mine-oppdrag/wo1?__fsm=html"),
      request("/mine-oppdrag/wo2/skjema/tpl1?__fsm=html"),
    ];
    const { pageCache, deleteCache } = installCaches(requests);

    await clearOfflinePage("u1", formPath);

    expect(pageCache.delete).toHaveBeenCalledTimes(2);
    expect(pageCache.delete.mock.calls.map((call) => call[0].url)).toEqual([
      `https://fsm.example${formPath}?__fsm=html`,
      `https://fsm.example${formPath}?__fsm=rsc`,
    ]);
    // Den øvrige side-cachen skal bestå.
    expect(deleteCache).not.toHaveBeenCalled();
    expect(requests.map((entry) => new URL(entry.url).pathname)).toEqual([
      "/mine-oppdrag/wo1",
      "/mine-oppdrag/wo2/skjema/tpl1",
    ]);
  });

  it("forteller servicearbeideren hvilken side som skal ryddes", async () => {
    installCaches([request("/mine-oppdrag/wo1/skjema/tpl1?__fsm=html")]);

    await clearOfflinePage("u1", "/mine-oppdrag/wo1/skjema/tpl1");

    expect(navigator.serviceWorker.controller?.postMessage).toHaveBeenCalledWith(
      {
        type: "CLEAR_PAGE",
        userId: "u1",
        path: "/mine-oppdrag/wo1/skjema/tpl1",
      },
    );
  });
});
