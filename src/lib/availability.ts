/**
 * Ren tilgjengelighetsmatematikk for kundeportalen.
 *
 * En ledig time er et halvåpent intervall `[startsAt, endsAt)` i Europe/Oslo.
 * Kandidatene genereres fra avdelingens åpningstider, avgrenses av montørens
 * arbeidstid og filtreres mot fravær, planlagte visiter og aktive
 * reservasjoner. Alle tidspunkt er absolutte, slik at overgangen til og fra
 * sommertid ikke flytter veggklokketiden.
 *
 * Databaseoppslagene ligger i `src/server/availability.ts`; denne modulen er
 * uten I/O og kan testes direkte.
 */

import {
  DEFAULT_BUSINESS_HOURS,
  osloLocalParts,
  osloWallTimeToUtc,
  type BusinessHoursWindow,
} from "@/lib/business-hours";
import {
  addDaysUtc,
  dateOnlyInOslo,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
  type DateOnly,
} from "@/lib/dates";

/** Kandidater genereres hvert halve døgn. */
export const AVAILABILITY_SLOT_MINUTES = 30;

/** Kunden kan bestille inntil 60 dager fram i tid. */
export const BOOKING_HORIZON_DAYS = 60;

/** Maks tre forslag per montør per dag, uansett hvor mange ledige halvtimer. */
export const MAX_SLOTS_PER_DAY = 3;

/** Samme minste ledetid som kundeportalen ellers bruker. */
export const BOOKING_LEAD_HOURS = 24;

/**
 * Når en montør mangler `UserAvailability`, bruker vi avdelingens
 * åpningstider og flagger det i resultatet. Alternativet – å skjule montøren –
 * ville gjort hele portalen tom til noen hadde konfigurert arbeidstid.
 */
export const UNCONFIGURED_AVAILABILITY_POLICY = "business_hours" as const;

export type MinuteWindow = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type BlockingRange = {
  startsAt: Date;
  endsAt: Date;
  /** Heldagsblokkeringer stenger hele kalenderdagen/de dagene de dekker. */
  allDay?: boolean;
  /** Visiter i DONE/CANCELLED blokkerer ikke nye bookinger. */
  status?: string;
};

export type AvailabilitySlot = {
  startsAt: Date;
  endsAt: Date;
  date: DateOnly;
  /** Veggklokketid i Oslo, HH:mm. */
  from: string;
  to: string;
  minutes: number;
};

export type DaySlotInput = {
  date: DateOnly;
  now?: Date;
  businessHours?: readonly BusinessHoursWindow[];
  availability?: readonly MinuteWindow[];
  absences?: readonly BlockingRange[];
  visits?: readonly BlockingRange[];
  holds?: readonly BlockingRange[];
  /** Stengte kalenderdager (helligdager) i Oslo. */
  holidays?: readonly DateOnly[];
  leadHours?: number;
  maxSlots?: number;
  slotMinutes?: number;
};

export type DaySlotResult = {
  date: DateOnly;
  slots: AvailabilitySlot[];
  /** True når montøren faktisk har arbeidstid registrert. */
  availabilityConfigured: boolean;
  /** True når avdelingen faktisk har åpningstider registrert. */
  businessHoursConfigured: boolean;
  /** Hvilken standard som ble brukt da arbeidstid manglet. */
  unconfiguredPolicy: typeof UNCONFIGURED_AVAILABILITY_POLICY | null;
};

/** Ukedag med mandag = 0, samme konvensjon som UserAvailability. */
export function weekdayIndex(date: DateOnly): number {
  const parsed = parseDateOnly(date);
  if (!parsed) return -1;
  return (parsed.getUTCDay() + 6) % 7;
}

