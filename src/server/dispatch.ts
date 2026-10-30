// i18n-ignore-file: revisjonslogg og varsler lagrer stabile norske tekster,
// akkurat som resten av tjenestelaget. De oversettes ved visning.
import type { Prisma } from "@prisma/client";
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
  osloLocalParts,
  osloWallTimeToUtc,
} from "@/lib/business-hours";
import { loadBusinessCalendar } from "@/server/business-hours";
import {
  DISPATCH_POLICY_MODES,
  DEFAULT_DISPATCH_WEIGHTS,
  rankDispatchCandidates,
  scoreExplanationKeys,
  type DispatchCandidateInput,
  type DispatchCandidateScore,
  type DispatchRanking,
  type DispatchScoreBreakdown,
  type DispatchVisitInput,
  type DispatchWeights,
} from "@/lib/dispatch-scoring";
import { getRoutingProvider } from "@/lib/routing";
import type { RoutingProvider } from "@/lib/routing/types";
import { slaRemainingMinutes, slaStateAt } from "@/lib/sla";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { notifyUser } from "./notifications";
import {
  can,
  fail,
  ok,
  staffScopeFor,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceError,
  type ServiceResult,
} from "./actor";
import { assignVisitInTransaction } from "./visits";

const MAX_CANDIDATES = 200;
const MAX_VISITS = 100;
const MAX_ASSIGNED_VISITS = 2_000;
const MAX_CAPACITY_ROWS = 2_000;
const MAX_SETTINGS_ROWS = 200;

/** Stabile feilkoder for UI-et. */
export const DISPATCH_ERROR_CODES = {
  invalid: "dispatch.errors.invalid",
  forbidden: "dispatch.errors.forbidden",
  notFound: "dispatch.errors.notFound",
  noCandidate: "dispatch.errors.noCandidate",
  conflict: "dispatch.errors.conflict",
  applyFailed: "dispatch.errors.applyFailed",
} as const;

export type DispatchOptions = {
  now?: Date;
  routing?: RoutingProvider;
  weights?: Partial<DispatchWeights> | null;
  mode?: string | null;
  includeIneligible?: boolean;
};

export type DispatchCandidateView = DispatchCandidateScore;

export type AutoAssignPlan = {
  visitId: string;
  workOrderId: string;
  workOrderTitle: string;
  technicianId: string;
  technicianName: string;
  score: number;
  breakdown: DispatchScoreBreakdown;
};

export type AutoAssignSkipped = {
  visitId: string;
  workOrderId: string | null;
  reason: string;
};

export type AutoAssignResult = {
  dryRun: boolean;
  assignments: AutoAssignPlan[];
  skipped: AutoAssignSkipped[];
  applied: number;
};

type VisitRow = Prisma.VisitGetPayload<{
  select: {
    id: true;
    workOrderId: true;
    startsAt: true;
    endsAt: true;
    allDay: true;
    status: true;
    technicians: { select: { userId: true } };
    workOrder: {
      select: {
        id: true;
        title: true;
        departmentId: true;
        latitude: true;
        longitude: true;
        skillRequirements: {
          select: { skillId: true; mandatory: true };
        };
        slaClocks: {
          select: {
            startedAt: true;
            respondBy: true;
            resolveBy: true;
            respondedAt: true;
            resolvedAt: true;
            breachedAt: true;
            state: true;
          };
        };
      };
    };
  };
}>;

const visitSelect = {
  id: true,
  workOrderId: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  status: true,
  technicians: { select: { userId: true } },
  workOrder: {
    select: {
      id: true,
      title: true,
      departmentId: true,
      latitude: true,
      longitude: true,
      skillRequirements: { select: { skillId: true, mandatory: true } },
      slaClocks: {
        select: {
          startedAt: true,
          respondBy: true,
          resolveBy: true,
          respondedAt: true,
          resolvedAt: true,
          breachedAt: true,
          state: true,
        },
      },
    },
  },
} satisfies Prisma.VisitSelect;

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function normalizeIds(values: unknown, max = MAX_VISITS): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map(cleanId).filter((value) => value.length > 0)),
  ).slice(0, max);
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

