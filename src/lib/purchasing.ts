import { Prisma } from "@prisma/client";

/**
 * Ren innkjøpsmatematikk og statusregler.
 *
 * Tjenestelaget regner alltid om mengder, linjesummer og ordretotaler fra
 * databasen. Klienten kan vise et foreløpig beløp, men aldri lagre det.
 */

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

export type PurchaseOrderStatusValue = (typeof PURCHASE_ORDER_STATUSES)[number];

const TRANSITIONS: Record<
  PurchaseOrderStatusValue,
  readonly PurchaseOrderStatusValue[]
> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

function toDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!DECIMAL_PATTERN.test(text)) return null;
  try {
    const decimal = new Prisma.Decimal(text);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

/** Tolker en mengde fra skjema. Ugyldige verdier gir `null`. */
export function parseQuantity(value: unknown): Prisma.Decimal | null {
  const decimal = toDecimal(value);
  return decimal && !decimal.isNegative() ? decimal : null;
}

/** Tolker en enhetskostnad fra skjema. Ugyldige verdier gir `null`. */
export function parseUnitCost(value: unknown): Prisma.Decimal | null {
  const decimal = toDecimal(value);
  return decimal && !decimal.isNegative() ? decimal : null;
}

export function isPurchaseOrderStatus(
  value: unknown,
): value is PurchaseOrderStatusValue {
  return (PURCHASE_ORDER_STATUSES as readonly string[]).includes(String(value));
}

/** Kan ordren gå fra `from` til `to`? */
export function canTransitionPurchaseOrder(
  from: PurchaseOrderStatusValue,
  to: PurchaseOrderStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Ordre kan bestilles når den er utkast og har minst én linje. */
export function canOrderPurchaseOrder(
  status: PurchaseOrderStatusValue,
  lineCount: number,
): boolean {
  return status === "DRAFT" && lineCount > 0;
}

/**
 * Avbestilling er bare mulig før noe er mottatt. Delvis mottak binder ordren
 * til de varene som allerede er på lager.
 */
export function canCancelPurchaseOrder(
  status: PurchaseOrderStatusValue,
  hasReceivedQuantity: boolean,
): boolean {
  return (
    (status === "DRAFT" || status === "ORDERED") && !hasReceivedQuantity
  );
}

/** Mottak er bare mulig på en bestilt ordre som ikke er fullt mottatt. */
export function canReceivePurchaseOrder(
  status: PurchaseOrderStatusValue,
): boolean {
  return status === "ORDERED" || status === "PARTIALLY_RECEIVED";
}

/** Gjenstående mengde på en linje, aldri negativ. */
export function quantityRemaining(
  orderedQuantity: unknown,
  receivedQuantity: unknown,
): Prisma.Decimal {
  const ordered = toDecimal(orderedQuantity) ?? new Prisma.Decimal(0);
  const received = toDecimal(receivedQuantity) ?? new Prisma.Decimal(0);
  const remaining = ordered.minus(received);
  return remaining.isNegative() ? new Prisma.Decimal(0) : remaining;
}

/** Avrunder et pengebeløp til øre med halv opp. */
export function roundLineMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Linjesum = ordremengde × enhetskost, avrundet til øre. */
export function calculateLineTotal(
  orderedQuantity: unknown,
  unitCost: unknown,
): Prisma.Decimal {
  const quantity = toDecimal(orderedQuantity) ?? new Prisma.Decimal(0);
  const cost = toDecimal(unitCost) ?? new Prisma.Decimal(0);
  return roundLineMoney(quantity.mul(cost));
}

export type PurchaseOrderLineTotals = {
  orderedQuantity: unknown;
  receivedQuantity: unknown;
  unitCost: unknown;
};

export type PurchaseOrderTotals = {
  orderedTotal: string;
  receivedTotal: string;
};

/**
 * Ordretotaler beregnes på lesetid. `receivedTotal` er verdien av det som
 * faktisk er mottatt, ikke det som er bestilt.
 */
export function calculatePurchaseOrderTotals(
  lines: readonly PurchaseOrderLineTotals[],
): PurchaseOrderTotals {
  let ordered = new Prisma.Decimal(0);
  let received = new Prisma.Decimal(0);
  for (const line of lines) {
    const cost = toDecimal(line.unitCost) ?? new Prisma.Decimal(0);
    const orderedQuantity = toDecimal(line.orderedQuantity) ?? new Prisma.Decimal(0);
    const receivedQuantity = toDecimal(line.receivedQuantity) ?? new Prisma.Decimal(0);
    ordered = ordered.add(roundLineMoney(orderedQuantity.mul(cost)));
    received = received.add(roundLineMoney(receivedQuantity.mul(cost)));
  }
  return {
    orderedTotal: roundLineMoney(ordered).toFixed(2),
    receivedTotal: roundLineMoney(received).toFixed(2),
  };
}

/** Statusen en ordre skal ha etter et mottak. */
export function receiptStatusAfter(
  lines: readonly { orderedQuantity: unknown; receivedQuantity: unknown }[],
): "PARTIALLY_RECEIVED" | "RECEIVED" {
  if (
    lines.length > 0 &&
    lines.every((line) => {
      const ordered = toDecimal(line.orderedQuantity) ?? new Prisma.Decimal(0);
      const received = toDecimal(line.receivedQuantity) ?? new Prisma.Decimal(0);
      return received.greaterThanOrEqualTo(ordered);
    })
  ) {
    return "RECEIVED";
  }
  return "PARTIALLY_RECEIVED";
}
