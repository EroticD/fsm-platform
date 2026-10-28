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
  }

  return errors;
}