function pointFor(
  workOrder: VisitRow["workOrder"],
): { latitude: number; longitude: number } | null {
  const latitude = workOrder.latitude ?? null;
  const longitude = workOrder.longitude ?? null;
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function visitInputFrom(
  visit: VisitRow,
  now: Date,
): DispatchVisitInput {
  const start = osloLocalParts(visit.startsAt);
  const end = osloLocalParts(visit.endsAt);
  const sameDay = start.dateOnly === end.dateOnly;
  const sla = visit.workOrder.slaClocks[0];
  return {
    id: visit.id,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    localWeekday: start.weekday,
    startMinute: start.minuteOfDay,
    endMinute: sameDay ? end.minuteOfDay : 24 * 60,
    requiredSkills: visit.workOrder.skillRequirements,
    slaRemainingMinutes: sla ? slaRemainingMinutes(sla, now) : null,
    slaBreached: sla ? slaStateAt(sla, now) === "BREACHED" : false,
  };
}

type BatchContext = {
  actor: ServiceActor;
  now: Date;
  routing: RoutingProvider;
  visits: VisitRow[];
  candidates: Array<{
    id: string;
    name: string | null;
    email: string | null;
    departmentId: string | null;
    skills: Array<{
      skillId: string;
      level: number | null;
      validUntil: Date | null;
    }>;
    availability: Array<{
      weekday: number;
      startMinute: number;
      endMinute: number;
    }>;
    absences: Array<{ startsAt: Date; endsAt: Date }>;
    capacityPlans: Array<{
      date: Date;
      capacityMinutes: number;
      departmentId: string;
    }>;
  }>;
  assignedVisits: Array<{
    startsAt: Date;
    endsAt: Date;
    userId: string;
    workOrder: { latitude: number | null; longitude: number | null };
  }>;
  dayCapacity: Map<string, number>;
  businessMinutes: Map<string, number>;
  policies: Map<string, { mode: string; weights: Partial<DispatchWeights> }>;
  weightOverrides?: Partial<DispatchWeights> | null;
  modeOverride?: string | null;
};

async function loadBatchContext(
  actor: ServiceActor,
  visitIds: string[],
  options: DispatchOptions,
): Promise<ServiceResult<BatchContext>> {
  const ids = normalizeIds(visitIds);
  if (ids.length === 0) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }

  const visits = await prisma.visit.findMany({
    where: {
      id: { in: ids },
      workOrder: { AND: [workOrderScopeFor(actor)] },
    },
    select: visitSelect,
    take: MAX_VISITS,
  });
  if (visits.length !== ids.length) {
    return fail("not_found", { code: DISPATCH_ERROR_CODES.notFound });
  }

  const now = options.now ?? new Date();
  const routing = options.routing ?? getRoutingProvider();
  const departmentIds = Array.from(
    new Set(visits.map((visit) => visit.workOrder.departmentId)),
  );

  const minStart = new Date(
    Math.min(...visits.map((visit) => visit.startsAt.getTime())),
  );
  const maxEnd = new Date(
    Math.max(...visits.map((visit) => visit.endsAt.getTime())),
  );
  const dayStart = osloDayStart(dateOnlyInOslo(minStart));
  const dayEnd = osloDayStart(
    toDateOnly(addDaysUtc(parseDateOnly(dateOnlyInOslo(maxEnd))!, 2)),
  );
  const dates = Array.from(
    new Set(visits.map((visit) => dateOnlyInOslo(visit.startsAt))),
  )
    .map((date) => parseDateOnly(date))
    .filter((date): date is Date => Boolean(date));

  const candidates = await prisma.user.findMany({
    where: {
      AND: [
        staffScopeFor(actor),
        { departmentId: { in: departmentIds } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      departmentId: true,
      skills: {
        select: { skillId: true, level: true, validUntil: true },
        take: 200,
      },
      availability: {
        select: { weekday: true, startMinute: true, endMinute: true },
        take: 50,
      },
      absences: {
        where: { startsAt: { lt: maxEnd }, endsAt: { gt: minStart } },
        select: { startsAt: true, endsAt: true },
        take: 50,
      },
      capacityPlans: {
        where: { date: { in: dates } },
        select: {
          date: true,
          capacityMinutes: true,
          departmentId: true,
        },
        take: 60,
      },
    },
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES,
  });
  const candidateIds = candidates.map((candidate) => candidate.id);

  const [assignedVisits, businessHours, policies, capacityPlans] =
    await Promise.all([
      prisma.visit.findMany({
        where: {
          status: { not: "CANCELLED" },
          workOrder: { deletedAt: null },
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
          technicians: {
            some: { userId: { in: candidateIds } },
          },
        },
        select: {
          startsAt: true,
          endsAt: true,
          technicians: { select: { userId: true } },
          workOrder: { select: { latitude: true, longitude: true } },
        },
        orderBy: { startsAt: "asc" },
        take: MAX_ASSIGNED_VISITS,
      }),
      prisma.businessHours.findMany({
        where: { departmentId: { in: departmentIds } },
        select: {
          departmentId: true,
          weekday: true,
          openMinute: true,
          closeMinute: true,
        },
        take: 100,
      }),
      prisma.assignmentPolicy.findMany({
        where: { departmentId: { in: departmentIds }, isActive: true },
        select: { departmentId: true, mode: true, weights: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      prisma.capacityPlan.findMany({
        where: {
          departmentId: { in: departmentIds },
          date: { in: dates },
          technicianId: null,
        },
        select: { departmentId: true, date: true, capacityMinutes: true },
        take: MAX_CAPACITY_ROWS,
      }),
    ]);

  const assigned = assignedVisits.flatMap((visit) =>
    visit.technicians.map((technician) => ({
      startsAt: visit.startsAt,
      endsAt: visit.endsAt,
      userId: technician.userId,
      workOrder: visit.workOrder,
    })),
  );

  const businessMinutes = new Map<string, number>();
  for (const row of businessHours) {
    if (row.closeMinute > row.openMinute) {
      const key = `${row.departmentId}:${row.weekday}`;
      businessMinutes.set(
        key,
        (businessMinutes.get(key) ?? 0) + row.closeMinute - row.openMinute,
      );
    }
  }

  const dayCapacity = new Map<string, number>();
  for (const plan of capacityPlans) {
    dayCapacity.set(
      `${plan.departmentId}:${toDateOnly(plan.date)}`,
      plan.capacityMinutes,
    );
  }

  const policyMap = new Map<
    string,
    { mode: string; weights: Partial<DispatchWeights> }
  >();
  for (const policy of policies) {
    if (policyMap.has(policy.departmentId)) continue;
    const raw = policy.weights;
    policyMap.set(policy.departmentId, {
      mode: policy.mode,
      weights:
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Partial<DispatchWeights>)
          : {},
    });
  }

  return ok({
    actor,
    now,
    routing,
    visits,
    candidates,
    assignedVisits: assigned,
    dayCapacity,
    businessMinutes,
    policies: policyMap,
    weightOverrides: options.weights,
    modeOverride: options.mode,
  });
}

function capacityFor(
  context: BatchContext,
  candidate: BatchContext["candidates"][number],
  visit: VisitRow,
): number {
  const date = dateOnlyInOslo(visit.startsAt);
  const explicit = candidate.capacityPlans.find(
    (plan) =>
      toDateOnly(plan.date) === date &&
      plan.departmentId === visit.workOrder.departmentId,
  );
  if (explicit) return Math.max(0, explicit.capacityMinutes);

  const departmentCapacity = context.dayCapacity.get(
    `${visit.workOrder.departmentId}:${date}`,
  );
  if (typeof departmentCapacity === "number") {
    return Math.max(0, departmentCapacity);
  }

  const weekday = osloLocalParts(visit.startsAt).weekday;
  return (
    context.businessMinutes.get(
      `${visit.workOrder.departmentId}:${weekday}`,
    ) ?? 8 * 60
  );
}

function lastPointFor(
  context: BatchContext,
  candidateId: string,
  visit: VisitRow,
): { latitude: number; longitude: number } | null {
  const previous = context.assignedVisits
    .filter(
      (assigned) =>
        assigned.userId === candidateId &&
        assigned.startsAt < visit.startsAt &&
        assigned.workOrder.latitude !== null &&
        assigned.workOrder.longitude !== null,
    )
    .sort(
      (a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
    )[0];
  if (!previous) return null;
  return {
    latitude: previous.workOrder.latitude!,
    longitude: previous.workOrder.longitude!,
  };
}

async function rankVisit(
  context: BatchContext,
  visit: VisitRow,
): Promise<DispatchRanking> {
  const target = pointFor(visit.workOrder);
  const policy = context.policies.get(visit.workOrder.departmentId);
  const visitDate = dateOnlyInOslo(visit.startsAt);
  const visitDayStart = osloDayStart(visitDate);
  const visitDayEnd = osloDayStart(toDateOnly(addDaysUtc(parseDateOnly(visitDate)!, 1)));

  const origins: Array<{ latitude: number; longitude: number }> = [];
  const originIndex = new Map<string, number>();
  const travelByCandidate = new Map<
    string,
    { distanceKm: number; durationMinutes: number }
  >();

  for (const candidate of context.candidates) {
    if (candidate.departmentId !== visit.workOrder.departmentId) continue;
    const lastPoint = lastPointFor(context, candidate.id, visit);
    if (!lastPoint || !target) continue;
    const key = `${candidate.id}`;
    originIndex.set(key, origins.length);
    origins.push(lastPoint);
  }

  if (origins.length > 0 && target) {
    const matrix = await context.routing.matrix(origins, [target]);
    for (const [candidateId, index] of originIndex) {
      const estimate = matrix[index]?.[0];
      if (estimate) {
        travelByCandidate.set(candidateId, {
          distanceKm: estimate.distanceKm,
          durationMinutes: estimate.durationMinutes,
        });
      }
    }
  }

  const candidateInputs: DispatchCandidateInput[] = context.candidates
    .filter(
      (candidate) =>
        candidate.departmentId === visit.workOrder.departmentId,
    )
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name ?? candidate.email ?? candidate.id,
      skills: candidate.skills,
      availability: candidate.availability,
      absences: candidate.absences,
      assignedVisits: context.assignedVisits
        .filter(
          (assigned) =>
            assigned.userId === candidate.id &&
            assigned.startsAt < visitDayEnd &&
            assigned.endsAt > visitDayStart,
        )
        .map((assigned) => ({
          startsAt: assigned.startsAt,
          endsAt: assigned.endsAt,
        })),
      capacityMinutes: capacityFor(context, candidate, visit),
      travel: travelByCandidate.get(candidate.id) ?? null,
    }));

  return rankDispatchCandidates({
    visit: visitInputFrom(visit, context.now),
    candidates: candidateInputs,
    weights: context.weightOverrides ?? policy?.weights ?? null,
    mode: context.modeOverride ?? policy?.mode ?? null,
  });
}

/**
 * Rangerer montørene for én visitt. Resultatet inneholder både de kvalifiserte
 * og de ekskluderte kandidatene, slik at UI-et kan forklare hvorfor noen ikke
 * er foreslått. Funksjonen er deterministisk og gjør ingen skrivinger.
 */
export async function scoreCandidates(
  actor: ServiceActor,
  visitIdOrVisit: string | { id: string },
  options: DispatchOptions = {},
): Promise<ServiceResult<DispatchRanking>> {
  if (!can(actor, "workorders.view") && !can(actor, "workorders.assign")) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  const visitId =
    typeof visitIdOrVisit === "string"
      ? visitIdOrVisit
      : visitIdOrVisit?.id;
  const id = cleanId(visitId);
  if (!id) return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });

  const loaded = await loadBatchContext(actor, [id], options);
  if (!loaded.ok) return loaded;
  const ranking = await rankVisit(loaded.data, loaded.data.visits[0]);
  return ok(ranking);
}

