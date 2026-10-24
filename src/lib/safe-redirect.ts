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
