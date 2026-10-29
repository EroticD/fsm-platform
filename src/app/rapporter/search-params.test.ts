import { describe, expect, it } from "vitest";
import {
  parseReportListParams,
  reportListHref,
  reportListOrderBy,
  reportListWhere,
  REPORTS_PAGE_SIZE,
} from "./search-params";

function filters(overrides: Partial<Parameters<typeof reportListHref>[0]["filters"]> = {}) {
  return {
    range: "denne-maneden" as const,
    deviationOnly: false,
    q: "",
    sort: "dato-desc" as const,
    ...overrides,
  };
}

describe("parseReportListParams", () => {
  it("leser alle gyldige filtre og sortering", () => {
    const parsed = parseReportListParams({
      vis: "alle",
      type: "HMS",
      kunde: "cust-1",
      montor: "user_2",
      avvik: "1",
      q: "  pumpe  ",
      sorter: "kunde",
      side: "3",
    });

    expect(parsed).toEqual({
      range: "alle",
      category: "HMS",
      customer: "cust-1",
      technician: "user_2",
      deviationOnly: true,
      q: "pumpe",
      sort: "kunde",
      page: 3,
    });
  });

  it("forkaster ugyldige verdier og bruker standardene", () => {
    const parsed = parseReportListParams({
      vis: "i-fjor",
      type: "SERVICE",
      kunde: "<script>",
      montor: "a".repeat(65),
      avvik: "ja",
      q: "x".repeat(140),
      sorter: "tilfeldig",
      side: "-2",
    });

    expect(parsed).toEqual({
      range: "denne-maneden",
      category: undefined,
      customer: undefined,
      technician: undefined,
      deviationOnly: false,
      q: "x".repeat(100),
      sort: "dato-desc",
      page: 1,
    });
  });
});

describe("reportListWhere", () => {
  it("beholder grunnfilteret og legger til kunde, montør, avvik og fritekst", () => {
    const where = reportListWhere(
      filters({
        customer: "cust-1",
        technician: "user-2",
        deviationOnly: true,
        q: "pumpe",
      }),
    );

    const parts = where.AND as Array<Record<string, unknown>>;
    expect(parts[0]).toHaveProperty("AND");
    expect(parts).toContainEqual({
      workOrder: { customerId: "cust-1" },
    });
    expect(parts).toContainEqual({
      workOrder: { technicians: { some: { id: "user-2" } } },
    });
    expect(parts).toContainEqual({
      requiresUnits: true,
      units: { some: { status: "AVVIK" } },
    });
    expect(JSON.stringify(parts)).toContain('"contains":"pumpe"');
    expect(JSON.stringify(parts)).toContain('"technicianName"');
  });

  it("legger ikke på tomme filtre", () => {
    const where = reportListWhere(filters());
    expect(where.AND).toHaveLength(1);
  });

  it("legger rapportomfanget på oppdraget uten å overstyre filtrene", () => {
    const where = reportListWhere(filters({ q: "pumpe" }), false, {
      departmentId: "dep-a",
      department: { isActive: true },
      deletedAt: null,
    });

    const parts = where.AND as Array<Record<string, unknown>>;
    expect(parts).toContainEqual({
      workOrder: {
        departmentId: "dep-a",
        department: { isActive: true },
        deletedAt: null,
      },
    });
    expect(JSON.stringify(parts)).toContain('"contains":"pumpe"');
  });
});

describe("reportListOrderBy", () => {
  it("bruker en stabil id som siste sorteringsnøkkel", () => {
    expect(reportListOrderBy("dato-desc")).toEqual([
      { completedAt: "desc" },
      { id: "asc" },
    ]);
    expect(reportListOrderBy("kunde")).toEqual([
      { workOrder: { customer: { name: "asc" } } },
      { completedAt: "desc" },
      { id: "asc" },
    ]);
  });
});

describe("reportListHref", () => {
  it("utelater standardverdier og bevarer filtre", () => {
    expect(reportListHref({ filters: filters() })).toBe("/rapporter");

    expect(
      reportListHref({
        filters: filters({
          range: "alle",
          category: "HMS",
          customer: "cust-1",
          technician: "user-2",
          deviationOnly: true,
          q: "pumpe",
          sort: "montor",
        }),
        page: 2,
      }),
    ).toBe(
      "/rapporter?vis=alle&type=HMS&kunde=cust-1&montor=user-2&avvik=1&q=pumpe&sorter=montor&side=2",
    );
  });

  it("nullstiller siden når et filter endres", () => {
    expect(
      reportListHref({
        filters: filters({ q: "gammelt" }),
        overrides: { q: "nytt" },
      }),
    ).toBe("/rapporter?q=nytt");
  });

  it("har en sidestørrelse på 20", () => {
    expect(REPORTS_PAGE_SIZE).toBe(20);
  });
});
