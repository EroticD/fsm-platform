import { dateOnlyInOslo } from "@/lib/dates";

/**
 * Tidsregistrering per arbeidsdag.
 *
 * Montøren følger EN_ROUTE → ON_SITE → DONE på én dag om gangen, og kan ha
 * flere oppdrag samme dag. Tidsstemplene er absolutte og settes bare én gang:
 *
 *   enRouteAt         start på tilkjøring
 *   onSiteAt          start på arbeid
 *   doneAt            arbeidet ferdig
 *   travelFromEndedAt retur-/viderekjøring ferdig
 *
 * Segmentet fra `doneAt` til `travelFromEndedAt` er returkjøring for denne
 * visitten. Når montøren starter EN_ROUTE på neste visitt, lukkes samme
 * segment som tilkjøring for neste visitt. Det er bevisst samme elapsed-tid,
 * ikke to separate reiser.
 */

const MINUTE_MS = 60_000;

export type VisitTimeFields = {
  enRouteAt: Date | null;
  onSiteAt: Date | null;
  doneAt: Date | null;
  travelFromEndedAt?: Date | null;
};

export type VisitTimeMetrics = {
  /** Tilkjøring: `onSiteAt − enRouteAt`. */
  travelToMinutes: number | null;
  /** Arbeid: `doneAt − onSiteAt`. */
  workMinutes: number | null;
  /** Retur-/viderekjøring: `travelFromEndedAt − doneAt`. */
  travelFromMinutes: number | null;
  /** Tilkjøring + arbeid + returkjøring. */
  totalMinutes: number | null;
  /** Bakoverkompatibelt alias for `travelToMinutes`. */
  travelMinutes: number | null;
  /** Har dagen fått minst ett tidsstempel? */
  started: boolean;
  /** Er arbeidet fullført? */
  completed: boolean;
};

export type TimeTotals = {
  travelToMinutes: number;
  workMinutes: number;
  travelFromMinutes: number;
  /** Alle tre segmentene. Reisetid er alltid inkludert. */
  totalMinutes: number;
  /** Sum reisetid (til + fra) for kompatibilitet med eldre visninger. */
  travelMinutes: number;
  /** Antall økter som inngår i summeringen. */
  sessions: number;
  /** Antall økter med fullført arbeid. */
  completedSessions: number;
  /** Antall økter som er startet, men ikke fullført. */
  ongoingSessions: number;
};

export type DailyTimeSummary = TimeTotals & {
  /** Kalenderdato i Europe/Oslo, YYYY-MM-DD. */
  date: string;
};

export type WorkOrderTimeSummary = TimeTotals & {
  days: DailyTimeSummary[];
};

function minutesBetween(start: Date | null, end: Date | null): number | null {
  if (
    !(start instanceof Date) ||
    !(end instanceof Date) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return null;
  }
  const delta = end.getTime() - start.getTime();
  if (delta < 0) return 0;
  return Math.round(delta / MINUTE_MS);
}

/** Tilkjøring i minutter: `onSiteAt − enRouteAt`. */
export function travelToMinutes(visit: VisitTimeFields): number | null {
  return minutesBetween(visit.enRouteAt, visit.onSiteAt);
}

/** Bakoverkompatibelt navn for tilkjøring. */
export function travelMinutes(visit: VisitTimeFields): number | null {
  return travelToMinutes(visit);
}

/** Arbeidstid i minutter: `doneAt − onSiteAt`. */
export function workMinutes(visit: VisitTimeFields): number | null {
  return minutesBetween(visit.onSiteAt, visit.doneAt);
}

/** Retur-/viderekjøring i minutter: `travelFromEndedAt − doneAt`. */
export function travelFromMinutes(visit: VisitTimeFields): number | null {
  return minutesBetween(visit.doneAt, visit.travelFromEndedAt ?? null);
}

/**
 * Arbeidstid mens dagen pågår. Brukes av kalenderen når bare `onSiteAt` er
 * satt, og gir ellers samme tall som `workMinutes`.
 */
export function ongoingWorkMinutes(
  visit: VisitTimeFields,
  now = new Date(),
): number | null {
  return minutesBetween(visit.onSiteAt, visit.doneAt ?? now);
}

export function visitTimeMetrics(
  visit: VisitTimeFields,
  now?: Date,
): VisitTimeMetrics {
  const travelTo = travelToMinutes(visit);
  const work = now ? ongoingWorkMinutes(visit, now) : workMinutes(visit);
  const travelFrom = travelFromMinutes(visit);
  const parts = [travelTo, work, travelFrom].filter(
    (value): value is number => value !== null,
  );
  return {
    travelToMinutes: travelTo,
    travelMinutes: travelTo,
    workMinutes: work,
    travelFromMinutes: travelFrom,
    totalMinutes:
      parts.length > 0
        ? parts.reduce((sum, value) => sum + value, 0)
        : null,
    started: Boolean(visit.enRouteAt || visit.onSiteAt || visit.doneAt),
    completed: Boolean(visit.doneAt),
  };
}

/** Summerer en liste arbeidsøkter. Ukjente deler telles som 0. */
export function summarizeVisitTimes(visits: VisitTimeFields[]): TimeTotals {
  let travelTo = 0;
  let work = 0;
  let travelFrom = 0;
  let completedSessions = 0;
  let ongoingSessions = 0;

  for (const visit of visits) {
    const to = travelToMinutes(visit);
    const workValue = workMinutes(visit);
    const from = travelFromMinutes(visit);
    if (to !== null) travelTo += to;
    if (workValue !== null) work += workValue;
    if (from !== null) travelFrom += from;
    if (visit.doneAt) completedSessions += 1;
    else if (visit.enRouteAt || visit.onSiteAt) ongoingSessions += 1;
  }

  return {
    travelToMinutes: travelTo,
    workMinutes: work,
    travelFromMinutes: travelFrom,
    totalMinutes: travelTo + work + travelFrom,
    travelMinutes: travelTo + travelFrom,
    sessions: visits.length,
    completedSessions,
    ongoingSessions,
  };
}

/**
 * Per-dagssammendrag gruppert på visittens startdag i Europe/Oslo. En
 * flerdagers arbeidsordre gir dermed én rad per arbeidsdag.
 */
export function summarizeVisitDays(
  visits: Array<VisitTimeFields & { startsAt: Date }>,
): DailyTimeSummary[] {
  const groups = new Map<string, VisitTimeFields[]>();
  for (const visit of visits) {
    const date = dateOnlyInOslo(visit.startsAt);
    const group = groups.get(date) ?? [];
    group.push(visit);
    groups.set(date, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({ date, ...summarizeVisitTimes(group) }));
}

/** Samlet arbeids- og reisetid for et oppdrag, med per-dag-radene. */
export function summarizeWorkOrderTime(
  visits: Array<VisitTimeFields & { startsAt: Date }>,
): WorkOrderTimeSummary {
  return {
    ...summarizeVisitTimes(visits),
    days: summarizeVisitDays(visits),
  };
}
