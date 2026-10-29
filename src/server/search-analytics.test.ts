import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  aggregate: vi.fn(),
  groupBy: vi.fn(),
  create: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    searchLog: {
      count: mocks.count,
      aggregate: mocks.aggregate,
      groupBy: mocks.groupBy,
      create: mocks.create,
    },
    $queryRaw: mocks.queryRaw,
  },
}));

import { getSearchAnalytics, logSearch } from "./search-analytics";

function actor(
  permissions: string[],
  overrides: Partial<ServiceActor> = {},
): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(0);
  mocks.aggregate.mockResolvedValue({ _avg: { latencyMs: null } });
  mocks.groupBy.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "log-1" });
  mocks.queryRaw.mockResolvedValue([]);
});

describe("logSearch", () => {
  it("lagrer normalisert søk, treff, tid og filtre uten brukerkobling", async () => {
    await logSearch({
      query: "  Årlig Service  ",
      resultCount: 4,
      latencyMs: 17,
      filters: { status: "COMPLETED", customer: "cust-1" },
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        query: "Årlig Service",
        normalizedQuery: "arlig service",
        resultCount: 4,
        latencyMs: 17,
        filters: { status: "COMPLETED", customer: "cust-1" },
      }),
    });
    const data = mocks.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("userId");
  });

  it("maskerer personopplysninger før query og normalizedQuery lagres", async () => {
    await logSearch({
      query: "kunde kari@example.com tlf 12 34 56 78 org 123 456 789",
      resultCount: 1,
      latencyMs: 3,
    });

    const data = mocks.create.mock.calls[0][0].data as {
      query: string;
      normalizedQuery: string;
    };
    expect(data.query).toBe(
      "kunde [epost] tlf [telefon] org [orgnr]",
    );
    expect(data.normalizedQuery).toBe(
      "kunde epost tlf telefon org orgnr",
    );
  });

  it("kapper lange søk og dropper tomme", async () => {
    await logSearch({ query: "a".repeat(500), resultCount: 0, latencyMs: 1 });
    const data = mocks.create.mock.calls[0][0].data as { query: string };
    expect(data.query).toHaveLength(100);

    mocks.create.mockClear();
    await logSearch({ query: "   ", resultCount: 0, latencyMs: 1 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("feiler stille når logging ikke er mulig", async () => {
    mocks.create.mockRejectedValueOnce(new Error("db nede"));
    await expect(
      logSearch({ query: "pumpe", resultCount: 1, latencyMs: 2 }),
    ).resolves.toBeUndefined();
  });
});

describe("getSearchAnalytics", () => {
  it("krever audit.view eller administrator", async () => {
    const technician = actor(["workorders.view"]);
    await expect(getSearchAnalytics(technician)).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });

    await expect(
      getSearchAnalytics(actor([], { role: "TECHNICIAN" })),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("returnerer totaler, nulltreff, latens og tidsserie", async () => {
    mocks.count.mockResolvedValueOnce(20).mockResolvedValueOnce(5);
    mocks.aggregate.mockResolvedValueOnce({ _avg: { latencyMs: 42.6 } });
    mocks.groupBy
      .mockResolvedValueOnce([
        { normalizedQuery: "pumpe", _count: { _all: 6 } },
      ])
      .mockResolvedValueOnce([
        { normalizedQuery: "ukjent", _count: { _all: 3 } },
      ]);
    mocks.queryRaw.mockResolvedValueOnce([
      { date: new Date("2026-10-01T00:00:00Z"), count: 7, zero_count: 2 },
    ]);

    const result = await getSearchAnalytics(actor(["audit.view"]), 14);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.days).toBe(14);
    expect(result.data.totalSearches).toBe(20);
    expect(result.data.zeroResultCount).toBe(5);
    expect(result.data.zeroResultRate).toBe(0.25);
    expect(result.data.averageLatencyMs).toBe(43);
    expect(result.data.topQueries).toEqual([{ query: "pumpe", count: 6 }]);
    expect(result.data.topZeroResultQueries).toEqual([
      { query: "ukjent", count: 3 },
    ]);
    expect(result.data.daily).toEqual([
      { date: "2026-10-01", count: 7, zeroResultCount: 2 },
    ]);
  });

  it("maskerer søketekst også når den leses ut", async () => {
    mocks.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    mocks.groupBy
      .mockResolvedValueOnce([
        {
          normalizedQuery: "kari@example.com",
          _min: { query: "Kari@Example.com" },
          _count: { _all: 1 },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getSearchAnalytics(actor([], { role: "ADMIN" }), 7);
    expect(result.ok && result.data.topQueries).toEqual([
      { query: "[epost]", count: 1 },
    ]);
  });

  it("klemmer antall dager til 1–365", async () => {
    const thousand = await getSearchAnalytics(actor([], { role: "ADMIN" }), 1000);
    expect(thousand.ok && thousand.data.days).toBe(365);

    const zero = await getSearchAnalytics(actor([], { role: "ADMIN" }), 0);
    expect(zero.ok && zero.data.days).toBe(1);
  });
});
