/**
 * Hjelpere for rene datoer (uten klokkeslett).
 *
 * Oppdrags datoer lagres som UTC-midnatt i databasen. Det gjør at en dato
 * skrevet som «2026-10-19» alltid blir samme dag, uavhengig av tidssone på
 * serveren.
 */

/** Tolker en dato på formatet YYYY-MM-DD som UTC-midnatt. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formaterer en dato til YYYY-MM-DD i UTC. */
export function toDateOnly(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/** Legger til dager i UTC, uten sommertidsproblemer. */
export function addDaysUtc(value: Date, days: number): Date {
  const copy = new Date(value.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * Gjør om en eksklusiv sluttdato (slik FullCalendar bruker) til siste
 * inkluderte dag. Returnerer tom streng når det ikke finnes en sluttdato.
 */
export function inclusiveLastDay(endExclusive: string | Date | null | undefined): string {
  const date = typeof endExclusive === "string" ? parseDateOnly(endExclusive.slice(0, 10)) : endExclusive;
  if (!date) return "";
  return toDateOnly(addDaysUtc(date, -1));
}

const rangeFormatter = new Intl.DateTimeFormat("no-NO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Formaterer en datoperiode på norsk. Éndagsoppdrag får én dato. */
export function formatDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
): string {
  const startText = toDateOnly(start);
  const endText = toDateOnly(end);
  if (!startText) return "";
  if (!endText || endText <= startText) return rangeFormatter.format(new Date(`${startText}T00:00:00.000Z`));
  return `${rangeFormatter.format(new Date(`${startText}T00:00:00.000Z`))} – ${rangeFormatter.format(
    new Date(`${endText}T00:00:00.000Z`)
  )}`;
}
