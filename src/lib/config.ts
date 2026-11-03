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
    errors.push("APP_URL must start with https:// when set");
  }

  if (!env.NEXTAUTH_SECRET) {
    errors.push("NEXTAUTH_SECRET is missing");
  } else if (!isStrongNextAuthSecret(env.NEXTAUTH_SECRET)) {
    errors.push(
      "NEXTAUTH_SECRET must be at least 32 bytes of random data (for example `openssl rand -base64 32`)",
    );
  }

  // Proxykonfigurasjonen må ikke være tvetydig i produksjon. En glemt
  // TRUST_PROXY gjør IP-rate-limits inaktive, mens et feil antall hopp kan
  // gjøre en klientstyrt X-Forwarded-For-verdi til rate-limit-nøkkel.
  const trustProxyRaw = (env.TRUST_PROXY ?? "").trim();
  if (trustProxyRaw && trustProxyRaw !== "true" && trustProxyRaw !== "false") {
    errors.push("TRUST_PROXY must be true or false");
  }

  const hopsRaw = (env.TRUST_PROXY_HOPS ?? "").trim();
  if (trustProxyRaw === "true") {
    if (!hopsRaw) {
      errors.push(
        "TRUST_PROXY_HOPS must be set explicitly when TRUST_PROXY=true (1 for one proxy)",
      );
    } else if (!/^[1-9][0-9]?$/.test(hopsRaw) || Number(hopsRaw) > 10) {
      errors.push("TRUST_PROXY_HOPS must be an integer between 1 and 10");
    }
  } else if (hopsRaw) {
    errors.push(
      "TRUST_PROXY_HOPS is set but TRUST_PROXY is not true - ambiguous configuration",
    );
  }

  return errors;
}
