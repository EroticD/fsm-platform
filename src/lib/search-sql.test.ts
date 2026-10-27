import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  default: { $queryRaw: mocks.queryRaw },
}));

import {
  isAllowedNameSearchField,
  isAllowedSubstringSearchField,
  searchByName,
  searchBySubstring,
  searchDocuments,
  searchNormalizedIds,
  searchReports,
  searchWorkOrderIds,
} from "@/lib/search-sql";

type SqlCall = { text: string; values: unknown[] };

function lastSql(): SqlCall {
  const call = mocks.queryRaw.mock.calls.at(-1);
  if (!call) throw new Error("Ingen SQL-spørring ble kjørt");
  return call[0] as SqlCall;
}

beforeEach(() => {
  mocks.queryRaw.mockClear();
});

describe("searchDocuments", () => {
  it("bruker fulltekstfunksjonene og returnerer bare et utdrag", async () => {
    await searchDocuments("pumpe", 10);
    const sql = lastSql();

    expect(sql.text).toContain("websearch_to_tsquery('norwegian'");
    expect(sql.text).toContain("ts_rank(");
    expect(sql.text).toContain("ts_headline(");
    expect(sql.text).toContain('"searchTsv"');
    // contentText kan brukes inne i ts_headline for å lage utdraget, men skal
    // ikke være en kolonne som returneres til Node.
    expect(sql.text).toMatch(
      /SELECT\s+d\."id",\s+d\."title",\s+d\."description",\s+d\."fileName",\s+d\."filePath",\s+ts_headline/,
    );
    expect(sql.text).not.toContain("pageTexts");
  });

  it("sender søkeordet som parameter, ikke som SQL-tekst", async () => {
    await searchDocuments("hydraulisk pumpe", 7);
    const sql = lastSql();

    expect(sql.text).not.toContain("hydraulisk pumpe");
    expect(sql.values).toContain("hydraulisk pumpe");
    expect(sql.values).toContain(7);
  });

  it("utelater mykt slettede dokumenter", async () => {
    await searchDocuments("pumpe", 10);
    expect(lastSql().text).toContain('d."deletedAt" IS NULL');
  });
});

