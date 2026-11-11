// i18n-ignore-file: tjenestelaget returnerer data og har ingen egne
// brukergrensesnittstrenger. Dashbordet oversetter alt i komponentene.
import type { VisitStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { staffScope, workOrderScope, type AccessUser } from "@/lib/access";
import {
  addDaysUtc,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import {
  deriveFieldStatus,
  sortFieldStatusRows,
  type FieldStatusRow,
  type FieldVisitInput,
} from "@/lib/dashboard-field-status";
import { isClosedStatus } from "@/lib/work-order-status";
import { LOCATION_PING_RETENTION_MS } from "@/server/tracking";

export type DashboardFieldStatus = {
  dayStart: Date;
  dayEnd: Date;
  generatedAt: Date;
  rows: FieldStatusRow[];
};

const MAX_STAFF = 200;

/**
 * Dagens liveoversikt for kontordashbordet.
 *
 * Kildene er:
 * - ansatte brukeren får se (egen avdeling, eller alle for administrator),
 * - dagens visiter innenfor samme oppdragsscope,
 * - fravær som overlapper dagen,
 * - ferske posisjonspinger (24 timer) fra avdelinger med sporing på.
 *
 * Alle visiter i dag hentes, også heldagsvisiter og senere økter. En montør
 * med flere åpne visiter får den aktive visitten (ON_SITE/EN_ROUTE) eller den
 * som starter nærmest nå. Posisjoner eksponeres bare når avdelingen har slått
 * på sporing; ellers er `lastPositionAt` alltid null.
 */
export async function loadDashboardFieldStatus(
  user: AccessUser | null | undefined,
  options: { now?: Date } = {},
): Promise<DashboardFieldStatus> {
  const now = options.now ?? new Date();
  const today = todayInOslo(now);
  const dayStart = osloDayStart(today);
  const parsed = parseDateOnly(today);
  const dayEnd = osloDayStart(
    toDateOnly(addDaysUtc(parsed ?? new Date(now), 1)),
  );

  const empty: DashboardFieldStatus = {
    dayStart,
    dayEnd,
    generatedAt: now,
    rows: [],
  };

  // Dashbordet er kontorets flate. Kundeportalbrukere skal aldri få
  // montørstatus eller posisjoner gjennom denne tjenesten.
  if (!user?.isActive || user.role === "CUSTOMER") return empty;

  const staff = await prisma.user.findMany({
    where: { ...staffScope(user), isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
    take: MAX_STAFF,
  });
  if (staff.length === 0) return empty;

  const staffIds = staff.map((person) => person.id);
  const pingCutoff = new Date(now.getTime() - LOCATION_PING_RETENTION_MS);

  const [visits, absences] = await Promise.all([
    prisma.visit.findMany({
      where: {
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        technicians: { some: { userId: { in: staffIds } } },
        workOrder: { AND: [workOrderScope(user)] },
      },
      select: {
        id: true,
        workOrderId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        enRouteAt: true,
        onSiteAt: true,
        doneAt: true,
        technicians: { select: { userId: true } },
        locationPings: {
          where: { recordedAt: { gte: pingCutoff } },
          orderBy: { recordedAt: "desc" },
          take: 20,
          select: { userId: true, recordedAt: true },
        },
        workOrder: {
          select: {
            id: true,
            title: true,
            status: true,
            customer: { select: { name: true } },
            department: { select: { trackingEnabled: true } },
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { sequence: "asc" }],
      take: 1000,
    }),
    prisma.absence.findMany({
      where: {
        userId: { in: staffIds },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: { userId: true, startsAt: true, endsAt: true },
      take: 1000,
    }),
  ]);

  const visitsByUser = new Map<string, FieldVisitInput[]>();
  for (const visit of visits) {
    const workOrderClosed = isClosedStatus(visit.workOrder.status);
    // Eldre rader kan ha en aktiv visitt på et oppdrag som allerede er lukket.
    // Vi stoler derfor ikke på visittstatusen alene: en lukket arbeidsordre
    // vises som DONE (eller CANCELLED), aldri som «på vei» eller «på stedet».
    const status: VisitStatus =
      workOrderClosed && visit.status !== "DONE" && visit.status !== "CANCELLED"
        ? visit.workOrder.status === "CANCELLED"
          ? "CANCELLED"
          : "DONE"
        : (visit.status as VisitStatus);
    const trackingEnabled = visit.workOrder.department.trackingEnabled;
    for (const technician of visit.technicians) {
      // En gammel posisjon skal ikke fortsette å se levende ut etter at
      // oppdraget er lukket.
      const ping =
        trackingEnabled && !workOrderClosed
          ? visit.locationPings.find(
              (candidate) => candidate.userId === technician.userId,
            )
          : undefined;
      const rows = visitsByUser.get(technician.userId) ?? [];
      rows.push({
        id: visit.id,
        workOrderId: visit.workOrderId,
        title: visit.workOrder.title,
        customerName: visit.workOrder.customer?.name ?? null,
        status,
        startsAt: visit.startsAt,
        endsAt: visit.endsAt,
        allDay: visit.allDay,
        enRouteAt: visit.enRouteAt,
        onSiteAt: visit.onSiteAt,
        doneAt: visit.doneAt,
        lastPingAt: ping?.recordedAt ?? null,
      });
      visitsByUser.set(technician.userId, rows);
    }
  }

  const absencesByUser = new Map<
    string,
    Array<{ startsAt: Date; endsAt: Date }>
  >();
  for (const absence of absences) {
    const rows = absencesByUser.get(absence.userId) ?? [];
    rows.push({ startsAt: absence.startsAt, endsAt: absence.endsAt });
    absencesByUser.set(absence.userId, rows);
  }

  // Alle tekniske roller er feltpersonell. Kontor- og administratorkontoer
  // tas bare med når de faktisk har en visitt i dag, slik at ledige
  // kontorstoler ikke fyller statusflaten.
  const fieldStaff = staff.filter(
    (person) =>
      person.role === "TECHNICIAN" ||
      (visitsByUser.get(person.id)?.length ?? 0) > 0,
  );

  const rows: FieldStatusRow[] = fieldStaff.map((person) => {
    const derived = deriveFieldStatus({
      userId: person.id,
      name: person.name,
      visits: visitsByUser.get(person.id) ?? [],
      absences: absencesByUser.get(person.id) ?? [],
      dayStart,
      dayEnd,
      now,
    });
    return {
      userId: person.id,
      name: person.name,
      status: derived.status,
      visit: derived.visit,
      lastPositionAt: derived.lastPositionAt,
    };
  });

  return {
    dayStart,
    dayEnd,
    generatedAt: now,
    rows: sortFieldStatusRows(rows),
  };
}
