import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearOfflineData: vi.fn(),
}));

vi.mock("./db", () => ({ clearOfflineData: mocks.clearOfflineData }));

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
  it("fjerner offline-data og nylige søk ved utlogging", async () => {
    await clearOfflineCaches();

    expect(mocks.clearOfflineData).toHaveBeenCalled();
    expect(localStorage.getItem("fsm:recent-searches")).toBeNull();
    expect(localStorage.getItem("fsm:offline-user")).toBeNull();
  });
});
