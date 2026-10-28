/**
 * Relativ tid for varsler. Bare hendelser siste døgn vises relativt; eldre
 * varsler får en lokalisert dato og klokkeslett av komponenten.
 */
export function relativeTimeLabel(
  value: Date | string | null | undefined,
  locale?: string | null,
  now: Date = new Date(),
): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;

  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(diffSeconds) >= 86_400) return null;

  const formatter = new Intl.RelativeTimeFormat(
    locale?.toLowerCase().startsWith("en") ? "en-GB" : "nb-NO",
    { numeric: "auto" },
  );

  const absolute = Math.abs(diffSeconds);
  if (absolute < 60) return formatter.format(0, "minute");
  if (absolute < 3600) return formatter.format(Math.round(diffSeconds / 60), "minute");
  return formatter.format(Math.round(diffSeconds / 3600), "hour");
}
