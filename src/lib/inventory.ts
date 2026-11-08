/**
 * Ren beholdningsmatematikk. Tjenestelaget bruker disse hjelperne, slik at
 * avrunding og negative beholdninger testes uten database.
 */

export const QUANTITY_SCALE = 1000;

type DecimalLike = number | string | { toString(): string } | null | undefined;

/** Decimal fra Prisma, streng eller tall til et vanlig JS-tall. */
export function decimalToNumber(value: DecimalLike): number {
  if (value == null) return 0;
  const parsed = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Avrunder til tre desimaler, som er presisjonen i databasen. */
export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;
}

export type StockDirection = "IN" | "OUT" | "ADJUST";

/**
 * Regner ut ny beholdning.
 *
 * `IN` og `OUT` bruker absoluttverdien til mengden, slik at et negativt tall i
 * skjemaet ikke snur en varebevegelse. `ADJUST` er den eneste handlingen som
 * bevisst kan gi negativ beholdning, fordi den brukes til å rette opptelling.
 */
export function nextStockQuantity(
  current: number,
  type: StockDirection,
  quantity: number,
): number {
  const magnitude = Math.abs(quantity);
  if (type === "ADJUST") return roundQuantity(current + quantity);
  const delta = type === "IN" ? magnitude : -magnitude;
  return roundQuantity(current + delta);
}

/** Kan en vanlig uttak/reservasjon gjennomføres uten negativ beholdning? */
export function canTakeFromStock(current: number, quantity: number): boolean {
  return roundQuantity(current - Math.abs(quantity)) >= 0;
}

/**
 * Kjøpsforslag: hvor mye som mangler for å nå bestillingspunktet, sett opp mot
 * tilgjengelig beholdning (på lager minus aktive reservasjoner).
 */
export function suggestedPurchaseQuantity(
  onHand: number,
  reserved: number,
  minLevel: number,
): number {
  const available = roundQuantity(onHand - reserved);
  const missing = roundQuantity(minLevel - available);
  return missing > 0 ? missing : 0;
}

/** Er varen på eller under bestillingspunktet? */
export function isLowStock(
  onHand: number,
  reserved: number,
  minLevel: number,
): boolean {
  return roundQuantity(onHand - reserved) <= minLevel;
}

/** Tallformat for visning, uten unødvendige nuller. */
export function formatQuantity(value: DecimalLike): string {
  const numeric = decimalToNumber(value);
  return new Intl.NumberFormat("nb-NO", {
    maximumFractionDigits: 3,
  }).format(numeric);
}
