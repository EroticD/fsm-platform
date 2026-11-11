/**
 * Godtar både relative stier ("/kunder") og absolutte URL-er, men returnerer
 * alltid en trygg, relativ sti. Da kan vi aldri sende brukeren til et annet
 * domene etter innlogging.
 */
export function safeRelativeTarget(value: string | null): string {
  if (!value) return "/";
  try {
    const url = new URL(value, "http://relative.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";
    const target = `${url.pathname}${url.search}${url.hash}` || "/";

    // URL-normalisering kan gjøre "/..//evil.com" om til "//evil.com", som
    // nettleseren tolker som et annet vertsnavn. Avvis også backslash, som
    // enkelte nettlesere behandler som skråstrek.
    if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
      return "/";
    }
    return target;
  } catch {
    return "/";
  }
}

/**
 * Som `safeRelativeTarget`, men avviser også tilbakeføring til innloggings-
 * eller auth-endepunkter. NextAuth kan sende `callbackUrl=/api/auth/signin`
 * eller `/logg-inn` når en beskyttet side videresender til innlogging. Uten
 * denne vakten havner brukeren på innloggingssiden igjen etter vellykket
 * innlogging i stedet for på rollens hjem.
 *
 * Returen er alltid en relativ sti. Når målet er login/NextAuth returneres
 * "/", slik at kalleren faller tilbake til rollens (og enhetens) hjem.
 */
export function safeLoginCallbackTarget(
  value: string | null | undefined,
): string {
  const target = safeRelativeTarget(value ?? null);
  if (target === "/") return "/";
  const path = target.split(/[?#]/, 1)[0];
  if (
    path === "/logg-inn" ||
    path.startsWith("/logg-inn/") ||
    path === "/api/auth" ||
    path.startsWith("/api/auth/")
  ) {
    return "/";
  }
  return target;
}
