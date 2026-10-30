/** Normaliserer et telefonnummer til bare sifre, med landkode uten «+». */
export function normalizeSmsPhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  // «0047 123…» og «+47 123…» skal gi samme nøkkel.
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

/**
 * To numre regnes som samme mottaker når de er like, eller når det ene er en
 * nasjonal form av det andre (mangler landkode). Korte numre avvises, så en
 * tom eller avkortet verdi aldri matcher alt.
 */
export function phonesMatch(a: unknown, b: unknown): boolean {
  const left = normalizeSmsPhone(a);
  const right = normalizeSmsPhone(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 7 || right.length < 7) return false;
  return left.endsWith(right) || right.endsWith(left);
}

/** Visningsformat som ikke avslører mer enn nødvendig i lister. */
export function maskSmsPhone(value: string): string {
  const digits = normalizeSmsPhone(value);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 2)}…${digits.slice(-4)}`;
}