/**
 * Rangerer flere visiter med felles oppslag. Dispatch-tavla bruker denne, slik
 * at 80 kort ikke gir 80 × N databasespørringer.
 */
export async function scoreCandidatesForVisits(
  actor: ServiceActor,
  visitIds: string[],
  options: DispatchOptions = {},
): Promise<ServiceResult<DispatchRanking[]>> {
  if (!can(actor, "workorders.view") && !can(actor, "workorders.assign")) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  const loaded = await loadBatchContext(actor, visitIds, options);
  if (!loaded.ok) return loaded;
  const rankings: DispatchRanking[] = [];
  for (const visit of loaded.data.visits) {
    rankings.push(await rankVisit(loaded.data, visit));
  }
  return ok(rankings);
}

function planFromRanking(
  visit: VisitRow,
  ranking: DispatchRanking,
  reserved: Array<{ technicianId: string; startsAt: Date; endsAt: Date }>,
): { plan: AutoAssignPlan | null; reason: string | null } {
  if (visit.technicians.length > 0) {
    return { plan: null, reason: "already_assigned" };
  }
  for (const candidate of ranking.candidates) {
    if (!candidate.eligible) continue;
    const conflict = reserved.some(
      (slot) =>
        slot.technicianId === candidate.id &&
        slot.startsAt < visit.endsAt &&
        slot.endsAt > visit.startsAt,
    );
    if (conflict) continue;
    return {
      plan: {
        visitId: visit.id,
        workOrderId: visit.workOrderId,
        workOrderTitle: visit.workOrder.title,
        technicianId: candidate.id,
        technicianName: candidate.name,
        score: candidate.score,
        breakdown: candidate.breakdown,
      },
      reason: null,
    };
  }
  return { plan: null, reason: "no_candidate" };
}

class DispatchApplyError extends Error {
  constructor(
    public reason: string,
    public details?: unknown,
  ) {
    super(reason);
  }
}

/**
 * Foreslår og eventuelt tildeler montører for flere visiter.
 *
 * Standard er tørrkjøring: ingenting skrives, men planen kan vises i UI-et.
 * Ved `dryRun: false` kreves `workorders.assign`, og hver tildeling går gjennom
 * den transaksjonsbevisste visittjenesten. Revisjonsraden inneholder
 * poengsummen, slik at en automatisk tildeling kan forklares i ettertid.
 * Varsler sendes først etter commit.
 */
