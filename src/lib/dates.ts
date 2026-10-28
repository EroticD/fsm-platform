/**
 * Hjelpere for rene datoer (uten klokkeslett).
 *
 * Kalenderdatoer lagres som PostgreSQL `date` og leses tilbake som UTC-midnatt.
 * Det gjør at en dato skrevet som «2026-10-19» alltid blir samme dag, uavhengig
 * av tidssone på serveren. For sammenligninger mot tidsstempler (createdAt)
 * finnes `osloDayStart`/`osloDayEnd`, som regner om en Oslo-dag til UTC.
 */

export type DateOnly = string;

const OSLO_TZ = "Europe/Oslo";

const osloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OSLO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dagens dato i Oslo som YYYY-MM-DD. */
export function todayInOslo(now = new Date()): DateOnly {
  return osloDateFormatter.format(now);
}

/** Hvor mange minutter Oslo ligger foran UTC på et gitt tidspunkt. */
function osloOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OSLO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Første UTC-tidspunkt for en Oslo-dag. Brukes når en dato skal sammenlignes
 * med et tidsstempel (f.eks. `createdAt`), ikke med et `date`-felt.
 */
export function osloDayStart(dateOnly: DateOnly): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);

  let instant = new Date(utcMidnight);
  // To iterasjoner er nok til å håndtere sommertidsovergangene.
  for (let i = 0; i < 2; i += 1) {
    instant = new Date(utcMidnight - osloOffsetMinutes(instant) * 60_000);
  }
  return instant;
}

/** Siste UTC-tidspunkt (inklusiv) for en Oslo-dag. */
export function osloDayEnd(dateOnly: DateOnly): Date {
  const date = parseDateOnly(dateOnly);
  const next = date ? addDaysUtc(date, 1) : null;
  const nextDateOnly = next ? toDateOnly(next) : dateOnly;
  return new Date(osloDayStart(nextDateOnly).getTime() - 1);
}

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

// ---------------------------------------------------------------------------
// Lokalisert visning
// ---------------------------------------------------------------------------
//
// ISO-funksjonene over brukes til maskinlesbare attributter, sortering og
// API-kall. Disse hjelperne gir menneskelig, språktilpasset visning uten å
// endre lagringsformatet. Datoer uten klokkeslett tolkes som UTC-midnatt (slik
// de lagres i databasen), så visningen aldri havner på feil dag.

export type DateDisplayOptions = Intl.DateTimeFormatOptions;

function intlLocale(locale?: string | null): string {
  if (locale?.toLowerCase().startsWith("en")) return "en-GB";
  return "nb-NO";
}

function isPureDate(value: Date | string): boolean {
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  }
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  );
}

function dateFromValue(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return parseDateOnly(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Lokalisert dato, f.eks. «19. okt. 2026» eller «19 Oct 2026». */
export function formatDateLocalized(
  value: Date | string | null | undefined,
  locale?: string | null,
  options: DateDisplayOptions = { dateStyle: "medium" },
  fallback = "",
): string {
  if (!value) return fallback;
  const date = dateFromValue(value);
  if (!date) return fallback;

  const pureDate = isPureDate(value);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...options,
    timeZone: pureDate ? "UTC" : OSLO_TZ,
  }).format(date);
}

/** Lokalisert dato og klokkeslett, f.eks. «19. okt. 2026, 14:30». */
export function formatDateTimeLocalized(
  value: Date | string | null | undefined,
  locale?: string | null,
  fallback = "",
): string {
  return formatDateLocalized(
    value,
    locale,
    { dateStyle: "medium", timeStyle: "short" },
    fallback,
  );
}

/** Lokalisert periode. Éndagsoppdrag viser bare én dato. */
export function formatDateRangeLocalized(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  locale?: string | null,
  fallback = "",
): string {
  if (!start) return fallback;
  const startText = formatDateLocalized(start, locale, undefined, fallback);
  if (!startText) return fallback;

  const startIso = toDateOnly(start);
  const endIso = toDateOnly(end);
  if (!endIso || endIso <= startIso) return startText;

  const endText = formatDateLocalized(end, locale, undefined, fallback);
  if (!endText) return startText;
  return `${startText} – ${endText}`;
}
