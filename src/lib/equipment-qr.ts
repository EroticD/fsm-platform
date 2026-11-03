/**
 * Hjelpere for kunders eksisterende QR-koder.
 *
 * En ekstern QR-kode er en opak streng fra et annet anleggssystem. Vi følger
 * aldri URL-er og tolker ikke innholdet utover å fjerne usynlige tegn og
 * mellomrom rundt. Sammenligningen er bevisst case-sensitiv, fordi QR-verdier
 * er case-sensitive. Den eksakte verdien bevares for visning; den normaliserte
 * verdien brukes bare til oppslag og unikhet.
 */

export const EXTERNAL_QR_MAX_LENGTH = 2048;

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/** Trim og fjern usynlige tegn. Store/små bokstaver bevares. */
export function normalizeExternalQrValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(ZERO_WIDTH, "").trim();
}

export function isValidExternalQrValue(raw: unknown): boolean {
  const value = normalizeExternalQrValue(raw);
  return value.length > 0 && value.length <= EXTERNAL_QR_MAX_LENGTH;
}

/** Kort visningsverdi for svært lange koder. */
export function displayExternalQrValue(value: string): string {
  if (value.length <= 64) return value;
  return `${value.slice(0, 32)}…${value.slice(-16)}`;
}