export async function autoAssign(
  actor: ServiceActor,
  visitIds: string[],
  options: DispatchOptions & { dryRun?: boolean } = {},
): Promise<ServiceResult<AutoAssignResult>> {
  const dryRun = options.dryRun !== false;
  if (!dryRun && !can(actor, "workorders.assign")) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  if (!can(actor, "workorders.view") && !can(actor, "workorders.assign")) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }

  const loaded = await loadBatchContext(actor, visitIds, options);
  if (!loaded.ok) return loaded;

  const rankings = new Map<string, DispatchRanking>();
  for (const visit of loaded.data.visits) {
    rankings.set(visit.id, await rankVisit(loaded.data, visit));
  }

  const reserved: Array<{
    technicianId: string;
    startsAt: Date;
    endsAt: Date;
  }> = [];
  const assignments: AutoAssignPlan[] = [];
  const skipped: AutoAssignSkipped[] = [];

  for (const visit of loaded.data.visits) {
    const ranking = rankings.get(visit.id);
    const { plan, reason } = planFromRanking(
      visit,
      ranking!,
      reserved,
    );
    if (!plan) {
      skipped.push({
        visitId: visit.id,
        workOrderId: visit.workOrderId,
        reason: reason ?? "no_candidate",
      });
      continue;
    }
    assignments.push(plan);
    reserved.push({
      technicianId: plan.technicianId,
      startsAt: visit.startsAt,
      endsAt: visit.endsAt,
    });
  }

  if (dryRun) {
    return ok({ dryRun: true, assignments, skipped, applied: 0 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const plan of assignments) {
        const result = await assignVisitInTransaction(
          tx,
          actor,
          plan.visitId,
          [plan.technicianId],
          {
            scoreSnapshot: {
              technicianId: plan.technicianId,
              score: plan.score,
              breakdown: plan.breakdown,
            },
          },
        );
        if (!result.ok) {
          throw new DispatchApplyError(result.reason, result.details);
        }
      }
    });
  } catch (error) {
    if (error instanceof DispatchApplyError) {
      return fail(error.reason as ServiceError, {
        code: DISPATCH_ERROR_CODES.applyFailed,
        details: error.details,
      });
    }
    throw error;
  }

  // Varslene sendes etter commit. En feil her skal ikke rulle tilbake
  // tildelingen, som allerede er revisjonsloggført.
  for (const plan of assignments) {
    try {
      await notifyUser({
        userId: plan.technicianId,
        type: "ASSIGNMENT",
        title: `Ny visitt tildelt: ${plan.workOrderTitle}`,
        body: `Dispatch foreslo deg med poengsum ${plan.score}.`,
        href: `/oppdrag/${plan.workOrderId}`,
        dedupeKey: `dispatch:${plan.visitId}:${plan.technicianId}`,
      });
    } catch (error) {
      console.error("Kunne ikke varsle montør etter dispatch-tildeling", error);
    }
  }

  return ok({
    dryRun: false,
    assignments,
    skipped,
    applied: assignments.length,
  });
}

export type SlotSuggestion = {
  startsAt: Date;
  endsAt: Date;
  technicianId: string;
  technicianName: string;
  score: number;
  travelMinutes: number | null;
};

/**
 * Finner første ledige tidsrom for et oppdrag.
 *
 * Merk: `BookingHold` er ikke en del av skjemaet i denne fasen (den kommer i
 * 5A). Når modellen finnes, skal aktive holds trekkes fra på samme måte som
 * visiter. Inntil da er denne funksjonen uttrykkelig uten holds, og det er
 * dokumentert i `docs/DECISIONS.md`.
 */
