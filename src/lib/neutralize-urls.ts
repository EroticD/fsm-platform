/**
 * Nøytraliserer URL-er i tekst som brukeren kontrollerer.
 *
 * Varsel- og e-posttekster er ren tekst, men e-postklienter gjør ofte URL-er
 * om til klikkbare lenker automatisk. En oppdragstittel eller en melding fra
 * kundeportalen kan derfor brukes til å plante en phishing-lenke. Vi erstatter
 * hele adressen med en tydelig markør, og lar systemets egne `href`-felt være
 * urørt.
 */

const URL_LIKE =
  /(?:\bhttps?:\/\/|\bwww\.)[^\s<>"']+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b(?::\d{2,5})?(?:\/[^\s<>"']*)?/gi;

export function neutralizeUrls(
  value: unknown,
  replacement = "[lenke fjernet]",
): string {
  if (typeof value !== "string" || value.length === 0) return "";
  return value.replace(URL_LIKE, replacement);
}
