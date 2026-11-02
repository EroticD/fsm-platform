// i18n-ignore-file: normaliseringsregler er tekniske data, ikke UI-tekst.
/**
 * Normalisering av forretningsnøkler.
 *
 * Reglene er eksplisitte og testes. Vi bruker aldri fuzzy matching: enten er
 * nøkkelen lik etter normalisering, eller så er raden en ny rad/konflikt.
 */

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Organisasjonsnummer: valgfritt landprefiks fjernes, deretter bare sifre. */
export function normaliseOrgNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.trim().toUpperCase().replace(/[\s.-]/g, "");
  if (/^[A-Z]{2}\d/.test(text)) text = text.slice(2);
  return text.replace(/\D/g, "");
}

export function normaliseCustomerNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  return collapse(value).toLowerCase();
}

export function normaliseEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function normaliseName(value: unknown): string {
  if (typeof value !== "string") return "";
  return collapse(value).toLowerCase();
}

/** Serienummer: trim, store bokstaver og fjern mellomrom/bindestreker. */
export function normaliseSerial(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function normaliseContractNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  return collapse(value).toLowerCase();
}

export function normaliseReference(value: unknown): string {
  if (typeof value !== "string") return "";
  return collapse(value).toUpperCase();
}

/** Sti for kategorier/mapper: `/`-separert, trimmet og versjonsuavhengig. */
export function normalisePath(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .split("/")
    .map((segment) => collapse(segment).toLowerCase())
    .filter(Boolean)
    .join("/");
}

export function normaliseHex(value: string): string {
  return value.trim().toLowerCase();
}

/** Deterministisk sortering på kildeprimærnøkkel. */
export function compareById<T extends { id: string }>(left: T, right: T): number {
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Desimal som streng, uten eksponent og med punktum. */
export function decimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
    return trimmed.includes(".") ? trimmed : `${trimmed}.00`;
  }
  return null;
}
