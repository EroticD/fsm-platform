import { describe, expect, it } from "vitest";
import {
  calculateLineTotal,
  calculatePurchaseOrderTotals,
  canCancelPurchaseOrder,
  canOrderPurchaseOrder,
  canReceivePurchaseOrder,
  canTransitionPurchaseOrder,
  parseQuantity,
  parseUnitCost,
  quantityRemaining,
  receiptStatusAfter,
} from "./purchasing";

describe("innkjøpsmatematikk", () => {
  it("beregner linjesum på serveren og avrunder til øre", () => {
    expect(calculateLineTotal(10, 12.5).toFixed(2)).toBe("125.00");
    expect(calculateLineTotal("3", "0.333").toFixed(2)).toBe("1.00");
    expect(calculateLineTotal(0.5, 99.99).toFixed(2)).toBe("50.00");
  });

  it("beregner bestilt og mottatt totalsum fra linjene", () => {
    const totals = calculatePurchaseOrderTotals([
      { orderedQuantity: 10, receivedQuantity: 4, unitCost: 12.5 },
      { orderedQuantity: 2, receivedQuantity: 2, unitCost: 25 },
    ]);
    expect(totals.orderedTotal).toBe("175.00");
    expect(totals.receivedTotal).toBe("100.00");
  });

  it("gjenstående mengde er aldri negativ", () => {
    expect(quantityRemaining(10, 4).toFixed(3)).toBe("6.000");
    expect(quantityRemaining(10, 10).toFixed(3)).toBe("0.000");
    expect(quantityRemaining(10, 12).toFixed(3)).toBe("0.000");
  });

  it("utleder delvis mottatt og fullt mottatt", () => {
    expect(
      receiptStatusAfter([
        { orderedQuantity: 10, receivedQuantity: 4 },
        { orderedQuantity: 2, receivedQuantity: 2 },
      ]),
    ).toBe("PARTIALLY_RECEIVED");
    expect(
      receiptStatusAfter([
        { orderedQuantity: 10, receivedQuantity: 10 },
        { orderedQuantity: 2, receivedQuantity: 2 },
      ]),
    ).toBe("RECEIVED");
  });

  it("tolker mengde og kostnad uten å godta negative tall", () => {
    expect(parseQuantity("2,5")?.toFixed(3)).toBe("2.500");
    expect(parseQuantity(-1)).toBeNull();
    expect(parseQuantity("ikke et tall")).toBeNull();
    expect(parseUnitCost("12,50")?.toFixed(2)).toBe("12.50");
    expect(parseUnitCost(-0.01)).toBeNull();
  });
});

describe("statusregler for innkjøpsordre", () => {
  it("tillater bare de definerte overgangene", () => {
    expect(canTransitionPurchaseOrder("DRAFT", "ORDERED")).toBe(true);
    expect(canTransitionPurchaseOrder("ORDERED", "PARTIALLY_RECEIVED")).toBe(true);
    expect(canTransitionPurchaseOrder("PARTIALLY_RECEIVED", "RECEIVED")).toBe(true);
    expect(canTransitionPurchaseOrder("DRAFT", "RECEIVED")).toBe(false);
    expect(canTransitionPurchaseOrder("RECEIVED", "CANCELLED")).toBe(false);
    expect(canTransitionPurchaseOrder("CANCELLED", "ORDERED")).toBe(false);
  });

  it("krever minst én linje for å bestille", () => {
    expect(canOrderPurchaseOrder("DRAFT", 1)).toBe(true);
    expect(canOrderPurchaseOrder("DRAFT", 0)).toBe(false);
    expect(canOrderPurchaseOrder("ORDERED", 1)).toBe(false);
  });

  it("avbestilling er bare mulig før noe er mottatt", () => {
    expect(canCancelPurchaseOrder("DRAFT", false)).toBe(true);
    expect(canCancelPurchaseOrder("ORDERED", false)).toBe(true);
    expect(canCancelPurchaseOrder("ORDERED", true)).toBe(false);
    expect(canCancelPurchaseOrder("PARTIALLY_RECEIVED", false)).toBe(false);
    expect(canCancelPurchaseOrder("CANCELLED", false)).toBe(false);
  });

  it("mottak krever en bestilt ordre", () => {
    expect(canReceivePurchaseOrder("ORDERED")).toBe(true);
    expect(canReceivePurchaseOrder("PARTIALLY_RECEIVED")).toBe(true);
    expect(canReceivePurchaseOrder("DRAFT")).toBe(false);
    expect(canReceivePurchaseOrder("RECEIVED")).toBe(false);
    expect(canReceivePurchaseOrder("CANCELLED")).toBe(false);
  });
});
