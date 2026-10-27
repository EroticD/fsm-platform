/**
 * Normalisering av eksternt ordrenummer.
 *
 * `orderNumber` er nummeret slik kunden skrev det, og brukes til visning.
 * `orderNumberNormalized` er en stabil nøkkel for duplikatkontroll: den
 * trimmes, skiller ikke mellom store og små bokstaver, og fjerner mellomrom og
 * tegnsetting. Da regnes «K-1001», «k 1001» og «K.1001» som samme ordre.
 *
 * Unikheten gjelder per avdeling (`@@unique([departmentId,
 * orderNumberNormalized])`), fordi to avdelinger kan ha hvert sitt
 * ordrenummer-serieløp. Tomt ordrenummer normaliseres til `null`, som ikke er
 * med i unikhetsindeksen.
 */
export function normalizeOrderNumber(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const normalized = String(value)
    .trim()
    .toLocaleUpperCase("nb-NO")
    // Behold bokstaver og tall (inkludert æøå), fjern mellomrom, bindestrek,
    // skråstrek og annen tegnsetting.
    .replace(/[^\p{L}\p{N}]+/gu, "");

  return normalized || null;
}
