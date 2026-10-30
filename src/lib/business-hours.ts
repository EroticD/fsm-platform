/**
 * Ren matematikk for åpningstider og SLA-frister.
 *
 * Alle veggklokketider er minutter fra midnatt i Europe/Oslo. Funksjonene
 * regner om til absolutte UTC-tidspunkter med `osloOffsetMinutes`, slik at
 * sommertidsovergangene gir riktig varighet uten å flytte veggklokken.
 * Databaseoppslagene ligger i `src/server/business-hours.ts`.
 */

import {
  addDaysUtc,
  dateOnlyInOslo,
  osloDayStart,
  osloOffsetMinutes,
  parseDateOnly,
  toDateOnly,
  type DateOnly,
} from "@/lib/dates";

/** Én åpningsperiode for en ukedag. 0 = mandag, 6 = søndag. */
export type BusinessHoursWindow = {
  weekday: number;
  openMinute: number;
  closeMinute: number;
};

/** Kalenderen SLA-beregningen bruker. `holidays` er rene datoer i Oslo. */
export type BusinessCalendar = {
  windows: BusinessHoursWindow[];
  holidays: readonly DateOnly[];
};

/** Standard når avdelingen ikke har lagret åpningstider: hverdager 08–16. */
export const DEFAULT_BUSINESS_HOURS: BusinessHoursWindow[] = [
  { weekday: 0, openMinute: 8 * 60, closeMinute: 16 * 60 },
  { weekday: 1, openMinute: 8 * 60, closeMinute: 16 * 60 },
  { weekday: 2, openMinute: 8 * 60, closeMinute: 16 * 60 },
  { weekday: 3, openMinute: 8 * 60, closeMinute: 16 * 60 },
  { weekday: 4, openMinute: 8 * 60, closeMinute: 16 * 60 },
];

export const MAX_BUSINESS_HOURS_MINUTES = 24 * 60;

export type OsloLocalParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minuteOfDay: number;
  dateOnly: DateOnly;
};

const osloPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** Dato, ukedag og minutt på dagen slik klokken viser i Oslo. */
export function osloLocalParts(value: Date): OsloLocalParts {
  const parts = osloPartsFormatter.formatToParts(value);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;

  return {
    year,
    month,
    day,
    weekday,
    minuteOfDay: hour * 60 + minute,
    dateOnly: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/**
 * Gjør en Oslo-veggklokketid om til et absolutt tidspunkt. To iterasjoner er
 * nok til å håndtere begge sommertidsovergangene, på samme måte som
 * `osloDayStart`.
 */
export function osloWallTimeToUtc(dateOnly: DateOnly, minuteOfDay: number): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const totalMinutes = minuteOfDay;
  const utcMidnight = Date.UTC(year, month - 1, day);

  let instant = new Date(utcMidnight + totalMinutes * 60_000);
  for (let i = 0; i < 2; i += 1) {
    instant = new Date(
      utcMidnight +
        totalMinutes * 60_000 -
        osloOffsetMinutes(instant) * 60_000,
    );
  }
  return instant;
}

function windowsFor(calendar: BusinessCalendar, weekday: number) {
  return calendar.windows
    .filter(
      (window) =>
        window.weekday === weekday && window.closeMinute > window.openMinute,
    )
    .sort((a, b) => a.openMinute - b.openMinute);
}

function isHoliday(calendar: BusinessCalendar, dateOnly: DateOnly): boolean {
  return calendar.holidays.includes(dateOnly);
}

/** Er tidspunktet innenfor åpningstidene og ikke på en helligdag? */
export function isOpenAt(
  value: Date,
  calendar: BusinessCalendar,
): boolean {
  const local = osloLocalParts(value);
  if (isHoliday(calendar, local.dateOnly)) return false;
  return windowsFor(calendar, local.weekday).some(
    (window) =>
      local.minuteOfDay >= window.openMinute &&
      local.minuteOfDay < window.closeMinute,
  );
}

/** Første åpningstidspunkt på eller etter `value`. */
export function nextOpening(
  value: Date,
  calendar: BusinessCalendar,
): Date | null {
  let dateOnly = dateOnlyInOslo(value);
  for (let dayOffset = 0; dayOffset < 3_660; dayOffset += 1) {
    if (!isHoliday(calendar, dateOnly)) {
      const local = osloLocalParts(value);
      const weekday =
        dayOffset === 0
          ? local.weekday
          : (local.weekday + dayOffset) % 7;
      for (const window of windowsFor(calendar, weekday)) {
        const open = osloWallTimeToUtc(dateOnly, window.openMinute);
        if (open.getTime() >= value.getTime()) return open;
      }
    }
    const parsed = parseDateOnly(dateOnly);
    if (!parsed) return null;
    dateOnly = toDateOnly(addDaysUtc(parsed, 1));
  }
  return null;
}

/**
 * Legger til et antall åpningstidsminutter. Start utenfor åpningstid flyttes
 * først til neste åpning. Helligdager hoppes over, og sommertid håndteres ved
 * at hver dags vinduer regnes som absolutte tidspunkter.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  calendar: BusinessCalendar,
): Date {
  const requested = Math.max(0, Math.round(minutes));
  if (requested === 0) return new Date(start.getTime());

  let remaining = requested;
  let cursor = new Date(start.getTime());
  let dateOnly = dateOnlyInOslo(cursor);
  const startWeekday = osloLocalParts(cursor).weekday;

  for (let dayOffset = 0; dayOffset < 3_660; dayOffset += 1) {
    const weekday = (startWeekday + dayOffset) % 7;
    if (!isHoliday(calendar, dateOnly)) {
      for (const window of windowsFor(calendar, weekday)) {
        const open = osloWallTimeToUtc(dateOnly, window.openMinute);
        const close = osloWallTimeToUtc(dateOnly, window.closeMinute);
        if (close.getTime() <= cursor.getTime()) continue;
        if (open.getTime() > cursor.getTime()) cursor = open;

        const available = Math.floor(
          (close.getTime() - cursor.getTime()) / 60_000,
        );
        if (available >= remaining) {
          return new Date(cursor.getTime() + remaining * 60_000);
        }
        remaining -= available;
        cursor = new Date(close.getTime());
      }
    }

    const parsed = parseDateOnly(dateOnly);
    if (!parsed) break;
    const nextDay = addDaysUtc(parsed, 1);
    dateOnly = toDateOnly(nextDay);
    const nextMidnight = osloDayStart(dateOnly);
    if (nextMidnight.getTime() > cursor.getTime()) cursor = nextMidnight;
  }

  // Kalenderen har ingen åpningstider. Returner et deterministisk tidspunkt
  // langt fram i stedet for å henge i en uendelig løkke.
  return cursor;
}

/** Antall åpningstidsminutter mellom to tidspunkter. */
export function businessMinutesBetween(
  start: Date,
  end: Date,
  calendar: BusinessCalendar,
): number {
  if (end.getTime() <= start.getTime()) return 0;
  let total = 0;
  const cursor = new Date(start.getTime());
  let dateOnly = dateOnlyInOslo(cursor);
  const startWeekday = osloLocalParts(cursor).weekday;

  for (let dayOffset = 0; dayOffset < 3_660; dayOffset += 1) {
    const weekday = (startWeekday + dayOffset) % 7;
    if (!isHoliday(calendar, dateOnly)) {
      for (const window of windowsFor(calendar, weekday)) {
        const open = osloWallTimeToUtc(dateOnly, window.openMinute);
        const close = osloWallTimeToUtc(dateOnly, window.closeMinute);
        if (close.getTime() <= start.getTime()) continue;
        if (open.getTime() >= end.getTime()) return total;
        const from = Math.max(open.getTime(), start.getTime());
        const to = Math.min(close.getTime(), end.getTime());
        if (to > from) total += Math.floor((to - from) / 60_000);
      }
    }
    if (
      dayOffset > 0 &&
      osloDayStart(dateOnly).getTime() >= end.getTime()
    ) {
      break;
    }
    const parsed = parseDateOnly(dateOnly);
    if (!parsed) break;
    dateOnly = toDateOnly(addDaysUtc(parsed, 1));
    if (osloDayStart(dateOnly).getTime() >= end.getTime()) break;
  }
  return total;
}
