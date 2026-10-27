import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  performSearch: vi.fn(async () => ({ query: "kari", total: 0, groups: [] })),
  allowRequestDb: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/search", () => ({ performSearch: mocks.performSearch }));
vi.mock("@/lib/rate-limit-db", () => ({ allowRequestDb: mocks.allowRequestDb }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
  });
  mocks.allowRequestDb.mockResolvedValue({ allowed: true });
  mocks.performSearch.mockResolvedValue({ query: "kari", total: 0, groups: [] });
});

describe("/api/search", () => {
  it("nekter kundeportal og inaktive brukere", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "c1",
      role: "CUSTOMER",
      isActive: true,
    });
    expect((await GET(new Request("http://localhost/api/search?q=kari"))).status).toBe(403);

    mocks.getCurrentUser.mockResolvedValue({
      id: "u1",
      role: "OFFICE",
      isActive: false,
    });
    expect((await GET(new Request("http://localhost/api/search?q=kari"))).status).toBe(403);
  });

  it("returnerer søkeresultatet uten mellomlagring", async () => {
    const response = await GET(new Request("http://localhost/api/search?q=kari"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      query: "kari",
      total: 0,
      groups: [],
    });
  });
});
