/** Minste lengde på en NEXTAUTH_SECRET som skal godtas i produksjon. */
export const MIN_NEXTAUTH_SECRET_BYTES = 32;

/**
 * Kjente standardverdier og dokumentasjons-placeholdere. De skal aldri kunne
 * brukes som produksjonshemmelighet, selv når de er lange nok.
 */
const KNOWN_WEAK_SECRETS = new Set([
  "secret",
  "changeme",
  "change-me",
  "password",
  "nextauth-secret",
  "your-secret",
  "replace-me",
  "bytt-meg-med-openssl-rand-base64-32",
  "ci-secret-brukes-bare-i-test",
]);

/**
 * En hemmelighet må være lang nok og ha nok variasjon til å tåle gjetting.
 * Lengde alene er ikke nok: «aaaaaaaa…» er 32 byte, men bare én byte entropi.
 */
export function isStrongNextAuthSecret(secret: string | undefined): boolean {
  const value = secret?.trim() ?? "";
  if (Buffer.byteLength(value, "utf8") < MIN_NEXTAUTH_SECRET_BYTES) return false;
  if (KNOWN_WEAK_SECRETS.has(value.toLowerCase())) return false;
  if (new Set(value).size < 8) return false;
  return true;
}

/**
 * Validerer konfigurasjon som må være riktig i produksjon. Returnerer en liste
 * med feil, slik at oppstart kan avbrytes før appen begynner å ta trafikk.
 */
export function validateProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV !== "production") return [];

  const isLocalHttp =
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(
      env.NEXTAUTH_URL ?? "",
    );

  const errors: string[] = [];
  if (!env.NEXTAUTH_URL) {
    errors.push("NEXTAUTH_URL mangler");
  } else if (!env.NEXTAUTH_URL.startsWith("https://") && !isLocalHttp) {
    errors.push("NEXTAUTH_URL må starte med https:// i produksjon");
  }

  if (
    env.APP_URL &&
    !env.APP_URL.startsWith("https://") &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(env.APP_URL)
  ) {
    errors.push("APP_URL må starte med https:// når den er satt");
  }

  if (!env.NEXTAUTH_SECRET) {
    errors.push("NEXTAUTH_SECRET mangler");
  } else if (!isStrongNextAuthSecret(env.NEXTAUTH_SECRET)) {
    errors.push(
      "NEXTAUTH_SECRET må være minst 32 byte med tilfeldig data (f.eks. `openssl rand -base64 32`)",
    );
  }

  return errors;
}
