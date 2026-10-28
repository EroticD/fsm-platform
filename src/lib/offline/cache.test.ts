import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forgetOfflineUser: vi.fn(),
}));

vi.mock("./draft-outbox", () => ({
  forgetOfflineUser: mocks.forgetOfflineUser,
}));

import { clearOfflineCaches } from "./cache";

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
});

describe("clearOfflineCaches", () => {
  it("fjerner cacher og nylige søk, men beholder ventende kladder", async () => {
    await clearOfflineCaches();

    expect(mocks.forgetOfflineUser).toHaveBeenCalled();
    expect(localStorage.getItem("fsm:recent-searches")).toBeNull();
  });
});
