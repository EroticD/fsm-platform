import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateDocument,
  deriveInvoiceStatus,
  formatAmount,
  invoiceOutstanding,
  normalizeVatRate,
  parseMoney,
  roundMoney,
} from "./billing";

describe("pengeberegning", () => {
  it("regner linjesum og MVA med halv opp til øre", () => {
    const result = calculateDocument(
      [
        { description: "Arbeid", quantity: "3", unitPrice: "199.99", vatRate: "25" },
        { description: "Del", quantity: "0.1", unitPrice: "0.2", vatRate: "15" },
      ],
      25,
    );
    expect(result.lines[0]).toMatchObject({
      lineTotal: "599.97",
      lineVat: "149.99",
    });
    expect(result.lines[1]).toMatchObject({
      lineTotal: "0.02",
      lineVat: "0.00",
    });
    expect(result.subtotal).toBe("599.99");
    expect(result.vatTotal).toBe("149.99");
    expect(result.total).toBe("749.98");
  });

  it("runder 1,005 opp til 1,01 og håndterer negativ null", () => {
    expect(roundMoney(new Prisma.Decimal("1.005")).toFixed(2)).toBe("1.01");
    expect(roundMoney(new Prisma.Decimal("-0.001")).toFixed(2)).toBe("0.00");
  });

  it("tolker komma som desimaltegn og avviser søppel", () => {
    expect(parseMoney("12,50")?.toFixed(2)).toBe("12.50");
    expect(parseMoney(" 1 234,50 ")?.toFixed(2)).toBe("1234.50");
    expect(parseMoney("12,5,0")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  it("bruker standard MVA når satsen mangler eller er ugyldig", () => {
    expect(normalizeVatRate(undefined, 25)).toBe("25.00");
    expect(normalizeVatRate("12", 25)).toBe("12.00");
    expect(normalizeVatRate("-1", 25)).toBe("25.00");
    expect(normalizeVatRate("101", 25)).toBe("25.00");
  });

  it("beregner utestående uten negative beløp", () => {
    expect(
      invoiceOutstanding({
        total: "100.00",
        paidTotal: "40.00",
        creditedTotal: "10.00",
        dueDate: null,
        issueDate: null,
      }),
    ).toBe("50.00");
    expect(
      invoiceOutstanding({
        total: "100.00",
        paidTotal: "110.00",
        creditedTotal: "0.00",
        dueDate: null,
        issueDate: null,
      }),
    ).toBe("0.00");
  });
});

describe("fakturastatus", () => {
  const future = new Date("2026-12-31T00:00:00.000Z");
  const past = new Date("2026-01-01T00:00:00.000Z");
  const today = new Date("2026-06-01T00:00:00.000Z");

  it("avleder betalt, delvis betalt og forfalt", () => {
    expect(
      deriveInvoiceStatus(
        { total: "100", paidTotal: "0", creditedTotal: "0", dueDate: future, issueDate: null },
        "SENT",
        today,
      ),
    ).toBe("SENT");
    expect(
      deriveInvoiceStatus(
        { total: "100", paidTotal: "25", creditedTotal: "0", dueDate: future, issueDate: null },
        "SENT",
        today,
      ),
    ).toBe("PARTIALLY_PAID");
    expect(
      deriveInvoiceStatus(
        { total: "100", paidTotal: "100", creditedTotal: "0", dueDate: future, issueDate: null },
        "SENT",
        today,
      ),
    ).toBe("PAID");
    expect(
      deriveInvoiceStatus(
        { total: "100", paidTotal: "25", creditedTotal: "0", dueDate: past, issueDate: null },
        "SENT",
        today,
      ),
    ).toBe("OVERDUE");
  });

  it("lar kreditert og kladd være eksplisitte tilstander", () => {
    expect(
      deriveInvoiceStatus(
        { total: "100", paidTotal: "0", creditedTotal: "100", dueDate: past, issueDate: null },
        "SENT",
        today,
      ),
    ).toBe("CREDITED");
    expect(
      deriveInvoiceStatus(
        { total: "100", paidTotal: "0", creditedTotal: "0", dueDate: past, issueDate: null },
        "DRAFT",
        today,
      ),
    ).toBe("SENT");
  });
});

describe("formatAmount", () => {
  it("formaterer NOK med to desimaler", () => {
    expect(formatAmount("1234.5", "NOK")).toContain("1");
    expect(formatAmount("1234.5", "NOK")).toContain(",50");
  });
});
