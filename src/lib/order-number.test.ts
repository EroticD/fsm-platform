import { describe, expect, it } from "vitest";
import { normalizeOrderNumber } from "./order-number";

describe("normalizeOrderNumber", () => {
  it("trimmet, store bokstaver og uten mellomrom/tegnsetting", () => {
    expect(normalizeOrderNumber("  k-1001 / a ")).toBe("K1001A");
    expect(normalizeOrderNumber("K. 1001")).toBe("K1001");
    expect(normalizeOrderNumber("Æ-Ø 42")).toBe("ÆØ42");
  });

  it("gir null for tomme verdier", () => {
    expect(normalizeOrderNumber("")).toBeNull();
    expect(normalizeOrderNumber("   -/  ")).toBeNull();
    expect(normalizeOrderNumber(null)).toBeNull();
    expect(normalizeOrderNumber(undefined)).toBeNull();
  });
});
