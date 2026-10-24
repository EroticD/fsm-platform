import { describe, expect, it } from "vitest";
import { fuzzyScore, normalizeSearchText } from "@/lib/fuzzy";
import {
  reportSearchWhere,
  workOrderListSearchWhere,
  workOrderTagWhere,
} from "@/lib/search-filters";

describe("normalizeSearchText", () => {
  it("bretter æ/ø/å, aksenter og store bokstaver", () => {
    expect(normalizeSearchText("Årlig service")).toBe("arlig service");
    expect(normalizeSearchText("Ærlig Øvelse")).toBe("aerlig ovelse");
    expect(normalizeSearchText("Café Crème")).toBe("cafe creme");
  });

  it("fjerner tegnsetting og kollapser mellomrom", () => {
    expect(normalizeSearchText("arlig-service")).toBe("arlig service");
    expect(normalizeSearchText("  2026-1042 / NO  ")).toBe("2026 1042 no");
    expect(normalizeSearchText("a---b___c")).toBe("a b c");
  });
});

describe("fuzzyScore med normaliserte delstrenger", () => {
  it("matcher spesialtegn og bindestrek midt i et navn", () => {
    expect(fuzzyScore("arlig-service", "Årlig service")).toBe(1);
    expect(fuzzyScore("service", "Årlig service")).toBe(1);
  });

  it("matcher ordrenummer uten bindestrek", () => {
    expect(fuzzyScore("2026-1042", "NO-2026-1042")).toBe(1);
    expect(fuzzyScore("1042", "NO-2026-1042")).toBe(1);
  });

  it("matcher delstreng midt i en tittel", () => {
    expect(fuzzyScore("service", "Årlig service og kontroll")).toBe(1);
    expect(fuzzyScore("kontroll", "Årlig service og kontroll")).toBe(1);
  });
});

describe("workOrderListSearchWhere", () => {
  it("søker i ordrenummer og tagger, også i normalisert form", () => {
    const where = workOrderListSearchWhere("2026-1042");
    const json = JSON.stringify(where);

    expect(json).toContain('"orderNumber"');
    expect(json).toContain('"tags"');
    expect(json).toContain("2026-1042");
    expect(json).toContain("2026 1042");
  });

  it("tar med id-er fra normalisert SQL-søk", () => {
    const where = workOrderListSearchWhere("arlig-service", ["wo-1", "wo-2"]);
    expect(JSON.stringify(where)).toContain('"id":{"in":["wo-1","wo-2"]}');
  });

  it("gir tomt filter uten søkeord", () => {
    expect(workOrderListSearchWhere("   ")).toEqual({});
  });
});

describe("workOrderTagWhere", () => {
  it("filtrerer på eksakt tag-navn", () => {
    expect(workOrderTagWhere("Service")).toEqual({
      tags: { some: { name: "Service" } },
    });
    expect(workOrderTagWhere("")).toEqual({});
    expect(workOrderTagWhere(null)).toEqual({});
  });
});

describe("reportSearchWhere", () => {
  it("deler rapporter på tvers av avdelinger", () => {
    const where = reportSearchWhere("pumpe", false);
    const json = JSON.stringify(where);

    expect(where.comments).toEqual({ contains: "pumpe", mode: "insensitive" });
    expect(where.deletedAt).toBeNull();
    expect((where.workOrder as { deletedAt?: null }).deletedAt).toBeNull();
    // Ingen avdelingsbegrensning – rapporter er felles for ansatte.
    expect(json).not.toContain("departmentId");
    expect(json).not.toContain("workOrderScope");
  });

  it("utelater kansellerte oppdrag med mindre de er bestilt", () => {
    expect(JSON.stringify(reportSearchWhere("pumpe", false))).toContain(
      '"status":{"not":"CANCELLED"}',
    );
    expect(JSON.stringify(reportSearchWhere("pumpe", true))).not.toContain(
      '"status"',
    );
  });
});
