import { describe, expect, it } from "vitest";
import type { SearchGroup } from "@/lib/search";
import {
  bestHits,
  buildSearchHref,
  groupRange,
  paginationInfo,
  parsePageNumber,
  parseSearchPageParams,
} from "./search-params";

function group(overrides: Partial<SearchGroup> = {}): SearchGroup {
  return {
    kind: "workOrder",
    label: "Oppdrag",
    icon: "📂",
    total: 0,
    items: [],
    ...overrides,
  };
}

describe("parseSearchPageParams", () => {
  it("leser q, side og alle gyldige filtre", () => {
    const parsed = parseSearchPageParams({
      q: "  pumpe  ",
      page: "3",
      types: "workOrder,report",
      status: "completed",
      customer: "cust-1",
      technician: "user_1",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      tag: "HMS",
      hmsType: "sja",
    });

    expect(parsed.query).toBe("pumpe");
    expect(parsed.page).toBe(3);
    expect(parsed.filters).toEqual({
      types: ["workOrder", "report"],
      status: "COMPLETED",
      customer: "cust-1",
      technician: "user_1",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      tag: "HMS",
      hmsType: "SJA",
    });
  });

  it("forkaster ugyldige filterverdier og bruker side 1", () => {
    const parsed = parseSearchPageParams({
      page: "-4",
      types: "ukjent,<script>",
      status: "SLETTET",
      customer: "<script>",
      dateFrom: "2026-02-31",
      hmsType: "FEIL",
    });

    expect(parsed.page).toBe(1);
    expect(parsed.filters).toEqual({});
  });

  it("begrenser query til 100 tegn", () => {
    expect(parseSearchPageParams({ q: "x".repeat(140) }).query).toHaveLength(100);
  });
});

describe("parsePageNumber", () => {
  it("håndterer tall, arrays og ugyldige verdier", () => {
    expect(parsePageNumber("7")).toBe(7);
    expect(parsePageNumber(["4", "9"])).toBe(4);
    expect(parsePageNumber("abc")).toBe(1);
    expect(parsePageNumber(undefined)).toBe(1);
    expect(parsePageNumber("999999")).toBe(10_000);
  });
});

describe("buildSearchHref", () => {
  it("bevarer q, side og filtre", () => {
    const href = buildSearchHref({
      q: "årlig service",
      page: 2,
      filters: {
        types: ["workOrder", "customer"],
        status: "PLANNED",
        dateFrom: "2026-03-01",
        tag: "HMS",
      },
    });

    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/sok");
    expect(url.searchParams.get("q")).toBe("årlig service");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("types")).toBe("workOrder,customer");
    expect(url.searchParams.get("status")).toBe("PLANNED");
    expect(url.searchParams.get("dateFrom")).toBe("2026-03-01");
    expect(url.searchParams.get("tag")).toBe("HMS");
  });

  it("utelater side 1 og tomme verdier", () => {
    expect(buildSearchHref({ q: "pumpe", page: 1 })).toBe("/sok?q=pumpe");
    expect(buildSearchHref({ q: "" })).toBe("/sok");
  });

  it("fjerner filtre men beholder q for «fjern filtre»", () => {
    expect(buildSearchHref({ q: "pumpe", filters: {} })).toBe("/sok?q=pumpe");
  });

  it("legger til statusparametre uten å overskrive filtre", () => {
    const href = buildSearchHref({
      q: "pumpe",
      filters: { status: "OPEN" },
      extra: { lagre: "lagret" },
    });
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("status")).toBe("OPEN");
    expect(url.searchParams.get("lagre")).toBe("lagret");
  });
});

describe("paginationInfo", () => {
  it("bruker gruppen med flest treff", () => {
    const info = paginationInfo(
      [group({ total: 3 }), group({ kind: "customer", total: 45 })],
      2,
      20,
    );
    expect(info).toEqual({ totalPages: 3, hasPrevious: true, hasNext: true });
  });

  it("gir alltid minst én side", () => {
    expect(paginationInfo([], 1)).toEqual({
      totalPages: 1,
      hasPrevious: false,
      hasNext: false,
    });
  });
});

describe("groupRange", () => {
  it("regner ut intervallet for gjeldende side", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      title: "Treff",
      href: "/",
    }));
    expect(groupRange({ items }, 2, 20)).toEqual({ from: 21, to: 25 });
    expect(groupRange({ items: [] }, 2, 20)).toBeNull();
  });
});

describe("bestHits", () => {
  it("sorterer på tvers av grupper og begrenser til fem", () => {
    const hits = bestHits(
      [
        group({
          kind: "customer",
          label: "Kunder",
          items: [
            { id: "a", title: "A", href: "/a", score: 0.2 },
            { id: "b", title: "B", href: "/b", score: 0.9 },
          ],
        }),
        group({
          kind: "workOrder",
          items: [
            { id: "c", title: "C", href: "/c", score: 0.7 },
            { id: "d", title: "D", href: "/d" },
          ],
        }),
      ],
      2,
    );

    expect(hits.map((hit) => hit.id)).toEqual(["b", "c"]);
    expect(hits[0]).toMatchObject({ kind: "customer", label: "Kunder" });
  });
});
