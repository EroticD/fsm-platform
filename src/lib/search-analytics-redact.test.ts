import { describe, expect, it } from "vitest";
import {
  redactSearchQuery,
  SEARCH_REDACTION_PLACEHOLDERS,
} from "@/lib/search-analytics-redact";

describe("redactSearchQuery", () => {
  it("maskerer e-postadresser og beholder søkeordene rundt", () => {
    expect(redactSearchQuery("faktura kari@example.com pumpe")).toBe(
      `faktura ${SEARCH_REDACTION_PLACEHOLDERS.email} pumpe`,
    );
    expect(redactSearchQuery("KARI@EXAMPLE.NO")).toBe(
      SEARCH_REDACTION_PLACEHOLDERS.email,
    );
  });

  it("maskerer norske telefonnumre i vanlige formater", () => {
    const expected = `ring ${SEARCH_REDACTION_PLACEHOLDERS.phone}`;

    expect(redactSearchQuery("ring 12345678")).toBe(expected);
    expect(redactSearchQuery("ring 12 34 56 78")).toBe(expected);
    expect(redactSearchQuery("ring 123 45 678")).toBe(expected);
    expect(redactSearchQuery("ring +47 123 45 678")).toBe(expected);
    expect(redactSearchQuery("ring 0047 12 34 56 78")).toBe(expected);
  });

  it("maskerer organisasjonsnummer med og uten prefiks og MVA", () => {
    const expected = `org ${SEARCH_REDACTION_PLACEHOLDERS.orgNumber}`;

    expect(redactSearchQuery("org 123456789")).toBe(expected);
    expect(redactSearchQuery("org 123 456 789")).toBe(expected);
    expect(redactSearchQuery("org NO 123 456 789")).toBe(expected);
    expect(redactSearchQuery("org NO 123 456 789 MVA")).toBe(expected);
  });

  it("maskerer lange tallrekker, men beholder årstall og korte tall", () => {
    expect(redactSearchQuery("ordre 9876543210")).toBe(
      `ordre ${SEARCH_REDACTION_PLACEHOLDERS.number}`,
    );
    expect(redactSearchQuery("faktura 12345")).toBe("faktura 12345");
    expect(redactSearchQuery("år 2026")).toBe("år 2026");
  });

  it("maskerer ikke datoer", () => {
    expect(redactSearchQuery("frist 2026-10-29")).toBe("frist 2026-10-29");
    expect(redactSearchQuery("frist 29.10.2026")).toBe("frist 29.10.2026");
  });

  it("beholder vanlige søketermer og er idempotent", () => {
    const query = "Årlig service på pumpe";
    expect(redactSearchQuery(query)).toBe(query);

    const once = redactSearchQuery("kunde kari@example.com tlf 12 34 56 78");
    expect(redactSearchQuery(once)).toBe(once);
  });
});
