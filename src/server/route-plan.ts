// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger,
// som de øvrige tjenestene. De oversettes ved visning i `src/lib/audit-actions.ts`.
import type { Prisma, VisitStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  addDaysUtc,
  dateOnlyInOslo,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import {
  DEFAULT_BUSINESS_HOURS,
  osloWallTimeToUtc,
} from "@/lib/business-hours";
import { isValidCoordinates, type Coordinates } from "@/lib/geo";
import { effectiveAddress } from "@/lib/geocode";
import { createHaversineProvider, getRoutingProvider } from "@/lib/routing";
import {
  optimiseRoute,
  type RouteWindow,
} from "@/lib/routing/route-optimizer";
import type {
  RoutingProvider,
  TravelEstimate,
} from "@/lib/routing/types";
import { slaRemainingMinutes, slaStateAt } from "@/lib/sla";
import { isClosedStatus } from "@/lib/work-order-status";
import { recomputeWorkOrderSchedule } from "./visits";
import {
  can,
  fail,
  ok,
  staffScopeFor,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Visittstatuser som ruteplanleggeren kan flytte. */
const PLANNABLE_STATUSES: VisitStatus[] = ["PLANNED", "ASSIGNED"];

/** Øvre grense per montør, slik at en matrise aldri blir urimelig stor. */
export const MAX_ROUTE_STOPS = 50;

/**
 * Hvor mye en visitt kan flyttes senere enn dagens kalenderblokk før den
 * regnes som utenfor tidsvinduet. Toleransen gjør at reiseavstand faktisk kan
 * endre rekkefølgen, samtidig som en visitt aldri flyttes vilkårlig langt.
 */
export const ROUTE_WINDOW_TOLERANCE_MINUTES = 120;

/** Maks antall visiter som lastes før de fordeles per montør. */
const MAX_ROUTE_VISITS = 500;

export const ROUTE_ERROR_CODES = {
  invalid: "route.errors.invalid",
  forbidden: "route.errors.forbidden",
  notFound: "route.errors.notFound",
  conflict: "route.errors.conflict",
  absence: "route.errors.absence",
  overlap: "route.errors.overlap",
  orderMismatch: "route.errors.orderMismatch",
  applyFailed: "route.errors.applyFailed",
} as const;

export type RouteSkippedReason =
  | "missing_coordinates"
  | "outside_time_window"
  | "limit"
  | "missing_skills"
  | "working_hours"
  | "absence"
  | "ineligible";

export type RoutePlanStop = {
  visitId: string;
  workOrderId: string;
  workOrderTitle: string;
  customerName: string | null;
  address: string;
  status: VisitStatus;
  sequence: number;
  /** Planlagt start før optimalisering. */
  plannedStartsAt: Date;
  plannedEndsAt: Date;
  /** Beregnet ankomst til stedet. */
  arrivalAt: Date;
  /** Foreslått ny start (respekterer tidsvinduet). */
  startsAt: Date;
  endsAt: Date;
  waitMinutes: number;
  travelMinutes: number;
  distanceKm: number;
  point: Coordinates;
};

export type RouteSkippedVisit = {
  visitId: string;
  workOrderId: string;
  workOrderTitle: string;
  reason: RouteSkippedReason;
};

export type TechnicianRoutePlan = {
  technicianId: string;
  technicianName: string;
  technicianEmail: string | null;
  stops: RoutePlanStop[];
  skipped: RouteSkippedVisit[];
  totalDistanceKm: number;
  totalTravelMinutes: number;
  totalWaitingMinutes: number;
  /** Kjøretid/avstand for den opprinnelige rekkefølgen. */
  baselineTravelMinutes: number;
  baselineDistanceKm: number;
  savedTravelMinutes: number;
  savedDistanceKm: number;
  /** False når planen allerede var i den beste rekkefølgen. */
  orderChanged: boolean;
  startAt: Date;
  finishAt: Date | null;
  provider: TravelEstimate["provider"];
  /** Satt når den eksterne leverandøren feilet og reserveberegningen ble brukt. */
  fallbackUsed: boolean;
};

export type RoutePlanOverview = {
  date: string;
  plans: TechnicianRoutePlan[];
};

export type RoutePlanOptions = {
  routing?: RoutingProvider;
  now?: Date;
};

type RouteVisitRow = Prisma.VisitGetPayload<{
  select: typeof routeVisitSelect;
}>;

const routeVisitSelect = {
  id: true,
  workOrderId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  sequence: true,
  technicians: { select: { userId: true } },
  workOrder: {
    select: {
      id: true,
      title: true,
      address: true,
      postalCode: true,
      city: true,
      latitude: true,
      longitude: true,
      legalHold: true,
      status: true,
      skillRequirements: { select: { skillId: true, mandatory: true } },
      slaClocks: {
        where: { state: { not: "CANCELLED" } },
        orderBy: { startedAt: "desc" },
        select: {
          startedAt: true,
          respondBy: true,
          resolveBy: true,
          respondedAt: true,
          resolvedAt: true,
          breachedAt: true,
          state: true,
        },
        take: 1,
      },
      site: {
        select: {
          latitude: true,
          longitude: true,
          address: true,
          postalCode: true,
          city: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          address: true,
          postalCode: true,
          city: true,
          sites: {
            where: { isPrimary: true },
            take: 1,
            select: { latitude: true, longitude: true },
          },
        },
      },
    },
  },
} satisfies Prisma.VisitSelect;

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function pointFor(visit: RouteVisitRow): Coordinates | null {
  const workOrder = visit.workOrder;
  if (
    workOrder.latitude !== null &&
    workOrder.longitude !== null &&
    isValidCoordinates(workOrder.latitude, workOrder.longitude)
  ) {
    return {
      latitude: workOrder.latitude,
      longitude: workOrder.longitude,
    };
  }
  const site = workOrder.site;
  if (
    site &&
    site.latitude !== null &&
    site.longitude !== null &&
    isValidCoordinates(site.latitude, site.longitude)
  ) {
    return { latitude: site.latitude, longitude: site.longitude };
  }
  const primarySite = workOrder.customer?.sites?.[0];
  if (
    primarySite &&
    primarySite.latitude !== null &&
    primarySite.longitude !== null &&
    isValidCoordinates(primarySite.latitude, primarySite.longitude)
  ) {
    return {
      latitude: primarySite.latitude,
      longitude: primarySite.longitude,
    };
  }
  return null;
}

function addressFor(visit: RouteVisitRow): string {
  const workOrder = visit.workOrder;
  const site = workOrder.site;
  const effective = effectiveAddress({
    address: workOrder.address ?? site?.address ?? null,
    postalCode: workOrder.postalCode ?? site?.postalCode ?? null,
    city: workOrder.city ?? site?.city ?? null,
    customer: workOrder.customer
      ? {
          address: workOrder.customer.address,
          postalCode: workOrder.customer.postalCode,
          city: workOrder.customer.city,
        }
      : null,
  });
  return [
    effective.address,
    [effective.postalCode, effective.city].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
}

function serviceMinutes(visit: RouteVisitRow): number {
  return Math.max(
    0,
    Math.round((visit.endsAt.getTime() - visit.startsAt.getTime()) / 60_000),
  );
}

/**
 * Prioritet utledes fra SLA i stedet for et eget felt på oppdraget:
 * brudd = 3, under én time igjen = 2, under fire timer = 1, ellers 0.
 * Da får en hard SLA tidligere plass uten at skjemaet må endres.
 */
function priorityFor(visit: RouteVisitRow, now: Date): number {
  const clock = visit.workOrder.slaClocks?.[0];
  if (!clock) return 0;
  if (slaStateAt(clock, now) === "BREACHED") return 3;
  const remaining = slaRemainingMinutes(clock, now);
  if (remaining <= 60) return 2;
  if (remaining <= 240) return 1;
  return 0;
}

function requiredSkillIds(visit: RouteVisitRow): string[] {
  return (visit.workOrder.skillRequirements ?? [])
    .filter((requirement) => requirement.mandatory)
    .map((requirement) => requirement.skillId);
}

function visitWindow(
  visit: RouteVisitRow,
  point: Coordinates,
  now: Date,
): RouteWindow {
  return {
    id: visit.id,
    point,
    startsAt: visit.startsAt,
    // Tidsvinduet er dagens blokk pluss en dokumentert toleranse. Da kan
    // rekkefølgen flyttes av reisetid, men aldri utenfor en rimelig ramme.
    endsAt: new Date(
      visit.endsAt.getTime() + ROUTE_WINDOW_TOLERANCE_MINUTES * 60_000,
    ),
    serviceMinutes: serviceMinutes(visit),
    priority: priorityFor(visit, now),
    requiredSkillIds: requiredSkillIds(visit),
  };
}

function skippedVisit(
  visit: RouteVisitRow,
  reason: RouteSkippedReason,
): RouteSkippedVisit {
  return {
    visitId: visit.id,
    workOrderId: visit.workOrderId,
    workOrderTitle: visit.workOrder.title,
    reason,
  };
}

/**
 * Beregner én montørs rute. Ren nok til å testes med en injisert leverandør:
 * ingen database- eller nettverkskall her.
 */
export async function planTechnicianRoute(input: {
  technician: { id: string; name: string | null; email: string | null };
  visits: RouteVisitRow[];
  routing: RoutingProvider;
  startAt: Date;
  now?: Date;
  /** Arbeidstid for dagen. Utelatt betyr ingen tidsgrense. */
  workingHours?: { start: Date; end: Date } | null;
  /** Montørens gyldige kompetanse. Utelatt betyr «ikke kontroller». */
  technicianSkillIds?: readonly string[];
  absences?: Array<{ startsAt: Date; endsAt: Date }>;
}): Promise<TechnicianRoutePlan> {
  const now = input.now ?? new Date();
  const skipped: RouteSkippedVisit[] = [];
  const skippedIds = new Set<string>();
  const addSkipped = (visit: RouteVisitRow, reason: RouteSkippedReason) => {
    if (skippedIds.has(visit.id)) return;
    skippedIds.add(visit.id);
    skipped.push(skippedVisit(visit, reason));
  };

  const absent = new Set<string>();
  for (const visit of input.visits) {
    const absence = input.absences?.find(
      (row) =>
        row.startsAt.getTime() < visit.endsAt.getTime() &&
        row.endsAt.getTime() > visit.startsAt.getTime(),
    );
    if (absence) {
      absent.add(visit.id);
      addSkipped(visit, "absence");
    }
  }

  const candidates = input.visits.filter((visit) => !absent.has(visit.id));
  const located = candidates
    .filter((visit) => pointFor(visit) !== null)
    .sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  const missing = candidates
    .filter((visit) => pointFor(visit) === null)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const limited = located.slice(MAX_ROUTE_STOPS);
  const planned = located.slice(0, MAX_ROUTE_STOPS);

  for (const visit of missing) addSkipped(visit, "missing_coordinates");
  for (const visit of limited) addSkipped(visit, "limit");

  if (planned.length === 0) {
    return {
      technicianId: input.technician.id,
      technicianName:
        input.technician.name ?? input.technician.email ?? input.technician.id,
      technicianEmail: input.technician.email,
      stops: [],
      skipped,
      totalDistanceKm: 0,
      totalTravelMinutes: 0,
      totalWaitingMinutes: 0,
      baselineTravelMinutes: 0,
      baselineDistanceKm: 0,
      savedTravelMinutes: 0,
      savedDistanceKm: 0,
      orderChanged: false,
      startAt: input.startAt,
      finishAt: null,
      provider: "haversine",
      fallbackUsed: false,
    };
  }

  // Ruten starter ved den tidligste lokaliserte visitten. Det gir en
  // deterministisk start uten å kreve en depotadresse i databasen.
  const anchor = planned[0];
  const anchorPoint = pointFor(anchor)!;
  const points = [anchorPoint, ...planned.map((visit) => pointFor(visit)!)];
  const indexById = new Map(
    planned.map((visit, index) => [visit.id, index + 1]),
  );

  let fallbackUsed = false;
  let matrix: TravelEstimate[][];
  let provider: TravelEstimate["provider"] =
    input.routing.name === "haversine" ? "haversine" : input.routing.name;

  try {
    matrix = await input.routing.matrix(points, points);
    const sample = matrix[0]?.find((leg) => Boolean(leg));
    if (sample) {
      provider = sample.provider;
      if (input.routing.name !== "haversine" && sample.provider === "haversine") {
        fallbackUsed = true;
      }
    }
  } catch {
    // En ekstern leverandør som kaster skal aldri stoppe planleggingen.
    const fallback = createHaversineProvider();
    matrix = await fallback.matrix(points, points);
    provider = "haversine";
    fallbackUsed = true;
  }

  const result = optimiseRoute({
    visits: planned.map((visit) =>
      visitWindow(visit, pointFor(visit)!, now),
    ),
    matrix,
    start: anchorPoint,
    startAt: input.startAt,
    startIndex: 0,
    indexById,
    workingHours: input.workingHours ?? null,
    technicianSkillIds: input.technicianSkillIds,
  });

  const byId = new Map(planned.map((visit) => [visit.id, visit]));
  const stops: RoutePlanStop[] = [];
  for (const stop of result.stops) {
    const visit = byId.get(stop.visit.id);
    if (!visit) continue;
    const point = pointFor(visit);
    if (!point) continue;
    stops.push({
      visitId: visit.id,
      workOrderId: visit.workOrderId,
      workOrderTitle: visit.workOrder.title,
      customerName: visit.workOrder.customer?.name ?? null,
      address: addressFor(visit),
      status: visit.status,
      sequence: stops.length + 1,
      plannedStartsAt: visit.startsAt,
      plannedEndsAt: visit.endsAt,
      arrivalAt: stop.arrivalAt,
      startsAt: stop.startsAt,
      endsAt: stop.endsAt,
      waitMinutes: stop.waitMinutes,
      travelMinutes: stop.travelMinutes,
      distanceKm: stop.distanceKm,
      point,
    });
  }

  for (const row of result.unassigned) {
    const visit = byId.get(row.id);
    if (visit) addSkipped(visit, row.reason as RouteSkippedReason);
  }
  const orderedIds = new Set(stops.map((stop) => stop.visitId));
  for (const visit of planned) {
    if (!orderedIds.has(visit.id)) {
      addSkipped(visit, "outside_time_window");
    }
  }

  const finishAt = stops.at(-1)?.endsAt ?? null;
  return {
    technicianId: input.technician.id,
    technicianName:
      input.technician.name ?? input.technician.email ?? input.technician.id,
    technicianEmail: input.technician.email,
    stops,
    skipped,
    totalDistanceKm: result.totalDistanceKm,
    totalTravelMinutes: result.totalTravelMinutes,
    totalWaitingMinutes: result.totalWaitingMinutes,
    baselineTravelMinutes: result.baselineTravelMinutes,
    baselineDistanceKm: result.baselineDistanceKm,
    savedTravelMinutes: result.savedTravelMinutes,
    savedDistanceKm: result.savedDistanceKm,
    orderChanged: result.changed,
    startAt: input.startAt,
    finishAt,
    provider,
    fallbackUsed,
  };
}

function dayBounds(date: string): { dayStart: Date; dayEnd: Date } | null {
  const parsed = parseDateOnly(date);
  if (!parsed || toDateOnly(parsed) !== date) return null;
  return {
    dayStart: osloDayStart(date),
    dayEnd: osloDayStart(toDateOnly(addDaysUtc(parsed, 1))),
  };
}

function departmentFor(
  actor: ServiceActor,
  departmentId?: string | null,
): string | null {
  if (actor.role === "ADMIN") {
    return cleanId(departmentId) || actor.departmentId;
  }
  return actor.departmentId;
}

type RouteLoadResult =
  | {
      ok: true;
      data: {
        date: string;
        dayStart: Date;
        dayEnd: Date;
        visits: RouteVisitRow[];
        technicians: Array<{
          id: string;
          name: string | null;
          email: string | null;
          departmentId: string | null;
          skills: Array<{ skillId: string; validUntil: Date | null }>;
          availability: Array<{
            weekday: number;
            startMinute: number;
            endMinute: number;
          }>;
          absences: Array<{ startsAt: Date; endsAt: Date }>;
        }>;
        businessHours: Array<{
          departmentId: string;
          weekday: number;
          openMinute: number;
          closeMinute: number;
        }>;
      };
    }
  | { ok: false; reason: "invalid" | "not_found" };

/**
 * Laster visiter og montører for én dag, innenfor aktørens avdelingsscope.
 * Bare åpne visiter (PLANNED/ASSIGNED) kan flyttes; pågående og avsluttede
 * visiter er faste og dukker derfor ikke opp i ruten.
 */
async function loadRouteInput(
  actor: ServiceActor,
  input: {
    date: string;
    technicianId?: string | null;
    departmentId?: string | null;
    visitIds?: string[];
  },
): Promise<RouteLoadResult> {
  const bounds = dayBounds(input.date);
  if (!bounds) return { ok: false, reason: "invalid" };

  const departmentId = departmentFor(actor, input.departmentId);
  const technicianId = cleanId(input.technicianId);
  const selectedVisitIds = (input.visitIds ?? [])
    .map(cleanId)
    .filter(Boolean)
    .slice(0, MAX_ROUTE_STOPS);

  const technicianWhere: Prisma.UserWhereInput = {
    AND: [
      staffScopeFor(actor),
      departmentId ? { departmentId } : {},
      technicianId ? { id: technicianId } : {},
    ],
  };

  const [technicians, visits, businessHours] = await Promise.all([
    prisma.user.findMany({
      where: technicianWhere,
      select: {
        id: true,
        name: true,
        email: true,
        departmentId: true,
        skills: {
          select: { skillId: true, validUntil: true },
          take: 200,
        },
        availability: {
          select: { weekday: true, startMinute: true, endMinute: true },
          take: 50,
        },
        absences: {
          where: {
            startsAt: { lt: bounds.dayEnd },
            endsAt: { gt: bounds.dayStart },
          },
          select: { startsAt: true, endsAt: true },
          take: 50,
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 200,
    }),
    prisma.visit.findMany({
      where: {
        startsAt: { lt: bounds.dayEnd },
        endsAt: { gt: bounds.dayStart },
        status: { in: PLANNABLE_STATUSES },
        ...(selectedVisitIds.length > 0
          ? { id: { in: selectedVisitIds } }
          : {}),
        workOrder: {
          AND: [
            workOrderScopeFor(actor),
            { legalHold: false },
            departmentId ? { departmentId } : {},
          ],
        },
        ...(technicianId
          ? { technicians: { some: { userId: technicianId } } }
          : {}),
      },
      select: routeVisitSelect,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: MAX_ROUTE_VISITS,
    }),
    prisma.businessHours.findMany({
      where: departmentId ? { departmentId } : {},
      select: {
        departmentId: true,
        weekday: true,
        openMinute: true,
        closeMinute: true,
      },
      take: 500,
    }),
  ]);

  if (technicianId && technicians.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  return {
    ok: true,
    data: {
      date: input.date,
      dayStart: bounds.dayStart,
      dayEnd: bounds.dayEnd,
      visits: visits.filter(
        (visit) =>
          !isClosedStatus(visit.workOrder.status) &&
          !visit.workOrder.legalHold,
      ),
      technicians,
      businessHours,
    },
  };
}

type RouteTechnician = Extract<RouteLoadResult, { ok: true }>["data"]["technicians"][number];

function weekdayForDate(date: string): number | null {
  const parsed = parseDateOnly(date);
  if (!parsed || toDateOnly(parsed) !== date) return null;
  return (parsed.getUTCDay() + 6) % 7;
}

/**
 * Arbeidstid for én montør på én dato. Individuell arbeidstid vinner over
 * avdelingens åpningstider; mangler begge, brukes standarden 08–16 på
 * hverdager. En dag uten arbeidstid gir ingen ekstra tidsgrense.
 */
function workingHoursFor(
  date: string,
  technician: RouteTechnician,
  businessHours: Array<{
    departmentId: string;
    weekday: number;
    openMinute: number;
    closeMinute: number;
  }>,
): { start: Date; end: Date } | null {
  const weekday = weekdayForDate(date);
  if (weekday === null) return null;

  const availability = (technician.availability ?? []).filter(
    (row) => row.weekday === weekday && row.endMinute > row.startMinute,
  );
  let openMinute: number | null = null;
  let closeMinute: number | null = null;

  if (availability.length > 0) {
    openMinute = Math.min(...availability.map((row) => row.startMinute));
    closeMinute = Math.max(...availability.map((row) => row.endMinute));
  } else {
    const departmentRows = (businessHours ?? []).filter(
      (row) =>
        row.departmentId === technician.departmentId &&
        row.weekday === weekday &&
        row.closeMinute > row.openMinute,
    );
    if (departmentRows.length > 0) {
      openMinute = Math.min(...departmentRows.map((row) => row.openMinute));
      closeMinute = Math.max(...departmentRows.map((row) => row.closeMinute));
    } else {
      const defaults = DEFAULT_BUSINESS_HOURS.filter(
        (row) => row.weekday === weekday,
      );
      if (defaults.length > 0) {
        openMinute = Math.min(...defaults.map((row) => row.openMinute));
        closeMinute = Math.max(...defaults.map((row) => row.closeMinute));
      }
    }
  }

  if (openMinute === null || closeMinute === null || closeMinute <= openMinute) {
    return null;
  }

  return {
    start: osloWallTimeToUtc(date, openMinute),
    end: osloWallTimeToUtc(date, closeMinute),
  };
}

function extendWorkingEnd(
  window: { start: Date; end: Date } | null,
  visits: RouteVisitRow[],
  dayEnd: Date,
): { start: Date; end: Date } | null {
  if (!window || visits.length === 0) return window;
  const latest = Math.max(...visits.map((visit) => visit.endsAt.getTime()));
  if (latest <= window.end.getTime()) return window;
  return {
    start: window.start,
    end: new Date(Math.min(latest, dayEnd.getTime())),
  };
}

/**
 * Dagens (eller valgt dags) rute per montør. Siden kan åpnes av kontoret;
 * visninger krever `workorders.view`, mens «Bruk rekkefølge» krever
 * `workorders.assign`.
 */
export async function getRoutePlan(
  actor: ServiceActor,
  input: {
    date: string;
    technicianId?: string | null;
    departmentId?: string | null;
    /** Valgfritt utvalg. Tomt/utelatt betyr alle visiter for dagen. */
    visitIds?: string[];
  },
  options: RoutePlanOptions = {},
): Promise<ServiceResult<RoutePlanOverview>> {
  if (
    !actor?.isActive ||
    (!can(actor, "workorders.view") &&
      !can(actor, "workorders.update") &&
      !can(actor, "workorders.assign") &&
      !can(actor, "dispatch.configure"))
  ) {
    return fail("forbidden", { code: ROUTE_ERROR_CODES.forbidden });
  }

  const loaded = await loadRouteInput(actor, input);
  if (!loaded.ok) {
    return fail(loaded.reason, {
      code:
        loaded.reason === "invalid"
          ? ROUTE_ERROR_CODES.invalid
          : ROUTE_ERROR_CODES.notFound,
    });
  }

  const routing = options.routing ?? getRoutingProvider();
  const now = options.now ?? new Date();
  const isToday = input.date === dateOnlyInOslo(now);

  const plans: TechnicianRoutePlan[] = [];
  // Arbeidstid per avdeling slås opp én gang for hele dagen.
  const businessHours = loaded.data.businessHours;
  for (const technician of loaded.data.technicians) {
    const visits = loaded.data.visits.filter((visit) =>
      visit.technicians.some((row) => row.userId === technician.id),
    );
    if (visits.length === 0) continue;

    const earliest = visits.reduce(
      (min, visit) => Math.min(min, visit.startsAt.getTime()),
      Number.POSITIVE_INFINITY,
    );
    // For dagens rute starter vi fra nå, slik at ETA-ene er realistiske. En
    // planlagt fremtidig dag starter på visittens tidligste starttidspunkt.
    const startAt = new Date(
      Math.max(earliest, isToday ? now.getTime() : 0),
    );
    const workingHours = extendWorkingEnd(
      workingHoursFor(input.date, technician, businessHours),
      visits,
      loaded.data.dayEnd,
    );
    const technicianSkillIds = (technician.skills ?? [])
      .filter(
        (skill) =>
          !skill.validUntil ||
          skill.validUntil.getTime() >= loaded.data.dayStart.getTime(),
      )
      .map((skill) => skill.skillId);

    plans.push(
      await planTechnicianRoute({
        technician,
        visits,
        routing,
        startAt,
        now,
        workingHours,
        technicianSkillIds,
        absences: technician.absences ?? [],
      }),
    );
  }

  return ok({ date: input.date, plans });
}

export type ApplyRouteOrderInput = {
  date: string;
  technicianId: string;
  /** Rekkefølgen brukeren godkjente, som visitt-id-er. */
  visitIds: string[];
};

export type ApplyRouteOrderResult = {
  applied: number;
  skipped: RouteSkippedVisit[];
  moves: Array<{
    visitId: string;
    startsAt: Date;
    endsAt: Date;
  }>;
};

type MoveCandidate = {
  visit: RouteVisitRow;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Flytter visittene til rekkefølgen og tidspunktene ruteplanen foreslo.
 *
 * Alt skjer i én transaksjon. Vi avviser hele endringen dersom en visitt
 * mangler, er avsluttet, har havnet utenfor dagens plan, overlapper en fast
 * visitt eller kolliderer med en registrert ferie/sykdom. Ingenting flyttes
 * «sånn omtrent» uten at kontoret får en tydelig konflikt.
 */
export async function applyRouteOrder(
  actor: ServiceActor,
  input: ApplyRouteOrderInput,
  options: RoutePlanOptions = {},
): Promise<ServiceResult<ApplyRouteOrderResult>> {
  if (!actor?.isActive || !can(actor, "workorders.assign")) {
    return fail("forbidden", { code: ROUTE_ERROR_CODES.forbidden });
  }

  const technicianId = cleanId(input.technicianId);
  if (!technicianId || !Array.isArray(input.visitIds)) {
    return fail("invalid", { code: ROUTE_ERROR_CODES.invalid });
  }
  const requestedIds = Array.from(
    new Set(input.visitIds.map(cleanId).filter(Boolean)),
  );
  if (requestedIds.length === 0) {
    return fail("invalid", { code: ROUTE_ERROR_CODES.invalid });
  }

  const plan = await getRoutePlan(
    actor,
    {
      date: input.date,
      technicianId,
      visitIds: requestedIds,
    },
    options,
  );
  if (!plan.ok) return plan;

  const technicianPlan = plan.data.plans.find(
    (row) => row.technicianId === technicianId,
  );
  if (!technicianPlan) {
    return fail("not_found", { code: ROUTE_ERROR_CODES.notFound });
  }

  const plannedIds = technicianPlan.stops.map((stop) => stop.visitId);
  if (
    plannedIds.length !== requestedIds.length ||
    plannedIds.some((id, index) => id !== requestedIds[index])
  ) {
    return fail("conflict", { code: ROUTE_ERROR_CODES.orderMismatch });
  }

  const plannedTimes = new Map(
    technicianPlan.stops.map((stop) => [
      stop.visitId,
      { startsAt: stop.startsAt, endsAt: stop.endsAt },
    ]),
  );

  return prisma.$transaction(async (tx) => {
    const rows = await tx.visit.findMany({
      where: {
        id: { in: requestedIds },
        startsAt: { lt: addDaysUtc(osloDayStart(input.date), 1) },
        endsAt: { gt: osloDayStart(input.date) },
        status: { in: PLANNABLE_STATUSES },
        technicians: { some: { userId: technicianId } },
        workOrder: { AND: [workOrderScopeFor(actor), { legalHold: false }] },
      },
      select: routeVisitSelect,
      take: MAX_ROUTE_STOPS,
    });

    if (rows.length !== requestedIds.length) {
      return fail("conflict", { code: ROUTE_ERROR_CODES.conflict });
    }
    if (
      rows.some(
        (visit) =>
          isClosedStatus(visit.workOrder.status) || visit.workOrder.legalHold,
      )
    ) {
      return fail("conflict", { code: ROUTE_ERROR_CODES.conflict });
    }

    const byId = new Map(rows.map((visit) => [visit.id, visit]));
    const moves: MoveCandidate[] = [];
    const dayStart = osloDayStart(input.date);
    const dayEnd = addDaysUtc(dayStart, 1);
    for (const visitId of requestedIds) {
      const visit = byId.get(visitId);
      const target = plannedTimes.get(visitId);
      if (!visit || !target) {
        return fail("conflict", { code: ROUTE_ERROR_CODES.orderMismatch });
      }
      if (
        target.startsAt.getTime() < dayStart.getTime() ||
        target.endsAt.getTime() > dayEnd.getTime()
      ) {
        return fail("conflict", { code: ROUTE_ERROR_CODES.conflict });
      }
      moves.push({ visit, startsAt: target.startsAt, endsAt: target.endsAt });
    }

    // Alle montører som berøres av flyttingen må være ledige i det nye
    // tidsrommet, ikke bare den valgte montøren.
    const technicianIds = Array.from(
      new Set(
        moves.flatMap((move) =>
          move.visit.technicians.map((row) => row.userId),
        ),
      ),
    );
    const minStart = new Date(
      Math.min(...moves.map((move) => move.startsAt.getTime())),
    );
    const maxEnd = new Date(
      Math.max(...moves.map((move) => move.endsAt.getTime())),
    );

    const absences = await tx.absence.findMany({
      where: {
        userId: { in: technicianIds },
        startsAt: { lt: maxEnd },
        endsAt: { gt: minStart },
      },
      select: { userId: true, startsAt: true, endsAt: true },
    });
    for (const move of moves) {
      for (const technician of move.visit.technicians) {
        const absence = absences.find(
          (row) =>
            row.userId === technician.userId &&
            row.startsAt.getTime() < move.endsAt.getTime() &&
            row.endsAt.getTime() > move.startsAt.getTime(),
        );
        if (absence) {
          return fail("conflict", {
            code: ROUTE_ERROR_CODES.absence,
            visitId: move.visit.id,
            technicianId: technician.userId,
          });
        }
      }
    }

    // Faste visiter (pågående, avsluttede eller andre oppdrag) skal aldri
    // overkjøres av ruten.
    const fixed = await tx.visit.findMany({
      where: {
        id: { notIn: requestedIds },
        status: { not: "CANCELLED" },
        startsAt: { lt: maxEnd },
        endsAt: { gt: minStart },
        technicians: { some: { userId: { in: technicianIds } } },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        technicians: { select: { userId: true } },
      },
    });
    for (const move of moves) {
      const technicianSet = new Set(
        move.visit.technicians.map((row) => row.userId),
      );
      const conflict = fixed.find(
        (other) =>
          other.startsAt.getTime() < move.endsAt.getTime() &&
          other.endsAt.getTime() > move.startsAt.getTime() &&
          other.technicians.some((row) => technicianSet.has(row.userId)),
      );
      if (conflict) {
        return fail("conflict", {
          code: ROUTE_ERROR_CODES.overlap,
          visitId: move.visit.id,
          conflictVisitId: conflict.id,
        });
      }
    }

    let applied = 0;
    const resultMoves: ApplyRouteOrderResult["moves"] = [];
    const workOrderIds = new Set<string>();
    for (const move of moves) {
      const unchanged =
        move.visit.startsAt.getTime() === move.startsAt.getTime() &&
        move.visit.endsAt.getTime() === move.endsAt.getTime();
      if (unchanged) {
        resultMoves.push({
          visitId: move.visit.id,
          startsAt: move.visit.startsAt,
          endsAt: move.visit.endsAt,
        });
        continue;
      }

      await tx.visit.update({
        where: { id: move.visit.id },
        data: { startsAt: move.startsAt, endsAt: move.endsAt },
      });
      await audit(tx, {
        entityType: "Visit",
        entityId: move.visit.id,
        action: `Flyttet visitt etter ruteplan: ${move.visit.workOrder.title}`,
        actor: toAuditActor(actor),
        metadata: {
          workOrderId: move.visit.workOrderId,
          technicianId,
          date: input.date,
          from: {
            startsAt: move.visit.startsAt.toISOString(),
            endsAt: move.visit.endsAt.toISOString(),
          },
          to: {
            startsAt: move.startsAt.toISOString(),
            endsAt: move.endsAt.toISOString(),
          },
          provider: technicianPlan.provider,
          savedTravelMinutes: technicianPlan.savedTravelMinutes,
          savedDistanceKm: technicianPlan.savedDistanceKm,
          orderChanged: technicianPlan.orderChanged,
        },
      });
      applied += 1;
      workOrderIds.add(move.visit.workOrderId);
      resultMoves.push({
        visitId: move.visit.id,
        startsAt: move.startsAt,
        endsAt: move.endsAt,
      });
    }

    for (const workOrderId of workOrderIds) {
      await recomputeWorkOrderSchedule(tx, workOrderId);
    }

    return ok({
      applied,
      skipped: technicianPlan.skipped,
      moves: resultMoves,
    });
  });
}
