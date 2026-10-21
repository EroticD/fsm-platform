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
 * Legger til hele måneder i UTC. Hvis startdagen ikke finnes i målmåneden,
 * brukes siste dag i måneden (31. januar + 1 måned = 28./29. februar).
 */
export function addMonthsUtc(value: Date, months: number): Date {
  const copy = new Date(value.getTime());
  const day = copy.getUTCDate();
  copy.setUTCDate(1);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(copy.getUTCFullYear(), copy.getUTCMonth() + 1, 0),
  ).getUTCDate();
  copy.setUTCDate(Math.min(day, lastDay));
  return copy;
}

/**
 * Første forekomst av et intervall på eller etter `notBefore`.
 *
 * Forekomstene regnes alltid fra `start`, ikke fra forrige forekomst. Da
 * beholder en avtale som startet 31. januar, dagen sin også etter februar.
 */
export function firstOccurrenceOnOrAfter(
  start: Date,
  months: number,
  notBefore: Date,
): Date {
  if (months <= 0) return new Date(start.getTime());

  let index = 0;
  let occurrence = new Date(start.getTime());
  while (occurrence < notBefore && index < 10000) {
    index += 1;
    occurrence = addMonthsUtc(start, index * months);
  }
  return occurrence;
}

/**
 * Siste forekomst av et intervall på eller før `notAfter`. Brukes for å finne
 * servicedatoen som faktisk forfaller nå, selv om bakgrunnsjobben har vært
 * nede en stund. Kalleren må selv sjekke at datoen ikke er før avtalens
 * `nextServiceDate`.
 */
export function latestOccurrenceOnOrBefore(
  start: Date,
  months: number,
  notAfter: Date,
): Date {
  if (months <= 0) return new Date(start.getTime());
  if (start > notAfter) return new Date(start.getTime());

  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const endMonth = notAfter.getUTCFullYear() * 12 + notAfter.getUTCMonth();
  let index = Math.max(0, Math.floor((endMonth - startMonth) / months));
  let occurrence = addMonthsUtc(start, index * months);

  while (occurrence > notAfter && index > 0) {
    index -= 1;
    occurrence = addMonthsUtc(start, index * months);
  }

  while (index < 10000) {
    const next = addMonthsUtc(start, (index + 1) * months);
    if (next > notAfter) break;
    index += 1;
    occurrence = next;
  }

  return occurrence;
}

/** Dagens dato som UTC-midnatt, uten klokkeslett. */
export function todayUtc(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
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

const pad2 = (num: number) => String(num).padStart(2, "0");

/** Formaterer en dato som ISO 8601 (YYYY-MM-DD). */
export function formatDate(
  value: Date | string | null | undefined,
  fallback = ""
): string {
  if (!value) return fallback;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return fallback;

  // Rene datoer lagres som UTC-midnatt. Tidspunkter vises i lokal tid.
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return date.toISOString().slice(0, 10);
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Formaterer dato og klokkeslett som ISO 8601 i lokal tid
 * (YYYY-MM-DDTHH:mm).
 */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

/**
 * Formaterer en datoperiode som ISO 8601 (YYYY-MM-DD).
 * Éndagsoppdrag får én dato.
 */
export function formatDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
): string {
  const startText = toDateOnly(start);
  const endText = toDateOnly(end);
  if (!startText) return "";
  if (!endText || endText <= startText) return startText;
  return `${startText} – ${endText}`;
}