export async function findSlot(
  actor: ServiceActor,
  workOrderId: string,
  options: DispatchOptions & { days?: number; durationMinutes?: number } = {},
): Promise<ServiceResult<SlotSuggestion[]>> {
  if (!can(actor, "workorders.assign")) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  const id = cleanId(workOrderId);
  if (!id) return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });

  const workOrder = await prisma.workOrder.findFirst({
    where: { id, ...workOrderScopeFor(actor) },
    select: {
      id: true,
      departmentId: true,
      latitude: true,
      longitude: true,
      skillRequirements: { select: { skillId: true, mandatory: true } },
      visits: {
        select: { startsAt: true, endsAt: true, allDay: true },
        orderBy: { startsAt: "asc" },
        take: 20,
      },
    },
  });
  if (!workOrder) {
    return fail("not_found", { code: DISPATCH_ERROR_CODES.notFound });
  }

  const days = Math.min(60, Math.max(1, Math.round(options.days ?? 14)));
  const now = options.now ?? new Date();
  const durationMinutes = Math.max(
    15,
    Math.round(
      options.durationMinutes ??
        (workOrder.visits[0]
          ? (workOrder.visits[0].endsAt.getTime() -
              workOrder.visits[0].startsAt.getTime()) /
            60_000
          : 60),
    ),
  );

  const startDay = parseDateOnly(todayInOsloFrom(now));
  if (!startDay) return ok([]);

  const rangeStart = osloDayStart(toDateOnly(startDay));
  const rangeEnd = osloDayStart(
    toDateOnly(addDaysUtc(startDay, days + 1)),
  );

  // Oppdraget kan mangle visiter. Da henter vi kandidatene direkte, med samme
  // scope og begrensninger som scoreCandidates.
  const staff = await prisma.user.findMany({
    where: {
      AND: [
        staffScopeFor(actor),
        { departmentId: workOrder.departmentId },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      skills: { select: { skillId: true, validUntil: true }, take: 200 },
      availability: {
        select: { weekday: true, startMinute: true, endMinute: true },
        take: 50,
      },
      absences: {
        where: { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
        select: { startsAt: true, endsAt: true },
        take: 50,
      },
    },
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES,
  });

  const visits = await prisma.visit.findMany({
    where: {
      status: { not: "CANCELLED" },
      workOrder: { deletedAt: null },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      technicians: { some: { userId: { in: staff.map((user) => user.id) } } },
    },
    select: {
      startsAt: true,
      endsAt: true,
      technicians: { select: { userId: true } },
      workOrder: { select: { latitude: true, longitude: true } },
    },
    orderBy: { startsAt: "asc" },
    take: MAX_ASSIGNED_VISITS,
  });

  // 5A: aktive, ubekreftede reservasjoner blokkerer samme tidsrom. Utløpte
  // og konsumerte holds ignoreres, akkurat som i tilgjengelighetsmotoren.
  const holds = await prisma.bookingHold.findMany({
    where: {
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      expiresAt: { gt: now },
      consumedAt: null,
    },
    select: { startsAt: true, endsAt: true, technicianId: true },
    take: 500,
  });

  const calendar = await loadBusinessCalendar(
    prisma as unknown as Prisma.TransactionClient,
    workOrder.departmentId,
  );
  const target = {
    latitude: workOrder.latitude,
    longitude: workOrder.longitude,
  };
  const routing = options.routing ?? getRoutingProvider();
  const required = workOrder.skillRequirements;
  const requiredIds = new Set(
    required.filter((skill) => skill.mandatory).map((skill) => skill.skillId),
  );
  const suggestions: SlotSuggestion[] = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const day = addDaysUtc(startDay, dayOffset);
    const dateOnly = toDateOnly(day);
    const weekday = (day.getUTCDay() + 6) % 7;
    const windows = calendar.windows
      .filter((window) => window.weekday === weekday)
      .sort((a, b) => a.openMinute - b.openMinute);

    for (const window of windows) {
      for (
        let minute = window.openMinute;
        minute + durationMinutes <= window.closeMinute;
        minute += 30
      ) {
        const startsAt = osloWallTimeToUtc(dateOnly, minute);
        if (startsAt <= now) continue;
        const endsAt = new Date(
          startsAt.getTime() + durationMinutes * 60_000,
        );

        for (const candidate of staff) {
          const validSkills = new Set(
            candidate.skills
              .filter(
                (skill) =>
                  !skill.validUntil ||
                  skill.validUntil.getTime() >= startsAt.getTime(),
              )
              .map((skill) => skill.skillId),
          );
          if ([...requiredIds].some((skillId) => !validSkills.has(skillId))) {
            continue;
          }
          const absent = candidate.absences.some(
            (absence) =>
              absence.startsAt < endsAt && absence.endsAt > startsAt,
          );
          if (absent) continue;
          if (candidate.availability.length > 0) {
            const available = candidate.availability.some(
              (availability) =>
                availability.weekday === weekday &&
                availability.startMinute <= minute &&
                availability.endMinute >= minute + durationMinutes,
            );
            if (!available) continue;
          }
          const conflict = visits.some(
            (visit) =>
              visit.technicians.some(
                (technician) => technician.userId === candidate.id,
              ) &&
              visit.startsAt < endsAt &&
              visit.endsAt > startsAt,
          );
          if (conflict) continue;
          const held = holds.some(
            (hold) =>
              (hold.technicianId === null ||
                hold.technicianId === candidate.id) &&
              hold.startsAt < endsAt &&
              hold.endsAt > startsAt,
          );
          if (held) continue;

          const previous = visits
            .filter(
              (visit) =>
                visit.technicians.some(
                  (technician) => technician.userId === candidate.id,
                ) &&
                visit.endsAt <= startsAt &&
                visit.workOrder.latitude !== null &&
                visit.workOrder.longitude !== null,
            )
            .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
          let travelMinutes: number | null = null;
          if (previous && target.latitude !== null && target.longitude !== null) {
            const estimate = await routing.route(
              {
                latitude: previous.workOrder.latitude!,
                longitude: previous.workOrder.longitude!,
              },
              { latitude: target.latitude, longitude: target.longitude },
            );
            travelMinutes = estimate.durationMinutes;
            // Reisetiden må være ferdig før dette tidsrommet. Ellers er
            // forslaget ikke gjennomførbart, og vi prøver neste ledige rom.
            if (
              previous.endsAt.getTime() +
                estimate.durationMinutes * 60_000 >
              startsAt.getTime()
            ) {
              continue;
            }
          }

          suggestions.push({
            startsAt,
            endsAt,
            technicianId: candidate.id,
            technicianName: candidate.name ?? candidate.email ?? candidate.id,
            score: 0,
            travelMinutes,
          });
        }

        if (suggestions.length >= 10) break;
      }
      if (suggestions.length >= 10) break;
    }
    if (suggestions.length >= 10) break;
  }

  return ok(suggestions);
}

function todayInOsloFrom(now: Date): string {
  return dateOnlyInOslo(now);
}

// ---------------------------------------------------------------------------
// Kapasitet
// ---------------------------------------------------------------------------

export type CapacityTechnicianRow = {
  id: string;
  name: string;
  capacityMinutes: number;
  loadMinutes: number;
  visitCount: number;
};

export type CapacityDayRow = {
  date: string;
  departmentId: string;
  departmentName: string;
  capacityMinutes: number;
  loadMinutes: number;
  technicians: CapacityTechnicianRow[];
};

export type CapacityOverview = {
  from: string;
  to: string;
  days: CapacityDayRow[];
  totals: { capacityMinutes: number; loadMinutes: number };
};

function emptyCapacity(): CapacityOverview {
  return {
    from: "",
    to: "",
    days: [],
    totals: { capacityMinutes: 0, loadMinutes: 0 },
  };
}

/**
 * Kapasitet mot belastning per avdeling, dag og montør. Alle spørringene er
 * avgrenset til perioden og avdelingene brukeren faktisk ser.
 */
