/**
 * Velger en trygg lenke for et varsel ut fra mottakerens rolle.
 *
 * Rapportvarselet opprettes med kontorets oppdragslenke. Kundeportalbrukere
 * skal i stedet til rapportdelen av portalen sin, og skal aldri sendes til
 * kontorets oppdragssider.
 */
export function notificationHrefForUser(
  role: string,
  type: string,
  href: string | null,
): string | null {
  if (!href) return null;
  if (role !== "CUSTOMER") return href;
  if (
    type === "REPORT_READY" ||
    /^\/(oppdrag|mine-oppdrag|rapporter)(\/|$)/.test(href)
  ) {
    return "/kundeportal#rapporter";
  }
  return href;
}

/** Interne stier kan inneholde spørring og anker, men aldri et eget opphav. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Godtar bare en intern, relativ sti. Brukes både når en lenke lagres og når
 * den senere brukes til viderekobling, slik at en ondsinnet verdi i databasen
 * eller skjemaet aldri kan bli en åpen viderekobling.
 */
export function isSafeNotificationHref(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const href = value.trim();
  if (!href.startsWith("/")) return false;
  // «//vert» og «/\vert» tolkes som protokoll-relative av nettleseren.
  if (href.startsWith("//") || href.includes("\\")) return false;
  if (CONTROL_CHARS.test(href)) return false;

  try {
    const base = "http://notification.internal";
    const url = new URL(href, base);
    return url.origin === base;
  } catch {
    return false;
  }
}
