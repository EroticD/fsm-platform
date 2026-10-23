import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  default: { $queryRaw: mocks.queryRaw },
}));

import {
  isAllowedNameSearchField,
  searchByName,
  searchDocuments,
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

  it("vet hvilke kolonner som har trigram-indeks", () => {
    expect(isAllowedNameSearchField("Customer", "name")).toBe(true);
    expect(isAllowedNameSearchField("Customer", "city")).toBe(true);
    expect(isAllowedNameSearchField("Product", "model")).toBe(true);
    expect(isAllowedNameSearchField("WorkOrder", "title")).toBe(true);
    expect(isAllowedNameSearchField("Customer", "notes")).toBe(false);
    expect(isAllowedNameSearchField("Document", "contentText")).toBe(false);
  });
});
