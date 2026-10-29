/**
 * Rene hjelpere for å fjerne personopplysninger fra søketekst før lagring.
 *
 * Søkeloggen brukes bare til aggregert analyse. E-postadresser, telefonnummer,
 * organisasjonsnummer og lange tallrekker maskeres, mens vanlige søkeord
 * beholdes. Placeholderne er stabile, slik at like søk fortsatt grupperes.
 */

export const SEARCH_REDACTION_PLACEHOLDERS = {
  email: "[epost]",
  phone: "[telefon]",
  orgNumber: "[orgnr]",
  number: "[nummer]",
} as const;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Internasjonalt norsk nummer: +47/0047 etterfulgt av åtte siffer, med valgfrie
// skilletegn. Krever landkode, slik at datoer som «2026-10-29» ikke maskeres.
const INTERNATIONAL_PHONE_PATTERN =
  /(?<!\d)(?:\+47|0047)[\s.-]?(?:\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}|\d{3}[\s.-]?\d{2}[\s.-]?\d{3})(?!\d)/g;

// Norske nummer uten landkode: sammenhengende åtte siffer eller vanlige
// grupperinger med mellomrom. Bindestrek og punktum er utelatt for å unngå å
// maskere datoer.
const DOMESTIC_PHONE_PATTERN =
  /(?<!\d)(?:\d{2} \d{2} \d{2} \d{2}|\d{3} \d{2} \d{3}|\d{8})(?!\d)/g;

// Norsk organisasjonsnummer: ni siffer, valgfri NO-prefiks og MVA-suffiks.
const ORG_NUMBER_PATTERN =
  /(?<!\d)(?:NO[\s.-]*)?\d{3}(?:[\s.-]?\d{3}){2}(?:\s*MVA)?(?!\d)/gi;

const LONG_NUMBER_PATTERN = /(?<!\d)\d{6,}(?!\d)/g;

/**
 * Maskerer kjente person- og organisasjonsnumre i en søketekst.
 *
 * Funksjonen er bevisst ren og idempotent: den samme teksten gir samme
 * resultat, og en allerede maskert tekst endres ikke. Rekkefølgen er viktig –
 * e-post først, deretter telefonnumre, organisasjonsnumre og til slutt lange
 * tallrekker.
 */
export function redactSearchQuery(value: string): string {
  return String(value ?? "")
    .replace(EMAIL_PATTERN, SEARCH_REDACTION_PLACEHOLDERS.email)
    .replace(INTERNATIONAL_PHONE_PATTERN, SEARCH_REDACTION_PLACEHOLDERS.phone)
    .replace(DOMESTIC_PHONE_PATTERN, SEARCH_REDACTION_PLACEHOLDERS.phone)
    .replace(ORG_NUMBER_PATTERN, SEARCH_REDACTION_PLACEHOLDERS.orgNumber)
    .replace(LONG_NUMBER_PATTERN, SEARCH_REDACTION_PLACEHOLDERS.number);
}
