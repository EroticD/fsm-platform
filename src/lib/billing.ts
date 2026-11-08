import { Prisma } from "@prisma/client";

/**
 * Pengeberegning for tilbud og fakturaer.
 *
 * All beregning skjer på serveren. Klienten kan vise et foreløpig beløp, men
 * tjenestelaget regner alltid om linjene på nytt før det lagrer. Beløpene
 * rundes til øre med halv opp, og MVA beregnes per linje. Da blir summen av
 * linjene alltid lik dokumentets totale MVA – også når satsen varierer.
 */

export const DEFAULT_VAT_RATE = 25;
export const MAX_LINES = 100;
export const MAX_QUANTITY = 1_000_000;
export const MAX_UNIT_PRICE = 99_999_999;
export const MAX_VAT_RATE = 100;

export type CalculatedLine = {
  sortOrder: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  lineTotal: string;
  lineVat: string;
};

export type CalculatedDocument = {
  lines: CalculatedLine[];
  subtotal: string;
  vatTotal: string;
  total: string;
};

export type RawLine = {
  description: string;
  quantity: unknown;
  unit?: unknown;
  unitPrice: unknown;
  vatRate?: unknown;
};

/** Tolker et tall fra skjema, med komma som desimaltegn. */
export function parseMoney(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  try {
    const decimal = new Prisma.Decimal(text);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function decimalOrNull(value: unknown): Prisma.Decimal | null {
  return parseMoney(value);
}

/** Avrunder til to desimaler (øre) med halv opp. */
export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Gyldig MVA-sats: 0–100 %. Ugyldig verdi faller tilbake til standarden. */
export function normalizeVatRate(value: unknown, fallback = DEFAULT_VAT_RATE): string {
  const parsed = decimalOrNull(value);
  if (!parsed || parsed.isNegative() || parsed.greaterThan(MAX_VAT_RATE)) {
    return new Prisma.Decimal(fallback).toFixed(2);
  }
  return parsed.toFixed(2);
}

/**
 * Regner ut linjebeløp og dokumenttotaler. Ugyldige linjer avvises av
 * tjenestelaget før denne kalles; her konsentrerer vi oss om aritmetikken.
 */
export function calculateDocument(
  lines: RawLine[],
  fallbackVatRate: unknown = DEFAULT_VAT_RATE,
): CalculatedDocument {
  const calculated: CalculatedLine[] = [];
  let subtotal = new Prisma.Decimal(0);
  let vatTotal = new Prisma.Decimal(0);

  lines.forEach((line, index) => {
    const quantity = decimalOrNull(line.quantity) ?? new Prisma.Decimal(1);
    const unitPrice = decimalOrNull(line.unitPrice) ?? new Prisma.Decimal(0);
    const vatRate = new Prisma.Decimal(
      normalizeVatRate(line.vatRate, Number(normalizeVatRate(fallbackVatRate))),
    );

    const lineTotal = roundMoney(quantity.mul(unitPrice));
    const lineVat = roundMoney(lineTotal.mul(vatRate).div(100));

    subtotal = subtotal.add(lineTotal);
    vatTotal = vatTotal.add(lineVat);
    calculated.push({
      sortOrder: index,
      description: line.description,
      quantity: quantity.toFixed(2),
      unit: String(line.unit ?? "stk"),
      unitPrice: unitPrice.toFixed(2),
      vatRate: vatRate.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      lineVat: lineVat.toFixed(2),
    });
  });

  const roundedSubtotal = roundMoney(subtotal);
  const roundedVat = roundMoney(vatTotal);
  return {
    lines: calculated,
    subtotal: roundedSubtotal.toFixed(2),
    vatTotal: roundedVat.toFixed(2),
    total: roundedSubtotal.add(roundedVat).toFixed(2),
  };
}

export type InvoiceMoneyState = {
  total: Prisma.Decimal | string | number;
  paidTotal: Prisma.Decimal | string | number;
  creditedTotal: Prisma.Decimal | string | number;
  dueDate: Date | null;
  issueDate: Date | null;
};

export function invoiceOutstanding(invoice: InvoiceMoneyState): string {
  const total = new Prisma.Decimal(invoice.total);
  const paid = new Prisma.Decimal(invoice.paidTotal);
  const credited = new Prisma.Decimal(invoice.creditedTotal);
  const outstanding = total.sub(paid).sub(credited);
  return (outstanding.isNegative() ? new Prisma.Decimal(0) : outstanding).toFixed(2);
}

/**
 * Avleder fakturaens status fra beløp og forfall. `DRAFT` og `CREDITED` er
 * eksplisitte tilstander som ikke skal overskrives av en automatisk sweep.
 */
export function deriveInvoiceStatus(
  invoice: InvoiceMoneyState,
  current: string,
  today: Date,
): "SENT" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CREDITED" {
  if (current === "DRAFT") return "SENT";
  const total = new Prisma.Decimal(invoice.total);
  const credited = new Prisma.Decimal(invoice.creditedTotal);
  if (credited.greaterThanOrEqualTo(total)) return "CREDITED";

  const outstanding = new Prisma.Decimal(invoiceOutstanding(invoice));
  if (outstanding.lte(0)) return "PAID";
  if (invoice.dueDate && invoice.dueDate.getTime() < today.getTime()) {
    return "OVERDUE";
  }
  const paid = new Prisma.Decimal(invoice.paidTotal);
  return paid.gt(0) ? "PARTIALLY_PAID" : "SENT";
}

/** Beløp som fortsatt kan betales eller krediteres. */
export function payableAmount(invoice: InvoiceMoneyState): Prisma.Decimal {
  return new Prisma.Decimal(invoiceOutstanding(invoice));
}

/** Formaterer et beløp med to desimaler og norsk gruppering for visning. */
export function formatAmount(
  value: { toString(): string } | number | string | null | undefined,
  currency = "NOK",
): string {
  // Feltnivå-RBAC kan fjerne beløpet for en rolle uten tilgang. Da viser vi en
  // maske i stedet for å krasje på `null.toString()`.
  if (value === null || value === undefined) return "••••";
  const number = Number(value.toString());
  if (!Number.isFinite(number)) return "";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}
