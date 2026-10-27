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
