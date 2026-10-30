import { VisitStatus } from "@prisma/client";

/**
 * Én kilde til sannhet for lovlige statusoverganger på en visitt.
 *
 * Flyten følger montørens faktiske arbeid: en planlagt visitt kan tildeles en
 * montør eller startes direkte, og den kan kanselleres helt fram til den er
 * fullført. Når visitten er DONE eller CANCELLED, er den avsluttet historikk og
 * kan ikke endres. Det finnes ingen gjenåpning i denne fasen.
 */
export const VISIT_STATUS_ORDER: readonly VisitStatus[] = [
  "PLANNED",
  "ASSIGNED",
  "EN_ROUTE",
  "ON_SITE",
  "DONE",
  "CANCELLED",
];

/** Statusene en visitt kan gå til fra hver tilstand. */
export const VISIT_STATUS_TRANSITIONS: Readonly<
  Record<VisitStatus, readonly VisitStatus[]>
> = {
  PLANNED: ["ASSIGNED", "EN_ROUTE", "CANCELLED"],
  ASSIGNED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["ON_SITE", "CANCELLED"],
  ON_SITE: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

export const TERMINAL_VISIT_STATUSES: readonly VisitStatus[] = [
  "DONE",
  "CANCELLED",
];

/** Er visitten avsluttet (fullført eller kansellert)? */
export function isTerminalVisitStatus(status: VisitStatus): boolean {
  return TERMINAL_VISIT_STATUSES.includes(status);
}

/** Kan visitten gå fra `from` til `to`? */
export function canTransitionVisit(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_STATUS_TRANSITIONS[from].includes(to);
}

/** Statusene brukeren kan velge fra en gitt tilstand (til UI-et). */
export function allowedVisitTransitions(from: VisitStatus): VisitStatus[] {
  return [...VISIT_STATUS_TRANSITIONS[from]];
}

/** Oversettelsesnøkkel for statusnavnet som vises i UI-et. */
export const VISIT_STATUS_LABEL_KEYS: Record<VisitStatus, string> = {
  PLANNED: "visits.status.planned",
  ASSIGNED: "visits.status.assigned",
  EN_ROUTE: "visits.status.enRoute",
  ON_SITE: "visits.status.onSite",
  DONE: "visits.status.done",
  CANCELLED: "visits.status.cancelled",
};

export function visitStatusLabelKey(status: VisitStatus): string {
  return VISIT_STATUS_LABEL_KEYS[status];
}
