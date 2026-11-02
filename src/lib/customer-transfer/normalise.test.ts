import { describe, expect, it } from "vitest";
import {
  compareById,
  decimalString,
  normaliseContractNumber,
  normaliseCustomerNumber,
  normaliseEmail,
  normaliseName,
  normaliseOrgNumber,
  normalisePath,
  normaliseReference,
  normaliseSerial,
} from "./normalise";

describe("normalisering av forretningsnøkler", () => {
  it("normaliserer organisasjonsnummer med landprefiks og skilletegn", () => {
    expect(normaliseOrgNumber("NO 123 456 789 MVA")).toBe("123456789");
    expect(normaliseOrgNumber("123.456.789")).toBe("123456789");
    expect(normaliseOrgNumber(null)).toBe("");
  });

  it("normaliserer kundenummer og referanser uten fuzzy matching", () => {
    expect(normaliseCustomerNumber("  K-001 ")).toBe("k-001");
    expect(normaliseReference(" o-251103-abcd1234 ")).toBe("O-251103-ABCD1234");
    expect(normaliseContractNumber("A-1 ")).toBe("a-1");
  });

  it("normaliserer e-post, navn, serienummer og sti", () => {
    expect(normaliseEmail(" Test@Example.NO ")).toBe("test@example.no");
    expect(normaliseName("  Pipelife   Norge ")).toBe("pipelife norge");
    expect(normaliseSerial(" sn-123 45 ")).toBe("SN12345");
    expect(normalisePath(" Bygg / System / Enhet ")).toBe("bygg/system/enhet");
  });

  it("sorterer på id uten locale-avhengighet", () => {
    const rows = [{ id: "b" }, { id: "a" }];
    expect([...rows].sort(compareById).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("beholder desimaler som streng og avviser ugyldige verdier", () => {
    expect(decimalString("12.5")).toBe("12.5");
    expect(decimalString("12")).toBe("12.00");
    expect(decimalString(Number.NaN)).toBeNull();
    expect(decimalString("1e3")).toBeNull();
  });
});
