import { describe, expect, it } from "vitest";
import {
  calculateMileageAmount,
  calculateVatFromGross,
  isValidVatAmount,
  payrollCsv,
  roundOre,
} from "./expenses";

describe("kjøretur og utlegg", () => {
  it("avrunder kjøregodtgjørelse til øre", () => {
    expect(calculateMileageAmount(12.5, 3.5)).toBe(43.75);
    expect(calculateMileageAmount(1.005, 1)).toBe(1.01);
    expect(roundOre(43.749999)).toBe(43.75);
  });

  it("trekker mva ut av bruttobeløp", () => {
    expect(calculateVatFromGross(125, 25)).toBe(25);
    expect(calculateVatFromGross(100, 12)).toBe(10.71);
    expect(calculateVatFromGross(100, 0)).toBe(0);
  });

  it("avviser mva større enn beløpet", () => {
    expect(isValidVatAmount(100, 25)).toBe(true);
    expect(isValidVatAmount(100, 125)).toBe(false);
    expect(isValidVatAmount(100, -1)).toBe(false);
  });

  it("bygger stabil semikolonseparert CSV med BOM og formelsikring", () => {
    const csv = payrollCsv([
      {
        type: "MILEAGE",
        userName: "Kari",
        date: "2026-11-07",
        reference: "O-1",
        description: "=HYPERLINK(\"x\")",
        quantity: 12.5,
        unit: "km",
        amount: 43.75,
        vatAmount: 0,
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      '"type";"bruker";"dato";"referanse";"beskrivelse";"mengde";"enhet";"belop";"mva"',
    );
    expect(csv).toContain('"12,5"');
    expect(csv).toContain('"43,75"');
    // Formel-celler nøytraliseres med apostrof.
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