describe("searchByName", () => {
  it("bruker similarity og trigram-operatoren", async () => {
    await searchByName("Customer", "name", "gardshol", 60);
    const sql = lastSql();

    expect(sql.text).toContain("similarity(");
    expect(sql.text).toContain(" % ");
    expect(sql.text).toContain('"Customer"');
    expect(sql.text).toContain('"name"');
    expect(sql.text).not.toContain("gardshol");
    expect(sql.values).toContain("gardshol");
  });

  it("avviser tabell/kolonne som ikke står i allowlisten", async () => {
    await expect(
      searchByName("Document" as never, "contentText" as never, "hemmelig", 10),
    ).rejects.toThrow("Ugyldig tabell/kolonne");

    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("utelater mykt slettede kunder og oppdrag, men ikke enheter", async () => {
    await searchByName("Customer", "name", "gardshol", 10);
    expect(lastSql().text).toContain('"Customer"."deletedAt" IS NULL');

    await searchByName("WorkOrder", "title", "service", 10);
    expect(lastSql().text).toContain('"WorkOrder"."deletedAt" IS NULL');

    await searchByName("Product", "model", "pumpe", 10);
    expect(lastSql().text).not.toContain("deletedAt");
  });

  it("vet hvilke kolonner som har trigram-indeks", () => {
    expect(isAllowedNameSearchField("Customer", "name")).toBe(true);
    expect(isAllowedNameSearchField("Customer", "city")).toBe(true);
    expect(isAllowedNameSearchField("Product", "model")).toBe(true);
    expect(isAllowedNameSearchField("WorkOrder", "title")).toBe(true);
    expect(isAllowedNameSearchField("Customer", "notes")).toBe(false);
    expect(isAllowedNameSearchField("Document", "contentText")).toBe(false);
  });
});

describe("searchBySubstring", () => {
  it("normaliserer ordrenummer og bruker delstrengsøk", async () => {
    await searchBySubstring("WorkOrder", "orderNumber", "2026-1042", 10);
    const sql = lastSql();

    expect(sql.text).toContain('"WorkOrder"."orderNumber"');
    expect(sql.text).toContain("unaccent");
    expect(sql.text).toContain("regexp_replace");
    expect(sql.text).toContain("strpos");
    expect(sql.text).toContain('"WorkOrder"."deletedAt" IS NULL');
    // Bindestreken er blitt mellomrom før den sendes til databasen.
    expect(sql.values).toContain("2026 1042");
    expect(sql.text).not.toContain("2026-1042");
  });

  it("søker i tag-navn uten slettemarkør", async () => {
    await searchBySubstring("Tag", "name", "Årlig-service", 10);
    const sql = lastSql();

    expect(sql.text).toContain('"Tag"."name"');
    expect(sql.text).not.toContain("deletedAt");
    expect(sql.values).toContain("arlig service");
  });

  it("avviser tabell/kolonne som ikke står i allowlisten", async () => {
    await expect(
      searchBySubstring("Document" as never, "contentText" as never, "hemmelig", 10),
    ).rejects.toThrow("Ugyldig tabell/kolonne");

    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("vet hvilke kolonner som kan delstrengsøkes", () => {
    expect(isAllowedSubstringSearchField("WorkOrder", "orderNumber")).toBe(true);
    expect(isAllowedSubstringSearchField("WorkOrder", "title")).toBe(true);
    expect(isAllowedSubstringSearchField("Tag", "name")).toBe(true);
    expect(isAllowedSubstringSearchField("Customer", "name")).toBe(false);
    expect(isAllowedSubstringSearchField("Document", "contentText")).toBe(false);
  });
});

describe("searchWorkOrderIds", () => {
  it("søker i ordrenummer, tagger og kundefelt med normalisert term", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "wo-1" }]);

    await expect(searchWorkOrderIds("2026-1042")).resolves.toEqual(["wo-1"]);
    const sql = lastSql();

    expect(sql.text).toContain('w."orderNumber"');
    expect(sql.text).toContain('"_WorkOrderTags"');
    expect(sql.text).toContain('"Tag"');
    expect(sql.text).toContain('w."deletedAt" IS NULL');
    expect(sql.values).toContain("2026 1042");
  });

  it("returnerer ingen id-er for tomt søk", async () => {
    await expect(searchWorkOrderIds(" --- ")).resolves.toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});

describe("searchNormalizedIds", () => {
  it("normaliserer kontaktfelt og bruker parameterisert term", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "contact-1", score: 1 }]);

    await expect(
      searchNormalizedIds("Contact", "Årlig Service", 10),
    ).resolves.toEqual([{ id: "contact-1", score: 1 }]);

    const sql = lastSql();
    expect(sql.text).toContain('"Contact"."name"');
    expect(sql.text).toContain('"Contact"."email"');
    expect(sql.text).toContain("unaccent");
    expect(sql.text).toContain("regexp_replace");
    expect(sql.text).toContain("strpos");
    // Trigram-operatoren bruker de nye GIN-indeksene der de finnes.
    expect(sql.text).toContain(" % ");
    expect(sql.values).toContain("arlig service");
    expect(sql.values).toContain("Årlig Service");
    expect(sql.text).not.toContain("Årlig Service");
  });

  it("søker i enhetsmodell, serienummer og plassering", async () => {
    await searchNormalizedIds("Product", "SN-123", 10);
    const sql = lastSql();

    expect(sql.text).toContain('"Product"."model"');
    expect(sql.text).toContain('"Product"."serialNumber"');
    expect(sql.text).toContain('"Product"."location"');
    expect(sql.values).toContain("sn 123");
  });

  it("utelater mykt slettede kunder, men ikke brukere", async () => {
    await searchNormalizedIds("Customer", "kunde", 10);
    expect(lastSql().text).toContain('"Customer"."deletedAt" IS NULL');

    await searchNormalizedIds("User", "kari", 10);
    expect(lastSql().text).not.toContain("deletedAt");
  });

  it("avviser tabell og kolonne utenfor allowlisten", async () => {
    await expect(
      searchNormalizedIds("Document" as never, "hemmelig", 10),
    ).rejects.toThrow("Ugyldig tabell");
    await expect(
      searchNormalizedIds("User", "hemmelig", 10, ["password"]),
    ).rejects.toThrow("Ugyldig kolonne");
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("søker bare i de oppgitte kolonnene når kalleren velger dem", async () => {
    await searchNormalizedIds("User", "kari", 10, ["name"]);
    const sql = lastSql();

    expect(sql.text).toContain('"User"."name"');
    expect(sql.text).not.toContain('"User"."email"');
    expect(sql.text).not.toContain('"User"."phone"');
  });
});

