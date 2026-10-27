import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  performSearch: vi.fn<
    (query: string, options: unknown) => Promise<{
      query: string;
      total: number;
      groups: unknown[];
      tookMs?: number;
    }>
  >(async () => ({ query: "kari", total: 0, groups: [] })),
  allowRequestDb: vi.fn(async () => ({ allowed: true })),
  logSearch: vi.fn(async () => undefined),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/search", () => ({ performSearch: mocks.performSearch }));
vi.mock("@/lib/rate-limit-db", () => ({ allowRequestDb: mocks.allowRequestDb }));
vi.mock("@/server/search-analytics", () => ({ logSearch: mocks.logSearch }));

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
  mocks.logSearch.mockResolvedValue(undefined);
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

  it("sender filtre og paginering videre og logger søket", async () => {
    mocks.performSearch.mockResolvedValue({
      query: "pumpe",
      total: 3,
      groups: [],
      tookMs: 12,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/search?q=pumpe&types=report&hmsType=SJA&status=COMPLETED&page=2&pageSize=20",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.performSearch).toHaveBeenCalledWith(
      "pumpe",
      expect.objectContaining({
        page: 2,
        pageSize: 20,
        filters: expect.objectContaining({
          types: ["report"],
          hmsType: "SJA",
          status: "COMPLETED",
        }),
      }),
    );
    expect(mocks.logSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        query: "pumpe",
        resultCount: 3,
        latencyMs: 12,
      }),
    );
  });

  it("kapper pageSize og logger ikke tomme søk", async () => {
    await GET(new Request("http://localhost/api/search?q=&pageSize=9999"));

    expect(mocks.performSearch).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ pageSize: 50 }),
    );
    expect(mocks.logSearch).not.toHaveBeenCalled();
  });

  it("avviser ugyldige filterverdier før de når søket", async () => {
    await GET(
      new Request(
        "http://localhost/api/search?q=kari&status=HEMMELIG&hmsType=UKJENT&dateFrom=i-går&customer=<script>",
      ),
    );

    expect(mocks.performSearch).toHaveBeenCalledWith(
      "kari",
      expect.objectContaining({ filters: {} }),
    );
  });
});
