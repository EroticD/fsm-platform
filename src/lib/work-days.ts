import {
  addDaysUtc,
  dateOnlyInOslo,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";

/**
 * Arbeidsdager for et oppdrag.
 *
 * Et oppdrag planlegges som rene kalenderdager. Hver dag har én intern
 * `Visit` (arbeidsøkt) med `allDay: true`, fra Oslo-midnatt til neste
 * Oslo-midnatt. Datohjelperne brukes bevisst, slik at sommertid ikke flytter
 * en dag eller gir en ekstra dag.
 */

/** Sikkerhetsgrense mot en feilaktig, enorm datoperiode. */
export const MAX_WORK_ORDER_DAYS = 366;

export type WorkDayPeriod = {
  /** Kalenderdato i Europe/Oslo, YYYY-MM-DD. */
  date: string;
  /** Sekvensnummer i oppdraget, med første dag som 0. */
  sequence: number;
  /** Oslo-midnatt for dagen (inklusiv). */
  startsAt: Date;
  /** Oslo-midnatt neste dag (eksklusiv). */
  endsAt: Date;
};

/** Oslo-midnatt for én kalenderdato, og neste midnatt som eksklusiv slutt. */
export function workDayPeriod(date: string): { startsAt: Date; endsAt: Date } {
  const parsed = parseDateOnly(date);
  if (!parsed) throw new Error(`workDayPeriod: ugyldig dato ${date}`);
  return {
    startsAt: osloDayStart(date),
    endsAt: osloDayStart(toDateOnly(addDaysUtc(parsed, 1))),
  };
}

/**
 * Alle arbeidsdager i `scheduledFor..scheduledTo`, inklusiv begge datoene.
 * En tom eller tidligere sluttdato betyr éndagsoppdrag.
 */
export function enumerateWorkDays(
  scheduledFor: Date | string,
  scheduledTo?: Date | string | null,
): WorkDayPeriod[] {
  const startDate =
    typeof scheduledFor === "string"
      ? toDateOnly(parseDateOnly(scheduledFor))
      : toDateOnly(scheduledFor);
  const start = parseDateOnly(startDate);
  if (!start) return [];

  const requestedEnd =
    typeof scheduledTo === "string" ? scheduledTo : toDateOnly(scheduledTo);
  const end = parseDateOnly(requestedEnd);
  const last = end && end > start ? end : start;

  const days: WorkDayPeriod[] = [];
  for (let index = 0; index < MAX_WORK_ORDER_DAYS; index += 1) {
    const current = addDaysUtc(start, index);
    if (current > last) break;
    const date = toDateOnly(current);
    const period = workDayPeriod(date);
    days.push({ date, sequence: index, ...period });
  }
  return days;
}

/**
 * Er visitten én enkelt arbeidsdag? Eldre, flerdagers heldagsvisiter svarer
 * nei og skal splittes av backfill-skriptet.
 */
export function coversOneWorkDay(startsAt: Date, endsAt: Date): boolean {
  const startDate = dateOnlyInOslo(startsAt);
  const lastIncluded = dateOnlyInOslo(new Date(endsAt.getTime() - 1));
  return startDate === lastIncluded;
}

export type BackfillVisit = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  sequence: number;
};

export type BackfillSplit = {
  /** Originalraden beholdes som første dag, med tidspunktene sine. */
  keep: { id: string; startsAt: Date; endsAt: Date; sequence: number };
  /** Nye dager. Ingen tidspunkter kopieres fra originalraden. */
  create: WorkDayPeriod[];
};

/**
 * Planlegger splitting av én eldre flerdagers heldagsvisitt.
 *
 * Tidsstemplene (`enRouteAt`, `onSiteAt`, `doneAt`) og statusen blir liggende
 * på originalen, som blir første dag. Nye dager er rene, planlagte arbeidsøkter
 * uten tidspunkter. Det er derfor ingen risiko for at fullført tid dupliseres.
 */
export function planBackfillSplit(visit: BackfillVisit): BackfillSplit | null {
  if (!visit.allDay) return null;

  const firstDate = dateOnlyInOslo(visit.startsAt);
  const lastDate = dateOnlyInOslo(new Date(visit.endsAt.getTime() - 1));
  if (firstDate >= lastDate) return null;

  const days = enumerateWorkDays(firstDate, lastDate);
  if (days.length <= 1) return null;

  const [first, ...rest] = days;
  return {
    keep: {
      id: visit.id,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      sequence: 0,
    },
    create: rest,
  };
}