describe("searchReports", () => {
  it("bruker fulltekstindeksene, trigram og teller totalen", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { id: "report-1", score: 0.9, snippet: "<b>NO-2026-1042</b>", total: BigInt(3) },
    ]);

    await expect(
      searchReports("NO-2026-1042", { limit: 10, includeCancelled: false }),
    ).resolves.toEqual([
      { id: "report-1", score: 0.9, snippet: "<b>NO-2026-1042</b>", total: 3 },
    ]);

    const sql = lastSql();
    expect(sql.text).toContain("websearch_to_tsquery('norwegian'");
    expect(sql.text).toContain("ts_rank(");
    expect(sql.text).toContain("ts_headline(");
    expect(sql.text).toContain('"ReportUnit"');
    expect(sql.text).toContain('r."reportNumber"');
    expect(sql.text).toContain('r."templateTitle"');
    expect(sql.text).toContain('r."hmsType"');
    expect(sql.text).toContain("COUNT(*) OVER()");
    expect(sql.text).toContain('"WorkOrder"');
    expect(sql.text).toContain('"Customer"');
    // Søkeordet er en parameter, ikke SQL-tekst.
    expect(sql.text).not.toContain("NO-2026-1042");
    expect(sql.values).toContain("NO-2026-1042");
  });

  it("bruker filter-allowlisten og kaster aldri filterverdier inn i SQL-teksten", async () => {
    await searchReports("pumpe", {
      limit: 5,
      includeCancelled: true,
      filters: {
        status: "COMPLETED",
        customer: "cust-1",
        technician: "tech-1",
        tag: "Service",
        hmsType: "SJA",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      },
    });

    const sql = lastSql();
    expect(sql.text).toContain('w."status" = ');
    expect(sql.text).toContain('r."hmsType" = ');
    expect(sql.text).toContain('_WorkOrderTechnicians');
    expect(sql.text).toContain('_WorkOrderTags');
    expect(sql.text).toContain('r."completedAt"');
    expect(sql.text).not.toContain("cust-1");
    expect(sql.text).not.toContain("tech-1");
    expect(sql.values).toEqual(
      expect.arrayContaining(["cust-1", "tech-1", "Service", "SJA", "2026-01-01"]),
    );
  });

  it("utelater kansellerte oppdrag med mindre de er bestilt", async () => {
    await searchReports("pumpe", { limit: 5, includeCancelled: false });
    expect(lastSql().text).toContain("'CANCELLED'");

    mocks.queryRaw.mockClear();
    await searchReports("pumpe", { limit: 5, includeCancelled: true });
    expect(lastSql().text).not.toContain("'CANCELLED'");
  });

  it("returnerer ingen treff for et tomt søkeord", async () => {
    await expect(
      searchReports(" --- ", { limit: 5, includeCancelled: false }),
    ).resolves.toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
