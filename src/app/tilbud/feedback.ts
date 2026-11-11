/**
 * Serverfeil fra tilbudshandlingene kommer som stabile koder. Oversett dem til
 * konkrete meldinger i stedet for den generiske «Handlingen kunne ikke
 * fullføres», slik at brukeren ser hva som faktisk gikk galt.
 */
const QUOTE_ERROR_CODES = new Set([
  "forbidden",
  "invalid",
  "not_found",
  "conflict",
  "quote.locked",
  "quote.expired",
  "quote.notDraft",
  "quote.notSent",
  "quote.notAccepted",
  "quote.conversionRace",
  "token.expired",
  "token.used",
]);

export function quoteErrorKey(code?: string | null): string | null {
  if (!code) return null;
  return `quotes.errors.${QUOTE_ERROR_CODES.has(code) ? code : "generic"}`;
}
