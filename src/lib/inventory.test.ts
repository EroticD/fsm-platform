import { describe, expect, it } from "vitest";
import {
  canTakeFromStock,
  decimalToNumber,
  isLowStock,
  nextStockQuantity,
  roundQuantity,
  suggestedPurchaseQuantity,
} from "./inventory";

describe("beholdningsmatematikk", () => {
  it("avrunder til tre desimaler", () => {
    expect(roundQuantity(1.23456)).toBe(1.235);
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
  });

  it("tolker Prisma Decimal, streng og tall", () => {
    expect(decimalToNumber({ toString: () => "12.500" })).toBe(12.5);
    expect(decimalToNumber("3.25")).toBe(3.25);
    expect(decimalToNumber(null)).toBe(0);
  });

  it("inn og ut bruker absoluttverdi", () => {
    expect(nextStockQuantity(10, "IN", -5)).toBe(15);
    expect(nextStockQuantity(10, "OUT", -4)).toBe(6);
  });

  it("eksplisitt justering kan gi negativ beholdning", () => {
    expect(nextStockQuantity(1, "ADJUST", -3)).toBe(-2);
  });

  it("vanlig uttak kan ikke gå under null", () => {
    expect(canTakeFromStock(5, 5)).toBe(true);
    expect(canTakeFromStock(5, 5.001)).toBe(false);
  });

  it("kjøpsforslag tar hensyn til reservasjoner og bestillingspunkt", () => {
    expect(suggestedPurchaseQuantity(10, 4, 12)).toBe(6);
    expect(suggestedPurchaseQuantity(10, 0, 5)).toBe(0);
    expect(isLowStock(10, 0, 10)).toBe(true);
    expect(isLowStock(10, 0, 9)).toBe(false);
  });
});
