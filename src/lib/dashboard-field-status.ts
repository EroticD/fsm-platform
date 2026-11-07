import type { VisitStatus } from "@prisma/client";

/**
 * Dagens feltstatus for kontordashbordet.
 *
 * Reglene er rene og testbare: tjenestelaget henter dagens visiter, fravær og
 * posisjonspinger, mens denne filen avgjør hvilken status hver montør skal
 * vises med. Rekkefølgen er bevisst:
 *
 *   ON_SITE > EN_ROUTE > ASSIGNED > DONE > AVAILABLE
 *
 * Fravær (ABSENT) overstyrer tildelte og ferdige visiter, men aldri en aktiv
 * visitt: er montøren faktisk på stedet eller på vei, viser vi det.
 */
export type FieldStatusKey =
  | "ON_SITE"
  | "EN_ROUTE"
  | "ASSIGNED"
  | "DONE"
  | "AVAILABLE"
  | "ABSENT";

/** Rekkefølgen statuser vises i på dashbordet. */
export const FIELD_STATUS_DISPLAY_ORDER: readonly FieldStatusKey[] = [
  "ON_SITE",
  "EN_ROUTE",
  "ASSIGNED",
  "DONE",
  "ABSENT",
  "AVAILABLE",
];

/** Oversettelsesnøkkel per status. */
export const FIELD_STATUS_LABEL_KEYS: Record<FieldStatusKey, string> = {
  ON_SITE: "dashboard.field.status.onSite",
  EN_ROUTE: "dashboard.field.status.enRoute",
  ASSIGNED: "dashboard.field.status.assigned",
  DONE: "dashboard.field.status.done",
  AVAILABLE: "dashboard.field.status.available",
  ABSENT: "dashboard.field.status.absent",
};

export type FieldVisitInput = {
  id: string;
  workOrderId: string;
  title: string;
  customerName: string | null;
  status: VisitStatus;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  enRouteAt?: Date | null;
  onSiteAt?: Date | null;
  doneAt?: Date | null;
  /** Siste posisjonsping for denne montøren på denne visitten. */
  lastPingAt?: Date | null;
};

export type FieldAbsenceInput = {
  startsAt: Date;
  endsAt: Date;
};

export type DeriveFieldStatusInput = {
  userId: string;
  name: string | null;
  visits: FieldVisitInput[];
  absences: FieldAbsenceInput[];
  dayStart: Date;
  dayEnd: Date;
  now?: Date;
};

export type DerivedFieldStatus = {
  status: FieldStatusKey;
  visit: FieldVisitInput | null;
  lastPositionAt: Date | null;
};

export type FieldStatusRow = {
  userId: string;
  name: string | null;
  status: FieldStatusKey;
  visit: FieldVisitInput | null;
  lastPositionAt: Date | null;
};

function timeOrNull(value: Date | null | undefined): number | null {
  if (!value) return null;
  const time = value.getTime();
  return Number.isNaN(time) ? null : time;
}

function latestBy(
  visits: FieldVisitInput[],
  pick: (visit: FieldVisitInput) => Date | null | undefined,
): FieldVisitInput | null {
  let winner: FieldVisitInput | null = null;
  let winnerTime = -Infinity;

  for (const visit of visits) {
    const value = timeOrNull(pick(visit)) ?? -Infinity;
    if (value > winnerTime) {
      winner = visit;
      winnerTime = value;
    }
  }

  return winner;
}

/** Visitten som starter nærmest `now` – brukes når ingen er aktiv. */
function nearestStart(
  visits: FieldVisitInput[],
  now: Date,
): FieldVisitInput | null {
  let winner: FieldVisitInput | null = null;
  let winnerDistance = Number.POSITIVE_INFINITY;

  for (const visit of visits) {
    const distance = Math.abs(visit.startsAt.getTime() - now.getTime());
    if (distance < winnerDistance) {
      winner = visit;
      winnerDistance = distance;
    }
  }

  return winner;
}

/**
 * Fravær regnes som heldags bare når perioden dekker hele døgnet i Oslo.
 * Da kan vi trygt si at montøren er borte hele dagen, ikke bare en time.
 */
export function isAbsentAllDay(
  absences: FieldAbsenceInput[],
  dayStart: Date,
  dayEnd: Date,
): boolean {
  return absences.some(
    (absence) =>
      absence.startsAt.getTime() <= dayStart.getTime() &&
      absence.endsAt.getTime() >= dayEnd.getTime(),
  );
}

/**
 * Siste delte posisjon blant dagens visiter. Pinger utenfor
 * oppbevaringsvinduet er allerede filtrert bort av tjenestelaget.
 */
export function lastPositionAt(
  visits: FieldVisitInput[],
): Date | null {
  return latestBy(visits, (visit) => visit.lastPingAt)?.lastPingAt ?? null;
}

/** Utleder én montørs status for dagen. */
export function deriveFieldStatus(
  input: DeriveFieldStatusInput,
): DerivedFieldStatus {
  const now = input.now ?? new Date();
  const visits = input.visits.filter((visit) => visit.status !== "CANCELLED");
  const lastPosition = lastPositionAt(visits);

  const onSite = latestBy(
    visits.filter((visit) => visit.status === "ON_SITE"),
    (visit) => visit.onSiteAt ?? visit.startsAt,
  );
  if (onSite) {
    return { status: "ON_SITE", visit: onSite, lastPositionAt: lastPosition };
  }

  const enRoute = latestBy(
    visits.filter((visit) => visit.status === "EN_ROUTE"),
    (visit) => visit.enRouteAt ?? visit.startsAt,
  );
  if (enRoute) {
    return { status: "EN_ROUTE", visit: enRoute, lastPositionAt: lastPosition };
  }

  if (isAbsentAllDay(input.absences, input.dayStart, input.dayEnd)) {
    return { status: "ABSENT", visit: null, lastPositionAt: lastPosition };
  }

  const assigned = nearestStart(
    visits.filter(
      (visit) =>
        visit.status === "ASSIGNED" || visit.status === "PLANNED",
    ),
    now,
  );
  if (assigned) {
    return {
      status: "ASSIGNED",
      visit: assigned,
      lastPositionAt: lastPosition,
    };
  }

  const done = latestBy(
    visits.filter((visit) => visit.status === "DONE"),
    (visit) => visit.doneAt ?? visit.endsAt,
  );
  if (done) {
    return { status: "DONE", visit: done, lastPositionAt: lastPosition };
  }

  return { status: "AVAILABLE", visit: null, lastPositionAt: lastPosition };
}

/** Sorterer rader etter status før navn, klar for visning. */
export function sortFieldStatusRows(rows: FieldStatusRow[]): FieldStatusRow[] {
  const order = new Map(
    FIELD_STATUS_DISPLAY_ORDER.map((status, index) => [status, index]),
  );
  return [...rows].sort(
    (a, b) =>
      (order.get(a.status) ?? FIELD_STATUS_DISPLAY_ORDER.length) -
        (order.get(b.status) ?? FIELD_STATUS_DISPLAY_ORDER.length) ||
      (a.name ?? "").localeCompare(b.name ?? "", "nb"),
  );
}
