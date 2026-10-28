import { describe, expect, it } from "vitest";
import { fuzzyScore, normalizeSearchCompact, normalizeSearchText } from "@/lib/fuzzy";
import {
  parseSearchFilters,
  reportSearchWhere,
  serializeSearchFilters,
  workOrderFilterWhere,
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

describe("normalizeSearchCompact", () => {
  it("fjerner separatorer fra telefon, orgnummer og kundenummer", () => {
    expect(normalizeSearchCompact("+47 123 45 678")).toBe("4712345678");
    expect(normalizeSearchCompact("123 456 789")).toBe("123456789");
    expect(normalizeSearchCompact("K-100")).toBe("k100");
    expect(normalizeSearchCompact("NO-2026-1042")).toBe("no20261042");
  });

  it("fjerner tegnsetting og æ/ø/å på samme måte som normalizeSearchText", () => {
    expect(normalizeSearchCompact("Faktura #123 (kunde).pdf")).toBe(
      "faktura123kundepdf",
    );
    expect(normalizeSearchCompact("Årlig-service")).toBe("arligservice");
    expect(normalizeSearchCompact(" --- ")).toBe("");
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

describe("parseSearchFilters", () => {
  it("leser og validerer URL-filtre", () => {
    const params = new URLSearchParams(
      "types=report,workOrder&status=completed&customer=cust-1&technician=tech-1&dateFrom=2026-01-01&dateTo=2026-01-31&tag=Service&hmsType=sja",
    );

    expect(parseSearchFilters(params)).toEqual({
      types: ["report", "workOrder"],
      status: "COMPLETED",
      customer: "cust-1",
      technician: "tech-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      tag: "Service",
      hmsType: "SJA",
    });
  });

  it("forkaster ukjente grupper, statuser, HMS-typer og utrygge id-er", () => {
    expect(
      parseSearchFilters({
        types: ["report", "hemmelig", "drop table"],
        status: "HEMMELIG",
        customer: "<script>alert(1)</script>",
        technician: "x".repeat(100),
        dateFrom: "2026-13-99",
        dateTo: "i går",
        hmsType: "UKJENT",
      }),
    ).toEqual({ types: ["report"] });
  });

  it("godtar både gjentatte parametre og kommalister", () => {
    const params = new URLSearchParams();
    params.append("types", "report");
    params.append("types", "unit,tag");
    expect(parseSearchFilters(params).types).toEqual(["report", "unit", "tag"]);
  });
});

describe("serializeSearchFilters", () => {
  it("gir en URL-query som kan leses tilbake", () => {
    const serialized = serializeSearchFilters({
      types: ["report"],
      status: "COMPLETED",
      tag: "Årlig service",
      customer: "cust-1",
    });
    const parsed = parseSearchFilters(new URLSearchParams(serialized));

    expect(parsed).toEqual({
      types: ["report"],
      status: "COMPLETED",
      customer: "cust-1",
      tag: "Årlig service",
    });
    expect(serialized).not.toContain("<?");
  });

  it("gir tom streng uten filtre", () => {
    expect(serializeSearchFilters({})).toBe("");
    expect(serializeSearchFilters(null)).toBe("");
  });
});

describe("workOrderFilterWhere", () => {
  it("bygger Prisma-filter for status, kunde, montør, tag og dato", () => {
    const where = workOrderFilterWhere({
      status: "PLANNED",
      customer: "cust-1",
      technician: "tech-1",
      tag: "Service",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });

    expect(where.status).toBe("PLANNED");
    expect(where.customerId).toBe("cust-1");
    expect(where.technicians).toEqual({ some: { id: "tech-1" } });
    expect(where.tags).toEqual({ some: { name: "Service" } });
    expect(where.scheduledFor).toEqual({
      gte: new Date("2026-01-01T00:00:00.000Z"),
      lte: new Date("2026-01-31T23:59:59.999Z"),
    });
  });

  it("gir tomt filter uten verdier", () => {
    expect(workOrderFilterWhere({})).toEqual({});
  });
});