export function minutesToTime(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeWindows(
  windows:
    | readonly BusinessHoursWindow[]
    | readonly MinuteWindow[]
    | undefined,
): MinuteWindow[] {
  return (windows ?? []).map((window) => ({
    weekday: window.weekday,
    startMinute:
      "openMinute" in window ? window.openMinute : window.startMinute,
    endMinute:
      "closeMinute" in window ? window.closeMinute : window.endMinute,
  }));
}

function windowsForDay(
  windows: readonly MinuteWindow[],
  weekday: number,
): MinuteWindow[] {
  return windows
    .filter(
      (window) =>
        window.weekday === weekday &&
        Number.isFinite(window.startMinute) &&
        Number.isFinite(window.endMinute) &&
        window.endMinute > window.startMinute,
    )
    .sort((a, b) => a.startMinute - b.startMinute);
}

/** Snittet av to lister med minuttsintervaller. */
export function intersectMinuteWindows(
  first: readonly MinuteWindow[],
  second: readonly MinuteWindow[],
): MinuteWindow[] {
  const result: MinuteWindow[] = [];
  for (const a of first) {
    for (const b of second) {
      const startMinute = Math.max(a.startMinute, b.startMinute);
      const endMinute = Math.min(a.endMinute, b.endMinute);
      if (endMinute > startMinute) {
        result.push({ weekday: a.weekday, startMinute, endMinute });
      }
    }
  }
  return result.sort((a, b) => a.startMinute - b.startMinute);
}

/** Datoene i bestillingsvinduet, inklusive i dag og siste horisontdag. */
export function horizonDates(now = new Date(), days = BOOKING_HORIZON_DAYS): DateOnly[] {
  const first = parseDateOnly(todayInOslo(now));
  if (!first) return [];
  return Array.from({ length: days + 1 }, (_, index) =>
    toDateOnly(addDaysUtc(first, index)),
  );
}

export function isWithinBookingHorizon(
  date: DateOnly,
  now = new Date(),
  days = BOOKING_HORIZON_DAYS,
): boolean {
  const today = todayInOslo(now);
  if (!parseDateOnly(date)) return false;
  return date >= today && date <= toDateOnly(addDaysUtc(parseDateOnly(today)!, days));
}

function effectiveBusinessHours(
  businessHours: readonly BusinessHoursWindow[] | undefined,
): { windows: MinuteWindow[]; configured: boolean } {
  const normalized = normalizeWindows(businessHours);
  return normalized.length > 0
    ? { windows: normalized, configured: true }
    : { windows: normalizeWindows(DEFAULT_BUSINESS_HOURS), configured: false };
}

function isBlockingStatus(status: string | undefined): boolean {
  return status !== "DONE" && status !== "CANCELLED";
}

/**
 * En heldagsblokkering dekker alle kalenderdager den berører. Slutttidspunktet
 * er eksklusivt, slik at en visitt som slutter ved midnatt ikke stenger neste
 * dag.
 */
export function allDayRangeCoversDate(
  range: { startsAt: Date; endsAt: Date },
  date: DateOnly,
): boolean {
  const first = dateOnlyInOslo(range.startsAt);
  const lastInstant = new Date(range.endsAt.getTime() - 1);
  const last = dateOnlyInOslo(lastInstant);
  return date >= first && date <= last;
}

function blocksCandidate(
  date: DateOnly,
  startsAt: Date,
  endsAt: Date,
  ranges: readonly BlockingRange[] | undefined,
): boolean {
  for (const range of ranges ?? []) {
    if (range.status !== undefined && !isBlockingStatus(range.status)) {
      continue;
    }
    if (range.allDay) {
      if (allDayRangeCoversDate(range, date)) return true;
      continue;
    }
    if (startsAt.getTime() < range.endsAt.getTime() && endsAt.getTime() > range.startsAt.getTime()) {
      return true;
    }
  }
  return false;
}

/**
 * Genererer inntil `maxSlots` ledige halvtimer for én dato og én montør.
 *
 * `visits` må inneholde alle visiter som overlapper datoen, også de som startet
 * dagen før. `holds` må inneholde bare aktive, ukonsumerte reservasjoner.
 * Funksjonen filtrerer likevel på status, slik at en DONE-visitt aldri kan
 * blokkere en framtidig time.
 */
export function generateDaySlots(input: DaySlotInput): DaySlotResult {
  const now = input.now ?? new Date();
  const slotMinutes = input.slotMinutes ?? AVAILABILITY_SLOT_MINUTES;
  const maxSlots = Math.max(0, input.maxSlots ?? MAX_SLOTS_PER_DAY);
  const leadHours = input.leadHours ?? BOOKING_LEAD_HOURS;
  const weekday = weekdayIndex(input.date);
  if (weekday < 0) {
    return {
      date: input.date,
      slots: [],
      availabilityConfigured: false,
      businessHoursConfigured: false,
      unconfiguredPolicy: null,
    };
  }

  const business = effectiveBusinessHours(input.businessHours);
  const availability = normalizeWindows(input.availability);
  const availabilityConfigured = availability.length > 0;
  const holiday = (input.holidays ?? []).includes(input.date);
  const availabilityWindows = availabilityConfigured
    ? windowsForDay(availability, weekday)
    : windowsForDay(business.windows, weekday);

  const businessWindows = windowsForDay(business.windows, weekday);
  const windows = holiday
    ? []
    : intersectMinuteWindows(availabilityWindows, businessWindows);
  const earliest = now.getTime() + leadHours * 60 * 60_000;
  const found: AvailabilitySlot[] = [];
  const seen = new Set<number>();

  for (const window of windows) {
    const firstStart =
      Math.ceil(window.startMinute / slotMinutes) * slotMinutes;
    for (
      let minute = firstStart;
      minute + slotMinutes <= window.endMinute;
      minute += slotMinutes
    ) {
      const startsAt = osloWallTimeToUtc(input.date, minute);
      const endsAt = osloWallTimeToUtc(input.date, minute + slotMinutes);

      // Vår overgang kan hoppe over veggklokketid. Da finnes ikke tidspunktet,
      // og Oslo-konverteringen kan gi et tidspunkt som ikke ligger på riktig
      // halvtime. Vi avviser slike kandidater i stedet for å tilby en time
      // som ikke finnes.
      if (dateOnlyInOslo(startsAt) !== input.date) continue;
      if (dateOnlyInOslo(new Date(endsAt.getTime() - 1)) !== input.date) {
        continue;
      }
      // Vår-overgangen hopper over 02:00–03:00. En veggklokketid som ikke
      // finnes skal ikke tilbys, selv om den konverteres til et gyldig instant.
      if (osloLocalParts(startsAt).minuteOfDay !== minute) continue;
      if (startsAt.getTime() < earliest) continue;
      if (seen.has(startsAt.getTime())) continue;
      if (
        blocksCandidate(input.date, startsAt, endsAt, input.absences) ||
        blocksCandidate(input.date, startsAt, endsAt, input.visits) ||
        blocksCandidate(input.date, startsAt, endsAt, input.holds)
      ) {
        continue;
      }

      seen.add(startsAt.getTime());
      found.push({
        startsAt,
        endsAt,
        date: input.date,
        from: minutesToTime(minute),
        to: minutesToTime(minute + slotMinutes),
        minutes: slotMinutes,
      });
    }
  }

  found.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return {
    date: input.date,
    slots: found.slice(0, maxSlots),
    availabilityConfigured,
    businessHoursConfigured: business.configured,
    unconfiguredPolicy: availabilityConfigured
      ? null
      : UNCONFIGURED_AVAILABILITY_POLICY,
  };
}

/**
 * Kontrollerer et vilkårlig tidsintervall (brukt av kontorets
 * bekreftelseskø). Intervallene må ligge helt innenfor både åpningstid og
 * arbeidstid, og verken fravær, visiter eller reservasjoner kan overlappe.
 */
export function isRangeBookable(input: {
  date: DateOnly;
  startsAt: Date;
  endsAt: Date;
  now?: Date;
  businessHours?: readonly BusinessHoursWindow[];
  availability?: readonly MinuteWindow[];
  absences?: readonly BlockingRange[];
  visits?: readonly BlockingRange[];
  holds?: readonly BlockingRange[];
  /** Stengte kalenderdager (helligdager) i Oslo. */
  holidays?: readonly DateOnly[];
  leadHours?: number;
}): boolean {
  if (!(input.startsAt instanceof Date) || !(input.endsAt instanceof Date)) {
    return false;
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) return false;
  if (!isWithinBookingHorizon(input.date, input.now ?? new Date())) {
    return false;
  }
  if ((input.holidays ?? []).includes(input.date)) return false;
  const weekday = weekdayIndex(input.date);
  if (weekday < 0) return false;

  const now = input.now ?? new Date();
  const earliest =
    now.getTime() + (input.leadHours ?? BOOKING_LEAD_HOURS) * 60 * 60_000;
  if (input.startsAt.getTime() < earliest) return false;

  const business = effectiveBusinessHours(input.businessHours);
  const availability = normalizeWindows(input.availability);
  const availabilityWindows =
    availability.length > 0
      ? windowsForDay(availability, weekday)
      : windowsForDay(business.windows, weekday);
  const businessWindows = windowsForDay(business.windows, weekday);
  const windows = intersectMinuteWindows(availabilityWindows, businessWindows);

  const startsInWindow = windows.some((window) => {
    const windowStart = osloWallTimeToUtc(input.date, window.startMinute);
    const windowEnd = osloWallTimeToUtc(input.date, window.endMinute);
    return (
      input.startsAt.getTime() >= windowStart.getTime() &&
      input.endsAt.getTime() <= windowEnd.getTime()
    );
  });
  if (!startsInWindow) return false;

  return !(
    blocksCandidate(input.date, input.startsAt, input.endsAt, input.absences) ||
    blocksCandidate(input.date, input.startsAt, input.endsAt, input.visits) ||
    blocksCandidate(input.date, input.startsAt, input.endsAt, input.holds)
  );
}

/**
 * Finner en ledig starttid for et ønsket tidsvindu, med samme halvtimesrutenett
 * som portalen. Brukes av kontorkøen når en gammel PENDING-forespørsel skal
 * bekreftes uten at saksbehandleren velger tid manuelt.
 */
export function findSlotForWindow(input: {
  date: DateOnly;
  requestedFrom: string;
  requestedTo: string;
  now?: Date;
  businessHours?: readonly BusinessHoursWindow[];
  availability?: readonly MinuteWindow[];
  absences?: readonly BlockingRange[];
  visits?: readonly BlockingRange[];
  holds?: readonly BlockingRange[];
  /** Stengte kalenderdager (helligdager) i Oslo. */
  holidays?: readonly DateOnly[];
  leadHours?: number;
}): AvailabilitySlot | null {
  const from = parseTime(input.requestedFrom);
  const to = parseTime(input.requestedTo);
  if (from === null || to === null || to <= from) return null;
  const result = generateDaySlots({
    date: input.date,
    now: input.now,
    businessHours: input.businessHours,
    availability: input.availability,
    absences: input.absences,
    visits: input.visits,
    holds: input.holds,
    holidays: input.holidays,
    leadHours: input.leadHours,
    maxSlots: Number.MAX_SAFE_INTEGER,
    slotMinutes: to - from,
  });
  return (
    result.slots.find(
      (slot) => slot.startsAt.getTime() === osloWallTimeToUtc(input.date, from).getTime(),
    ) ?? null
  );
}

function parseTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
