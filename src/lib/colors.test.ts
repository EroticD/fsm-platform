import { describe, expect, it } from "vitest";
import { readableTextColor } from "./colors";

describe("readableTextColor", () => {
  it("bruker hvit tekst på mørk blå", () => {
    expect(readableTextColor("#2563eb")).toBe("#ffffff");
  });

  it("bruker mørk tekst på gul og oransje", () => {
    expect(readableTextColor("#ca8a04")).toBe("#111827");
    expect(readableTextColor("#d97706")).toBe("#111827");
  });

  it("bruker mørk tekst på lys bakgrunn", () => {
    expect(readableTextColor("#f3f4f6")).toBe("#111827");
  });

  it("faller tilbake til mørk tekst på ugyldige farger", () => {
    expect(readableTextColor("ikke-en-farge")).toBe("#111827");
    expect(readableTextColor(null)).toBe("#111827");
  });
});