export async function getCapacityOverview(
  actor: ServiceActor,
  from: Date,
  to: Date,
): Promise<ServiceResult<CapacityOverview>> {
  if (!can(actor, "workorders.view")) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  if (
    !(from instanceof Date) ||
    !(to instanceof Date) ||
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to < from
  ) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }

  const fromDate = dateOnlyInOslo(from);
  const toDate = dateOnlyInOslo(to);
  const rangeStart = osloDayStart(fromDate);
  const rangeEnd = osloDayStart(toDateOnly(addDaysUtc(parseDateOnly(toDate)!, 1)));

  const departments = await prisma.department.findMany({
    where:
      actor.role === "ADMIN"
        ? { isActive: true }
        : { id: actor.departmentId ?? "", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  if (departments.length === 0) return ok(emptyCapacity());

  const departmentIds = departments.map((department) => department.id);
  const dateRows = Array.from(
    {
      length: Math.max(
        1,
        Math.min(
          62,
          Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1,
        ),
      ),
    },
    (_, index) =>
      toDateOnly(addDaysUtc(parseDateOnly(fromDate)!, index)),
  )
    .map((date) => parseDateOnly(date))
    .filter((date): date is Date => Boolean(date));

  const [staff, plans, visits, businessHours] = await Promise.all([
    prisma.user.findMany({
      where: {
        departmentId: { in: departmentIds },
        isActive: true,
        role: { not: "CUSTOMER" },
      },
      select: { id: true, name: true, departmentId: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.capacityPlan.findMany({
      where: { departmentId: { in: departmentIds }, date: { in: dateRows } },
      select: {
        departmentId: true,
        date: true,
        technicianId: true,
        capacityMinutes: true,
      },
      take: MAX_CAPACITY_ROWS,
    }),
    prisma.visit.findMany({
      where: {
        status: { not: "CANCELLED" },
        workOrder: { departmentId: { in: departmentIds }, deletedAt: null },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      },
      select: {
        startsAt: true,
        endsAt: true,
        technicians: { select: { userId: true } },
        workOrder: { select: { departmentId: true } },
      },
      orderBy: { startsAt: "asc" },
      take: 5_000,
    }),
    prisma.businessHours.findMany({
      where: { departmentId: { in: departmentIds } },
      select: {
        departmentId: true,
        weekday: true,
        openMinute: true,
        closeMinute: true,
      },
      take: 700,
    }),
  ]);

  const business = new Map<string, number>();
  for (const row of businessHours) {
    if (row.closeMinute > row.openMinute) {
      const key = `${row.departmentId}:${row.weekday}`;
      business.set(
        key,
        (business.get(key) ?? 0) + row.closeMinute - row.openMinute,
      );
    }
  }

  const explicitTech = new Map<string, number>();
  const explicitDepartment = new Map<string, number>();
  for (const plan of plans) {
    const key = `${plan.departmentId}:${toDateOnly(plan.date)}:${plan.technicianId ?? ""}`;
    if (plan.technicianId) explicitTech.set(key, plan.capacityMinutes);
    else explicitDepartment.set(key, plan.capacityMinutes);
  }

  const loadByTech = new Map<string, { minutes: number; visits: number }>();
  for (const visit of visits) {
    const date = dateOnlyInOslo(visit.startsAt);
    const minutes = Math.max(
      0,
      Math.round(
        (Math.min(
          visit.endsAt.getTime(),
          osloDayStart(toDateOnly(addDaysUtc(parseDateOnly(date)!, 1))).getTime(),
        ) -
          Math.max(
            visit.startsAt.getTime(),
            osloDayStart(date).getTime(),
          )) /
          60_000,
      ),
    );
    for (const technician of visit.technicians) {
      const key = `${technician.userId}:${date}`;
      const current = loadByTech.get(key) ?? { minutes: 0, visits: 0 };
      loadByTech.set(key, {
        minutes: current.minutes + minutes,
        visits: current.visits + 1,
      });
    }
  }

  const days: CapacityDayRow[] = [];
  for (const department of departments) {
    for (const date of dateRows) {
      const dateOnly = toDateOnly(date);
      const weekday = (date.getUTCDay() + 6) % 7;
      const defaultMinutes =
        business.get(`${department.id}:${weekday}`) ?? 8 * 60;

      const technicians: CapacityTechnicianRow[] = staff
        .filter((person) => person.departmentId === department.id)
        .map((person) => {
          const capacity =
            explicitTech.get(`${department.id}:${dateOnly}:${person.id}`) ??
            defaultMinutes;
          const load = loadByTech.get(`${person.id}:${dateOnly}`) ?? {
            minutes: 0,
            visits: 0,
          };
          return {
            id: person.id,
            name: person.name ?? person.id,
            capacityMinutes: Math.max(0, capacity),
            loadMinutes: load.minutes,
            visitCount: load.visits,
          };
        });

      const departmentCapacity = explicitDepartment.get(
        `${department.id}:${dateOnly}:`,
      );
      days.push({
        date: dateOnly,
        departmentId: department.id,
        departmentName: department.name,
        capacityMinutes:
          departmentCapacity ??
          technicians.reduce(
            (sum, person) => sum + person.capacityMinutes,
            0,
          ),
        loadMinutes: technicians.reduce(
          (sum, person) => sum + person.loadMinutes,
          0,
        ),
        technicians,
      });
    }
  }

  return ok({
    from: fromDate,
    to: toDate,
    days,
    totals: {
      capacityMinutes: days.reduce(
        (sum, day) => sum + day.capacityMinutes,
        0,
      ),
      loadMinutes: days.reduce((sum, day) => sum + day.loadMinutes, 0),
    },
  });
}

// ---------------------------------------------------------------------------
// Unntak på dashbordet
// ---------------------------------------------------------------------------

export type DispatchExceptionCounts = {
  unassignedToday: number;
  visitsWithoutTechnician: number;
  doubleBooked: number;
  overdue: number;
  missingCoordinates: number;
  unsignedReports: number;
  staleBookings: number;
};

/** Telleverk for dashbordets unntakskort. Alle oppslag er avgrenset. */
export async function getDispatchExceptionCounts(
  actor: ServiceActor,
  now = new Date(),
): Promise<ServiceResult<DispatchExceptionCounts>> {
  if (!can(actor, "workorders.view")) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }

  const today = parseDateOnly(dateOnlyInOslo(now));
  if (!today) return ok(emptyExceptions());
  const todayStart = osloDayStart(toDateOnly(today));
  const weekEnd = osloDayStart(toDateOnly(addDaysUtc(today, 8)));
  const scope = workOrderScopeFor(actor);

  const [unassignedToday, visitsWithoutTechnician, overdue, missingCoordinates, unsignedReports, staleBookings, visitsForOverlap] =
    await Promise.all([
      prisma.workOrder.count({
        where: {
          AND: [
            scope,
            { status: { notIn: ["COMPLETED", "CANCELLED"] } },
            { technicians: { none: {} } },
            { scheduledFor: { lte: today } },
            { OR: [{ scheduledTo: null }, { scheduledTo: { gte: today } }] },
          ],
        },
      }),
      prisma.visit.count({
        where: {
          status: { not: "CANCELLED" },
          startsAt: { lt: weekEnd },
          endsAt: { gt: todayStart },
          technicians: { none: {} },
          workOrder: { AND: [scope] },
        },
      }),
      prisma.workOrder.count({
        where: {
          AND: [
            scope,
            { status: { notIn: ["COMPLETED", "CANCELLED"] } },
            { scheduledFor: { lt: today } },
            { OR: [{ scheduledTo: null }, { scheduledTo: { lt: today } }] },
          ],
        },
      }),
      prisma.workOrder.count({
        where: {
          AND: [
            scope,
            { status: { notIn: ["COMPLETED", "CANCELLED"] } },
            { latitude: null },
            { longitude: null },
            {
              OR: [
                { address: { not: null } },
                { postalCode: { not: null } },
                { city: { not: null } },
              ],
            },
          ],
        },
      }),
      prisma.report.count({
        where: {
          deletedAt: null,
          technicianSignatureUrl: null,
          workOrder: { AND: [scope] },
        },
      }),
      prisma.bookingRequest.count({
        where: {
          status: "PENDING",
          createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          workOrder: { AND: [scope] },
        },
      }),
      prisma.visit.findMany({
        where: {
          status: { not: "CANCELLED" },
          startsAt: { lt: weekEnd },
          endsAt: { gt: todayStart },
          workOrder: { AND: [scope] },
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          technicians: { select: { userId: true } },
        },
        orderBy: { startsAt: "asc" },
        take: 1_000,
      }),
    ]);

  const doubleBooked = new Set<string>();
  const byTechnician = new Map<string, Array<{ id: string; startsAt: Date; endsAt: Date }>>();
  for (const visit of visitsForOverlap) {
    for (const technician of visit.technicians) {
      const list = byTechnician.get(technician.userId) ?? [];
      list.push({
        id: visit.id,
        startsAt: visit.startsAt,
        endsAt: visit.endsAt,
      });
      byTechnician.set(technician.userId, list);
    }
  }
  for (const list of byTechnician.values()) {
    list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    let latestEnd = 0;
    let latestId = "";
    for (const visit of list) {
      if (visit.startsAt.getTime() < latestEnd) {
        doubleBooked.add(visit.id);
        if (latestId) doubleBooked.add(latestId);
      }
      if (visit.endsAt.getTime() > latestEnd) {
        latestEnd = visit.endsAt.getTime();
        latestId = visit.id;
      }
    }
  }

  return ok({
    unassignedToday,
    visitsWithoutTechnician,
    doubleBooked: doubleBooked.size,
    overdue,
    missingCoordinates,
    unsignedReports,
    staleBookings,
  });
}

function emptyExceptions(): DispatchExceptionCounts {
  return {
    unassignedToday: 0,
    visitsWithoutTechnician: 0,
    doubleBooked: 0,
    overdue: 0,
    missingCoordinates: 0,
    unsignedReports: 0,
    staleBookings: 0,
  };
}

// ---------------------------------------------------------------------------
// Innstillinger: policyer og territorier
// ---------------------------------------------------------------------------

export type DispatchPolicyView = {
  id: string;
  departmentId: string;
  mode: string;
  weights: DispatchWeights;
  isActive: boolean;
};

export type TerritoryView = {
  id: string;
  departmentId: string;
  name: string;
  postalPrefixes: string[];
  municipalityCodes: string[];
  radiusKm: number | null;
  centerLat: number | null;
  centerLng: number | null;
  isActive: boolean;
};

export type DispatchSettingsView = {
  policies: DispatchPolicyView[];
  territories: TerritoryView[];
};

function canConfigure(actor: ServiceActor): boolean {
  return can(actor, "dispatch.configure") || can(actor, "settings.manage");
}

function sanitizeWeights(input: unknown): DispatchWeights {
  const result = { ...DEFAULT_DISPATCH_WEIGHTS };
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of Object.keys(result) as Array<keyof DispatchWeights>) {
      const value = clampNumber((input as Record<string, unknown>)[key], 0, 100);
      if (value !== null) result[key] = value;
    }
  }
  return result;
}

function cleanStringArray(value: unknown, pattern: RegExp, max = 50): string[] | null {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value)
    ? value
    : String(value)
        .split(/[,\s]+/)
        .filter(Boolean);
  const cleaned = Array.from(new Set(raw.map((item) => cleanText(item, { maxLength: 20 }))));
  if (cleaned.length > max) return null;
  if (cleaned.some((item) => !pattern.test(item))) return null;
  return cleaned;
}

/** Leser policyer og territorier for én avdeling (eller alle for admin). */
export async function getDispatchSettings(
  actor: ServiceActor,
  departmentId?: string | null,
): Promise<ServiceResult<DispatchSettingsView>> {
  if (!can(actor, "workorders.view") && !canConfigure(actor)) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  const targetDepartment =
    actor.role === "ADMIN" ? departmentId ?? undefined : actor.departmentId ?? undefined;
  if (!targetDepartment) return ok({ policies: [], territories: [] });

  const [policies, territories] = await Promise.all([
    prisma.assignmentPolicy.findMany({
      where: { departmentId: targetDepartment },
      select: {
        id: true,
        departmentId: true,
        mode: true,
        weights: true,
        isActive: true,
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_SETTINGS_ROWS,
    }),
    prisma.territory.findMany({
      where: { departmentId: targetDepartment },
      select: {
        id: true,
        departmentId: true,
        name: true,
        postalPrefixes: true,
        municipalityCodes: true,
        radiusKm: true,
        centerLat: true,
        centerLng: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
      take: MAX_SETTINGS_ROWS,
    }),
  ]);

  return ok({
    policies: policies.map((policy) => ({
      ...policy,
      weights: sanitizeWeights(policy.weights),
    })),
    territories,
  });
}

export async function saveAssignmentPolicy(
  actor: ServiceActor,
  input: {
    id?: string | null;
    departmentId: string;
    mode: string;
    weights: unknown;
    isActive?: boolean;
  },
): Promise<ServiceResult<DispatchPolicyView>> {
  if (!canConfigure(actor)) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  const departmentId = cleanId(input.departmentId);
  const mode = String(input.mode ?? "").toUpperCase();
  if (
    !departmentId ||
    !(DISPATCH_POLICY_MODES as readonly string[]).includes(mode)
  ) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }
  const department = await prisma.department.findFirst({
    where: { id: departmentId, isActive: true },
    select: { id: true, name: true },
  });
  if (!department) return fail("not_found", { code: DISPATCH_ERROR_CODES.notFound });

  const weights = sanitizeWeights(input.weights);
  const existing = input.id
    ? await prisma.assignmentPolicy.findFirst({
        where: { id: cleanId(input.id), departmentId },
        select: { id: true },
      })
    : null;

  const saved = await prisma.$transaction(async (tx) => {
    const result = existing
      ? await tx.assignmentPolicy.update({
          where: { id: existing.id },
          data: {
            mode,
            weights,
            isActive: input.isActive !== false,
          },
        })
      : await tx.assignmentPolicy.create({
          data: {
            departmentId,
            mode,
            weights,
            isActive: input.isActive !== false,
          },
        });
    await audit(tx, {
      entityType: "Department",
      entityId: departmentId,
      action: `Oppdaterte dispatch-policy for ${department.name}`,
      actor: toAuditActor(actor),
      metadata: { mode, weights },
    });
    return result;
  });

  return ok({
    id: saved.id,
    departmentId,
    mode,
    weights,
    isActive: saved.isActive,
  });
}

export async function saveTerritory(
  actor: ServiceActor,
  input: {
    id?: string | null;
    departmentId: string;
    name: string;
    postalPrefixes?: unknown;
    municipalityCodes?: unknown;
    radiusKm?: unknown;
    centerLat?: unknown;
    centerLng?: unknown;
    isActive?: boolean;
  },
): Promise<ServiceResult<TerritoryView>> {
  if (!canConfigure(actor)) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  const departmentId = cleanId(input.departmentId);
  const name = cleanText(input.name, { maxLength: LIMITS.short });
  if (!departmentId || name.length < 2) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }

  const department = await prisma.department.findFirst({
    where: { id: departmentId, isActive: true },
    select: { id: true, name: true },
  });
  if (!department) return fail("not_found", { code: DISPATCH_ERROR_CODES.notFound });

  const postalPrefixes = cleanStringArray(input.postalPrefixes, /^\d{2,4}$/);
  const municipalityCodes = cleanStringArray(
    input.municipalityCodes,
    /^\d{4}$/,
  );
  if (!postalPrefixes || !municipalityCodes) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }

  const radiusKm =
    input.radiusKm === undefined || input.radiusKm === ""
      ? null
      : clampNumber(input.radiusKm, 0, 500);
  if (input.radiusKm !== undefined && input.radiusKm !== "" && radiusKm === null) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }
  const centerLat =
    input.centerLat === undefined || input.centerLat === ""
      ? null
      : clampNumber(input.centerLat, -90, 90);
  const centerLng =
    input.centerLng === undefined || input.centerLng === ""
      ? null
      : clampNumber(input.centerLng, -180, 180);
  if (
    (centerLat === null) !== (centerLng === null) ||
    (input.centerLat !== undefined &&
      input.centerLat !== "" &&
      centerLat === null) ||
    (input.centerLng !== undefined &&
      input.centerLng !== "" &&
      centerLng === null)
  ) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }

  const existing = input.id
    ? await prisma.territory.findFirst({
        where: { id: cleanId(input.id), departmentId },
        select: { id: true },
      })
    : null;

  let saved;
  try {
    saved = await prisma.$transaction(async (tx) => {
      const data = {
        name,
        postalPrefixes,
        municipalityCodes,
        radiusKm,
        centerLat,
        centerLng,
        isActive: input.isActive !== false,
      };
      const result = existing
        ? await tx.territory.update({ where: { id: existing.id }, data })
        : await tx.territory.create({ data: { departmentId, ...data } });
      await audit(tx, {
        entityType: "Department",
        entityId: departmentId,
        action: `Oppdaterte territorium: ${name}`,
        actor: toAuditActor(actor),
      });
      return result;
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return fail("conflict", { code: DISPATCH_ERROR_CODES.conflict });
    }
    throw error;
  }

  return ok({
    id: saved.id,
    departmentId,
    name,
    postalPrefixes,
    municipalityCodes,
    radiusKm,
    centerLat,
    centerLng,
    isActive: saved.isActive,
  });
}

export async function deleteTerritory(
  actor: ServiceActor,
  id: string,
): Promise<ServiceResult> {
  if (!canConfigure(actor)) {
    return fail("forbidden", { code: DISPATCH_ERROR_CODES.forbidden });
  }
  const territoryId = cleanId(id);
  if (!territoryId) {
    return fail("invalid", { code: DISPATCH_ERROR_CODES.invalid });
  }
  const existing = await prisma.territory.findFirst({
    where: {
      id: territoryId,
      ...(actor.role === "ADMIN"
        ? {}
        : { departmentId: actor.departmentId ?? "" }),
    },
    select: { id: true, departmentId: true, name: true },
  });
  if (!existing) return fail("not_found", { code: DISPATCH_ERROR_CODES.notFound });

  await prisma.$transaction(async (tx) => {
    await tx.territory.delete({ where: { id: existing.id } });
    await audit(tx, {
      entityType: "Department",
      entityId: existing.departmentId,
      action: `Slettet territorium: ${existing.name}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(undefined);
}

export { scoreExplanationKeys };
