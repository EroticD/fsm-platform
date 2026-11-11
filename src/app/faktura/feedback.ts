/**
 * Serverfeil fra fakturahandlingene kommer som stabile koder. Oversett dem til
 * konkrete meldinger i stedet for den generiske «Handlingen kunne ikke
 * fullføres», slik at brukeren ser hva som faktisk gikk galt.
 */
const INVOICE_ERROR_KEYS: Record<string, string> = {
  forbidden: "forbidden",
  invalid: "invalid",
  not_found: "notFound",
  conflict: "conflict",
  "invoice.locked": "locked",
  "invoice.notDraft": "notDraft",
  "invoice.notPayable": "notPayable",
  "invoice.notCreditable": "notCreditable",
  "invoice.amountTooHigh": "amountTooHigh",
  "invoice.duplicate": "duplicateNumber",
  "invoice.duplicateNumber": "duplicateNumber",
};

export function invoiceErrorKey(code?: string | null): string | null {
  if (!code) return null;
  return `invoicing.errors.${INVOICE_ERROR_KEYS[code] ?? "generic"}`;
}
