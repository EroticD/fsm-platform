// i18n-ignore-file: revisjonsloggen lagrer stabile, ferdig formaterte norske
// handlingsstrenger (med tittel/navn flettet inn). De oversettes ved visning i
// `src/lib/audit-actions.ts`; lagrede rader endres ikke.
import type { Prisma, Visit, WorkStatus } from "@prisma/client";
import { VisitStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { staffForDepartment } from "@/lib/access";
import {
  addDaysUtc,
  dateOnlyInOslo,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import {
  enumerateWorkDays,
  MAX_WORK_ORDER_DAYS,
} from "@/lib/work-days";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { isClosedStatus } from "@/lib/work-order-status";
import {
  canTransitionVisit,
  isTerminalVisitStatus,
} from "@/lib/visit-status";
import { revokeTrackingLinksForVisit } from "./tracking";
import {
  can,
  fail,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceFailure,
  type ServiceResult,
} from "./actor";
import { markResponded, markResolved } from "./sla";
import { recomputeWorkOrderSchedule } from "@/lib/work-order-schedule";

export { recomputeWorkOrderSchedule };

/** Millisekunder i et døgn. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Øvre grense for én visitt. Lange serviceoppdrag deles i flere visiter. */
export const MAX_VISIT_DURATION_MS = 31 * DAY_MS;

/**
 * Tjenestelaget for planlagte visiter.
 *
 * En visitt er en tidsblokk i et oppdrag. Oppdragets `scheduledFor`/
 * `scheduledTo` er avledet fra visittene, slik at kalenderen og de eldre
 * listene fortsatt ser samme periode. Alle mutasjoner kontrollerer aktøren,
 * avdelingen, bevaringsplikt og låst oppdrag på nytt – også når kallet kommer
 * direkte fra en rute.
 *
 * Revisjonsloggen skrives i samme transaksjon som endringen. En visitt som
 * flyttes eller tildeles kan derfor ikke ende uten spor.
 */

export type CreateVisitInput = {
  workOrderId: string;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  technicianIds?: string[];
  notes?: string | null;
  sequence?: number;
};

export type UpdateVisitInput = {
  notes?: string | null;
  sequence?: number;
  allDay?: boolean;
};

export type MoveVisitInput = {
  startsAt: Date;
  endsAt: Date;
};

export type CreateDefaultVisitInput = {
  workOrderId: string;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  technicianIds?: string[];
  status?: VisitStatus;
};

export type VisitTechnicianSummary = {
  visitId: string;
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
};

export type VisitWithTechnicians = Visit & {
  technicians: VisitTechnicianSummary[];
};

export type VisitOverlapConflict = {
  visitId: string;
  workOrderId: string;
  startsAt: string;
  endsAt: string;
  technicianIds: string[];
};

export type VisitTimeRange = {
  startsAt: Date;
  endsAt: Date;
};

/**
 * Halvåpent overlapp: `[startsAt, endsAt)`. Visiter som møtes nøyaktig ved
 * midnatt eller ved skiftstart er ikke i konflikt.
 */
export function visitRangesOverlap(
  first: VisitTimeRange,
  second: VisitTimeRange,
): boolean {
  return (
    first.startsAt.getTime() < second.endsAt.getTime() &&
    first.endsAt.getTime() > second.startsAt.getTime()
  );
}

const visitWithTechniciansInclude = {
  technicians: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.VisitInclude;

const visitContextSelect = {
  id: true,
  workOrderId: true,
  sequence: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  status: true,
  notes: true,
  enRouteAt: true,
  onSiteAt: true,
  doneAt: true,
  travelFromEndedAt: true,
  technicians: {
    select: {
      userId: true,
      user: { select: { name: true } },
    },
  },
  workOrder: {
    select: {
      id: true,
      title: true,
      departmentId: true,
      status: true,
      legalHold: true,
    },
  },
} satisfies Prisma.VisitSelect;

type VisitContext = Prisma.VisitGetPayload<{
  select: typeof visitContextSelect;
}>;

const workOrderContextSelect = {
  id: true,
  title: true,
  departmentId: true,
  status: true,
  legalHold: true,
} satisfies Prisma.WorkOrderSelect;

type WorkOrderContext = Prisma.WorkOrderGetPayload<{
  select: typeof workOrderContextSelect;
}>;

/** Feilårsakene UI-et kan oversette fra `details.code`. */
export const VISIT_ERROR_CODES = {
  overlap: "visits.errors.overlap",
  invalidTimeRange: "visits.errors.invalidTimeRange",
  durationTooLong: "visits.errors.durationTooLong",
  invalidTechnician: "visits.errors.invalidTechnician",
  invalidInput: "visits.errors.invalidInput",
  legalHold: "visits.errors.legalHold",
  workOrderLocked: "visits.errors.workOrderLocked",
  visitLocked: "visits.errors.visitLocked",
  statusTransition: "visits.errors.statusTransition",
  noChange: "visits.errors.noChange",
  invalidSequence: "visits.errors.invalidSequence",
  invalidDateRange: "visits.errors.invalidDateRange",
  visitInProgress: "visits.errors.visitInProgress",
  loggedDayConflict: "visits.errors.loggedDayConflict",
  pastDayConflict: "visits.errors.pastDayConflict",
  travelFromNotAvailable: "visits.errors.travelFromNotAvailable",
} as const;

/**
 * Konflikt når en datoperiode ikke kan avstemmes uten å fjerne en dag som
 * allerede er startet, fullført eller har tidsregistrering. `detail` er en
 * stabil i18n-nøkkel som API/UI kan oversette.
 */
export class DailyVisitConflictError extends Error {
  readonly detail: string;
  readonly date: string | null;

  constructor(detail: string, date: string | null = null) {
    super(detail);
    this.name = "DailyVisitConflictError";
    this.detail = detail;
    this.date = date;
  }
}

export type DailyVisitRangeInput = {
  workOrderId: string;
  /** Første arbeidsdag. Tom betyr at oppdraget ikke har datoperiode. */
  scheduledFor: Date | null;
  /** Siste arbeidsdag, inklusiv. Tom betyr éndagsoppdrag. */
  scheduledTo?: Date | null;
  technicianIds?: string[];
  /** Injiseres i tester; ellers brukes dagens dato i Europe/Oslo. */
  now?: Date;
};

export type DailyVisitReconcileResult = {
  created: number;
  removed: number;
  preserved: number;
  /** Kalenderdatoene oppdraget skal ha etter avstemmingen. */
  dates: string[];
};

type DailyVisitRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: VisitStatus;
  sequence: number;
  enRouteAt: Date | null;
  onSiteAt: Date | null;
  doneAt: Date | null;
};

const dailyVisitSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  status: true,
  sequence: true,
  enRouteAt: true,
  onSiteAt: true,
  doneAt: true,
} satisfies Prisma.VisitSelect;

function hasTimeLog(visit: Pick<DailyVisitRow, "enRouteAt" | "onSiteAt" | "doneAt">): boolean {
  return Boolean(visit.enRouteAt || visit.onSiteAt || visit.doneAt);
}

/**
 * Én arbeidsdag kan bare fjernes automatisk når den fortsatt er ren plan.
 * Pågående og loggede dager er historikk og skal aldri forsvinne stille.
 */
function removalConflict(
  visit: DailyVisitRow,
  today: string,
): DailyVisitConflictError | null {
  const date = dateOnlyInOslo(visit.startsAt);
  if (visit.status === "EN_ROUTE" || visit.status === "ON_SITE") {
    return new DailyVisitConflictError(VISIT_ERROR_CODES.visitInProgress, date);
  }
  if (visit.status === "DONE" || hasTimeLog(visit)) {
    return new DailyVisitConflictError(VISIT_ERROR_CODES.loggedDayConflict, date);
  }
  if (!["PLANNED", "ASSIGNED", "CANCELLED"].includes(visit.status)) {
    return new DailyVisitConflictError(VISIT_ERROR_CODES.loggedDayConflict, date);
  }
  // Bare planlagte dager fram i tid kan fjernes. En gammel plannedag uten
  // tidsregistrering er fortsatt historikk og krever bevisst opprydding.
  if (date < today) {
    return new DailyVisitConflictError(VISIT_ERROR_CODES.pastDayConflict, date);
  }
  return null;
}

function requirePermission(
  actor: ServiceActor,
  permission: "workorders.view" | "workorders.edit" | "workorders.assign" | "workorders.update",
): ServiceFailure | null {
  if (!actor?.isActive || !can(actor, permission)) return fail("forbidden");
  return null;
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

function cleanTechnicianIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map(cleanId).filter((value) => value.length > 0)),
  );
}

function periodFailure(startsAt: Date, endsAt: Date): ServiceFailure | null {
  if (
    !(startsAt instanceof Date) ||
    !(endsAt instanceof Date) ||
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt.getTime() <= startsAt.getTime()
  ) {
    return fail("invalid", { code: VISIT_ERROR_CODES.invalidTimeRange });
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_VISIT_DURATION_MS) {
    return fail("invalid", { code: VISIT_ERROR_CODES.durationTooLong });
  }
  return null;
}

function workOrderBlocked(
  workOrder: Pick<WorkOrderContext, "status" | "legalHold">,
): ServiceFailure | null {
  if (workOrder.legalHold) {
    return fail("conflict", { code: VISIT_ERROR_CODES.legalHold });
  }
  if (isClosedStatus(workOrder.status as WorkStatus)) {
    return fail("conflict", { code: VISIT_ERROR_CODES.workOrderLocked });
  }
  return null;
}

function visitBlocked(
  visit: VisitContext,
  options: { allowTerminal?: boolean } = {},
): ServiceFailure | null {
  const blocked = workOrderBlocked(visit.workOrder);
  if (blocked) return blocked;
  if (!options.allowTerminal && isTerminalVisitStatus(visit.status)) {
    return fail("conflict", { code: VISIT_ERROR_CODES.visitLocked });
  }
  return null;
}

async function findVisitContext(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  visitId: string,
): Promise<VisitContext | null> {
  return tx.visit.findFirst({
    where: {
      id: visitId,
      workOrder: { AND: [workOrderScopeFor(actor)] },
    },
    select: visitContextSelect,
  });
}

async function findWorkOrderContext(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  workOrderId: string,
): Promise<WorkOrderContext | null> {
  return tx.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScopeFor(actor) },
    select: workOrderContextSelect,
  });
}

type TechnicianLookup =
  | { users: Array<{ id: string; name: string | null }>; failure?: never }
  | { users?: never; failure: ServiceFailure };

async function validTechnicians(
  tx: Prisma.TransactionClient,
  departmentId: string,
  technicianIds: string[],
): Promise<TechnicianLookup> {
  if (technicianIds.length === 0) return { users: [] };

  const users = await tx.user.findMany({
    where: {
      id: { in: technicianIds },
      ...staffForDepartment(departmentId),
    },
    select: { id: true, name: true },
    take: 100,
  });

  const found = new Set(users.map((user) => user.id));
  const missing = technicianIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return {
      failure: fail("invalid", {
        code: VISIT_ERROR_CODES.invalidTechnician,
        technicianIds: missing,
      }),
    };
  }
  return { users };
}

const osloTimeFormatter = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Kort, lesbart tidsrom for revisjonsloggen (norsk tid). */
function visitRangeLabel(startsAt: Date, endsAt: Date): string {
  const startDate = dateOnlyInOslo(startsAt);
  const endDate = dateOnlyInOslo(endsAt);
  const startTime = osloTimeFormatter.format(startsAt);
  const endTime = osloTimeFormatter.format(endsAt);
  return startDate === endDate
    ? `${startDate} ${startTime}–${endTime}`
    : `${startDate} ${startTime} – ${endDate} ${endTime}`;
}

function technicianNames(
  technicians: Array<{ userId: string; user: { name: string | null } }>,
): string {
  return (
    technicians
      .map((technician) => technician.user.name)
      .filter((name): name is string => Boolean(name))
      .join(", ") || "montør"
  );
}

/**
 * Oppretter en visitt på et oppdrag.
 *
 * Krever `workorders.edit`. Montørene må være aktive ansatte i oppdragets
 * avdeling. Overlappende visiter er tillatt; de viser at montøren er opptatt,
 * ikke at vedkommende er utilgjengelig. Oppdragets avledede datoperiode
 * oppdateres i samme transaksjon.
 */
export async function createVisit(
  actor: ServiceActor,
  input: CreateVisitInput,
): Promise<ServiceResult<Visit>> {
  const denied = requirePermission(actor, "workorders.edit");
  if (denied) return denied;

  const workOrderId = cleanId(input?.workOrderId);
  if (!workOrderId) {
    return fail("invalid", { code: VISIT_ERROR_CODES.invalidInput });
  }

  const startsAt = input?.startsAt;
  const endsAt = input?.endsAt;
  const invalidPeriod = periodFailure(startsAt, endsAt);
  if (invalidPeriod) return invalidPeriod;

  const sequence = input.sequence ?? 0;
  if (!Number.isInteger(sequence) || sequence < 0) {
    return fail("invalid", { code: VISIT_ERROR_CODES.invalidSequence });
  }

  const technicianIds = cleanTechnicianIds(input.technicianIds);
  const notes =
    cleanText(input.notes, { maxLength: LIMITS.text, multiline: true }) || null;
  const allDay = input.allDay === true;

  return prisma.$transaction(async (tx) => {
    const workOrder = await findWorkOrderContext(tx, actor, workOrderId);
    if (!workOrder) return fail("not_found");

    const blocked = workOrderBlocked(workOrder);
    if (blocked) return blocked;

    const lookup = await validTechnicians(
      tx,
      workOrder.departmentId,
      technicianIds,
    );
    if (lookup.failure) return lookup.failure;

    const visit = await tx.visit.create({
      data: {
        workOrderId,
        sequence,
        startsAt,
        endsAt,
        allDay,
        status: "PLANNED",
        notes,
        technicians: {
          create: technicianIds.map((userId) => ({ userId })),
        },
      },
    });

    await audit(tx, {
      entityType: "Visit",
      entityId: visit.id,
      action: `Opprettet visitt: ${workOrder.title} (${visitRangeLabel(startsAt, endsAt)})`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId,
        workOrderTitle: workOrder.title,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        allDay,
        sequence,
        technicianIds,
      },
    });

    await recomputeWorkOrderSchedule(tx, workOrderId);
    return ok(visit);
  });
}

/**
 * Oppdaterer visittens metadata (notat, rekkefølge og heldagsflagg).
 * Tidsrommet flyttes med `moveVisit`, slik at overlap-kontrollen alltid kjøres.
 */
export async function updateVisit(
  actor: ServiceActor,
  visitId: string,
  input: UpdateVisitInput,
): Promise<ServiceResult<Visit>> {
  const denied = requirePermission(actor, "workorders.edit");
  if (denied) return denied;

  const id = cleanId(visitId);
  if (!id) return fail("invalid", { code: VISIT_ERROR_CODES.invalidInput });

  if (
    input.sequence !== undefined &&
    (!Number.isInteger(input.sequence) || input.sequence < 0)
  ) {
    return fail("invalid", { code: VISIT_ERROR_CODES.invalidSequence });
  }
  if (
    input.notes === undefined &&
    input.sequence === undefined &&
    input.allDay === undefined
  ) {
    return fail("invalid", { code: VISIT_ERROR_CODES.noChange });
  }

  return prisma.$transaction(async (tx) => {
    const current = await findVisitContext(tx, actor, id);
    if (!current) return fail("not_found");

    const blocked = visitBlocked(current);
    if (blocked) return blocked;

    const data: Prisma.VisitUpdateInput = {};
    const changes: Record<
      string,
      {
        from: string | number | boolean | null;
        to: string | number | boolean | null;
      }
    > = {};

    if (input.notes !== undefined) {
      const notes =
        cleanText(input.notes, { maxLength: LIMITS.text, multiline: true }) ||
        null;
      data.notes = notes;
      changes.notes = { from: current.notes, to: notes };
    }
    if (input.sequence !== undefined) {
      data.sequence = input.sequence;
      changes.sequence = { from: current.sequence, to: input.sequence };
    }
    if (input.allDay !== undefined) {
      data.allDay = input.allDay;
      changes.allDay = { from: current.allDay, to: input.allDay };
    }

    const visit = await tx.visit.update({ where: { id }, data });

    await audit(tx, {
      entityType: "Visit",
      entityId: id,
      action: `Oppdaterte visitten: ${current.workOrder.title} (${visitRangeLabel(
        current.startsAt,
        current.endsAt,
      )})`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: current.workOrderId,
        workOrderTitle: current.workOrder.title,
        changes,
      },
    });

    return ok(visit);
  });
}

/**
 * Flytter visitten i tid. Krever `workorders.assign` fordi flytting er en
 * planleggingshandling. Overlapp er tillatt og stopper ikke flyttingen.
 */
export async function moveVisit(
  actor: ServiceActor,
  visitId: string,
  input: MoveVisitInput,
): Promise<ServiceResult<Visit>> {
  const denied = requirePermission(actor, "workorders.assign");
  if (denied) return denied;

  const id = cleanId(visitId);
  if (!id) return fail("invalid", { code: VISIT_ERROR_CODES.invalidInput });

  const startsAt = input?.startsAt;
  const endsAt = input?.endsAt;
  const invalidPeriod = periodFailure(startsAt, endsAt);
  if (invalidPeriod) return invalidPeriod;

  return prisma.$transaction(async (tx) => {
    const current = await findVisitContext(tx, actor, id);
    if (!current) return fail("not_found");

    const blocked = visitBlocked(current);
    if (blocked) return blocked;

    const technicianIds = current.technicians.map(
      (technician) => technician.userId,
    );
    const visit = await tx.visit.update({
      where: { id },
      data: { startsAt, endsAt },
    });

    await audit(tx, {
      entityType: "Visit",
      entityId: id,
      action: `Flyttet visitt: ${current.workOrder.title} (${visitRangeLabel(
        startsAt,
        endsAt,
      )})`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: current.workOrderId,
        workOrderTitle: current.workOrder.title,
        from: {
          startsAt: current.startsAt.toISOString(),
          endsAt: current.endsAt.toISOString(),
        },
        to: {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        technicianIds,
      },
    });

    await recomputeWorkOrderSchedule(tx, current.workOrderId);
    return ok(visit);
  });
}

/**
 * Erstatter montørlisten på visitten. Alle id-ene må være aktive ansatte i
 * oppdragets avdeling. Overlappende visiter er tillatt.
 */
export async function assignVisit(
  actor: ServiceActor,
  visitId: string,
  userIds: string[],
): Promise<ServiceResult<Visit>> {
  const denied = requirePermission(actor, "workorders.assign");
  if (denied) return denied;

  const id = cleanId(visitId);
  const technicianIds = cleanTechnicianIds(userIds);
  if (!id || technicianIds.length === 0) {
    return fail("invalid", { code: VISIT_ERROR_CODES.noChange });
  }

  return prisma.$transaction((tx) =>
    assignVisitInTransaction(tx, actor, id, technicianIds),
  );
}

/**
 * Transaksjonsbevisst tildeling. Dispatch bruker denne når flere visiter skal
 * tildeles i én transaksjon; da kan den ikke kalle `assignVisit`, som åpner en
 * ny transaksjon. Funksjonen kontrollerer fortsatt avdeling og revisjonslogg,
 * men lar kalleren eie transaksjonen og rettighetsvakten. Overlapp er tillatt.
 *
 * `scoreSnapshot` legges på revisjonsraden, slik at en automatisk tildeling
 * alltid kan forklares i ettertid.
 */
export async function assignVisitInTransaction(
  tx: Prisma.TransactionClient,
  actor: ServiceActor,
  visitId: string,
  userIds: string[],
  options: {
    scoreSnapshot?: Prisma.InputJsonValue;
    /**
     * Dispatch tildeler en hel arbeidsdag. Standard er å speile montørlisten
     * til de øvrige rene, planlagte dagene i samme oppdrag, slik at en
     * tildeling i én kolonne ikke stille etterlater søskendager uten montør.
     * Automatisk dispatch slår dette av fordi den planlegger hver dag for seg.
     */
    syncSiblings?: boolean;
  } = {},
): Promise<ServiceResult<Visit>> {
  const id = cleanId(visitId);
  const technicianIds = cleanTechnicianIds(userIds);
  if (!id || technicianIds.length === 0) {
    return fail("invalid", { code: VISIT_ERROR_CODES.noChange });
  }

  const current = await findVisitContext(tx, actor, id);
  if (!current) return fail("not_found");

  const blocked = visitBlocked(current);
  if (blocked) return blocked;

  const lookup = await validTechnicians(
    tx,
    current.workOrder.departmentId,
    technicianIds,
  );
  if (lookup.failure) return lookup.failure;

  const previousIds = current.technicians.map(
    (technician) => technician.userId,
  );
  const visit = await tx.visit.update({
    where: { id },
    data: {
      technicians: {
        deleteMany: {},
        create: technicianIds.map((userId) => ({ userId })),
      },
    },
  });

  let siblingVisitIds: string[] = [];
  if (options.syncSiblings !== false) {
    const siblings = await tx.visit.findMany({
      where: {
        workOrderId: current.workOrderId,
        id: { not: id },
        status: { in: ["PLANNED", "ASSIGNED"] },
      },
      select: { id: true },
    });
    siblingVisitIds = siblings.map((sibling) => sibling.id);

    if (siblingVisitIds.length > 0) {
      await tx.visitTechnician.deleteMany({
        where: { visitId: { in: siblingVisitIds } },
      });
      await tx.visitTechnician.createMany({
        data: siblingVisitIds.flatMap((visitId) =>
          technicianIds.map((userId) => ({ visitId, userId })),
        ),
        skipDuplicates: true,
      });
    }
  }

  await audit(tx, {
    entityType: "Visit",
    entityId: id,
    action: `Tildelte montør: ${technicianNames(
      lookup.users.map((user) => ({
        userId: user.id,
        user: { name: user.name },
      })),
    )}`,
    actor: toAuditActor(actor),
    metadata: {
      workOrderId: current.workOrderId,
      workOrderTitle: current.workOrder.title,
      technicianIds: { from: previousIds, to: technicianIds },
      ...(siblingVisitIds.length > 0
        ? { siblingVisitIds }
        : {}),
      ...(options.scoreSnapshot === undefined
        ? {}
        : { dispatch: options.scoreSnapshot }),
    },
  });

  return ok(visit);
}

/**
 * Fjerner én montør fra visitten. Uten `userId` fjernes alle montørene.
 * Den valgfrie id-en gjør målrettet fjerning mulig uten å lese listen først.
 */
export async function unassignVisit(
  actor: ServiceActor,
  visitId: string,
  userId?: string,
): Promise<ServiceResult<Visit>> {
  const denied = requirePermission(actor, "workorders.assign");
  if (denied) return denied;

  const id = cleanId(visitId);
  const targetUserId = userId === undefined ? null : cleanId(userId);
  if (!id || (userId !== undefined && !targetUserId)) {
    return fail("invalid", { code: VISIT_ERROR_CODES.noChange });
  }

  return prisma.$transaction(async (tx) => {
    const current = await findVisitContext(tx, actor, id);
    if (!current) return fail("not_found");

    const blocked = visitBlocked(current);
    if (blocked) return blocked;

    const currentIds = new Set(
      current.technicians.map((technician) => technician.userId),
    );
    const removedIds = targetUserId
      ? currentIds.has(targetUserId)
        ? [targetUserId]
        : []
      : [...currentIds];

    if (removedIds.length === 0) {
      return fail("invalid", { code: VISIT_ERROR_CODES.noChange });
    }

    const removedTechnicians = current.technicians.filter((technician) =>
      removedIds.includes(technician.userId),
    );

    const visit = await tx.visit.update({
      where: { id },
      data: {
        technicians: { deleteMany: { userId: { in: removedIds } } },
      },
    });

    // Samme regel som ved tildeling: fjerningen gjelder hele oppdragets rene,
    // planlagte dager, ikke bare den ene dagen dispatch-kortet representerer.
    const siblings = await tx.visit.findMany({
      where: {
        workOrderId: current.workOrderId,
        id: { not: id },
        status: { in: ["PLANNED", "ASSIGNED"] },
      },
      select: { id: true },
    });
    const siblingVisitIds = siblings.map((sibling) => sibling.id);
    if (siblingVisitIds.length > 0) {
      await tx.visitTechnician.deleteMany({
        where: {
          visitId: { in: siblingVisitIds },
          userId: { in: removedIds },
        },
      });
    }

    await audit(tx, {
      entityType: "Visit",
      entityId: id,
      action: `Fjernet montør: ${technicianNames(removedTechnicians)}`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: current.workOrderId,
        workOrderTitle: current.workOrder.title,
        removedTechnicianIds: removedIds,
        ...(siblingVisitIds.length > 0 ? { siblingVisitIds } : {}),
      },
    });

    return ok(visit);
  });
}

/**
 * Lukker returkjøringen på forrige fullførte visitt når montøren starter på
 * neste jobb. Samme tidssegment blir dermed returkjøring for den forrige
 * visitten og tilkjøring for den nye. Bare én åpen, fullført visitt per montør
 * lukkes, slik at gamle, glemte dager ikke blir skrevet over.
 */
async function closePreviousTravelFrom(
  tx: Prisma.TransactionClient,
  current: VisitContext,
  at: Date,
): Promise<string[]> {
  const technicianIds = current.technicians.map(
    (technician) => technician.userId,
  );
  if (technicianIds.length === 0) return [];

  // Bare samme arbeidsdag regnes som «neste jobb». En fullført jobb fra i går
  // skal ikke få nattens timer som returkjøring; den lukkes bevisst for seg.
  const dayStart = osloDayStart(dateOnlyInOslo(at));

  const candidates = await tx.visit.findMany({
    where: {
      id: { not: current.id },
      status: "DONE",
      travelFromEndedAt: null,
      doneAt: { not: null, gte: dayStart, lte: at },
      technicians: { some: { userId: { in: technicianIds } } },
    },
    orderBy: [{ doneAt: "desc" }],
    select: {
      id: true,
      technicians: { select: { userId: true } },
    },
    take: 100,
  });

  const covered = new Set<string>();
  const closed: string[] = [];
  for (const candidate of candidates) {
    const overlap = candidate.technicians
      .map((technician) => technician.userId)
      .filter(
        (userId) => technicianIds.includes(userId) && !covered.has(userId),
      );
    if (overlap.length === 0) continue;

    await tx.visit.update({
      where: { id: candidate.id },
      data: { travelFromEndedAt: at },
    });
    closed.push(candidate.id);
    for (const userId of overlap) covered.add(userId);
    if (covered.size === technicianIds.length) break;
  }
  return closed;
}

/** Bytter visittens status etter den felles tilstandsmaskinen. */
export async function setVisitStatus(
  actor: ServiceActor,
  visitId: string,
  status: VisitStatus,
): Promise<ServiceResult<Visit>> {
  const denied = requirePermission(actor, "workorders.update");
  if (denied) return denied;

  const id = cleanId(visitId);
  const statuses = Object.values(VisitStatus) as string[];
  if (!id || typeof status !== "string" || !statuses.includes(status)) {
    return fail("invalid", {
      code: VISIT_ERROR_CODES.statusTransition,
      to: status,
    });
  }

  return prisma.$transaction(async (tx) => {
    const current = await findVisitContext(tx, actor, id);
    if (!current) return fail("not_found");

    const blocked = visitBlocked(current);
    if (blocked) return blocked;

    if (!canTransitionVisit(current.status, status)) {
      return fail("invalid", {
        code: VISIT_ERROR_CODES.statusTransition,
        from: current.status,
        to: status,
      });
    }

    const at = new Date();
    // Når montøren reiser til en ny jobb, er samme segment returkjøring for
    // den forrige fullførte jobben. Dette skjer i samme transaksjon som
    // statusovergangen.
    const closedTravelFromVisitIds =
      status === "EN_ROUTE"
        ? await closePreviousTravelFrom(tx, current, at)
        : [];

    const visit = await tx.visit.update({
      where: { id },
      data: {
        status,
        // Statustidspunktene settes i samme UPDATE som statusen. Det gjør
        // rapportering og ETA entydig, uavhengig av senere notatendringer.
        // Første gang vinner: en gjentatt/parallell overgang kan aldri flytte
        // et allerede registrert tidspunkt.
        ...(status === "EN_ROUTE" && !current.enRouteAt
          ? { enRouteAt: at }
          : {}),
        ...(status === "ON_SITE" && !current.onSiteAt ? { onSiteAt: at } : {}),
        ...(status === "DONE" && !current.doneAt ? { doneAt: at } : {}),
      },
    });

    // Når visitten er avsluttet, skal en offentlig sporingslenke slutte å
    // svare umiddelbart. Posisjonspingene slettes samtidig – de har ingen
    // verdi etter at kunden ikke lenger kan se sporingen.
    if (status === "DONE" || status === "CANCELLED") {
      await revokeTrackingLinksForVisit(tx, id);
      await tx.visitLocationPing.deleteMany({ where: { visitId: id } });
    }

    // SLA: første EN_ROUTE/ON_SITE er responsen, og DONE er løsningen.
    // Returkjøring er etterspill og gjenåpner aldri klokken.
    if (status === "EN_ROUTE" || status === "ON_SITE") {
      await markResponded(tx, current.workOrderId);
    } else if (status === "DONE") {
      await markResolved(tx, current.workOrderId);
    }

    await audit(tx, {
      entityType: "Visit",
      entityId: id,
      action: `Endret visittstatus: ${current.status} → ${status}`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: current.workOrderId,
        workOrderTitle: current.workOrder.title,
        from: current.status,
        to: status,
        ...(closedTravelFromVisitIds.length > 0
          ? { closedTravelFromVisitIds }
          : {}),
      },
    });

    // En kansellert visitt skal ikke lenger holde oppdragets datoperiode åpen.
    await recomputeWorkOrderSchedule(tx, current.workOrderId);
    return ok(visit);
  });
}

/**
 * Avslutter retur-/viderekjøringen etter at arbeidet er fullført.
 *
 * Dette er en egen, sekundær handling etter DONE, slik at de tre primære
 * arbeidshandlingene (På vei / På stedet / Ferdig) forblir uendret. Når neste
 * jobb starter EN_ROUTE, lukkes samme segment automatisk; denne funksjonen
 * brukes for siste jobb på dagen. Idempotent: en allerede avsluttet kjøring
 * returneres uten å flytte tidspunktet.
 */
export async function finishTravelFrom(
  actor: ServiceActor,
  visitId: string,
): Promise<ServiceResult<Visit>> {
  const denied = requirePermission(actor, "workorders.update");
  if (denied) return denied;

  const id = cleanId(visitId);
  if (!id) return fail("invalid", { code: VISIT_ERROR_CODES.invalidInput });

  return prisma.$transaction(async (tx) => {
    const current = await findVisitContext(tx, actor, id);
    if (!current) return fail("not_found");
    if (current.workOrder.legalHold) {
      return fail("conflict", { code: VISIT_ERROR_CODES.legalHold });
    }
    if (current.status !== "DONE" || !current.doneAt) {
      return fail("invalid", {
        code: VISIT_ERROR_CODES.travelFromNotAvailable,
      });
    }
    if (current.travelFromEndedAt) {
      return ok(
        await tx.visit.findUniqueOrThrow({ where: { id } }),
      );
    }

    const at = new Date();
    const visit = await tx.visit.update({
      where: { id },
      data: { travelFromEndedAt: at },
    });

    await audit(tx, {
      entityType: "Visit",
      entityId: id,
      action: `Avsluttet kjøring: ${current.workOrder.title}`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: current.workOrderId,
        workOrderTitle: current.workOrder.title,
        travelFromEndedAt: at.toISOString(),
      },
    });

    return ok(visit);
  });
}

/**
 * Sletter visitten permanent. Selve oppdraget og dets historikk består.
 * Krever `workorders.edit`, og er sperret av bevaringsplikt/låst oppdrag.
 */
export async function deleteVisit(
  actor: ServiceActor,
  visitId: string,
): Promise<ServiceResult<undefined>> {
  const denied = requirePermission(actor, "workorders.edit");
  if (denied) return denied;

  const id = cleanId(visitId);
  if (!id) return fail("invalid", { code: VISIT_ERROR_CODES.invalidInput });

  return prisma.$transaction(async (tx) => {
    const current = await findVisitContext(tx, actor, id);
    if (!current) return fail("not_found");

    const blocked = visitBlocked(current, { allowTerminal: true });
    if (blocked) return blocked;

    await tx.visit.delete({ where: { id } });

    await audit(tx, {
      entityType: "Visit",
      entityId: id,
      action: `Slettet visitt: ${current.workOrder.title} (${visitRangeLabel(
        current.startsAt,
        current.endsAt,
      )})`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: current.workOrderId,
        workOrderTitle: current.workOrder.title,
        startsAt: current.startsAt.toISOString(),
        endsAt: current.endsAt.toISOString(),
        status: current.status,
        technicianIds: current.technicians.map(
          (technician) => technician.userId,
        ),
      },
    });

    await recomputeWorkOrderSchedule(tx, current.workOrderId);
    return ok(undefined);
  });
}

/** Alle visiter på et oppdrag, sortert på starttidspunkt. */
export async function listVisitsForWorkOrder(
  actor: ServiceActor,
  workOrderId: string,
): Promise<ServiceResult<VisitWithTechnicians[]>> {
  const denied = requirePermission(actor, "workorders.view");
  if (denied) return denied;

  const id = cleanId(workOrderId);
  if (!id) return fail("invalid", { code: VISIT_ERROR_CODES.invalidInput });

  const workOrder = await prisma.workOrder.findFirst({
    where: { id, ...workOrderScopeFor(actor) },
    select: { id: true },
  });
  if (!workOrder) return fail("not_found");

  const visits = await prisma.visit.findMany({
    where: {
      workOrderId: id,
      workOrder: { AND: [workOrderScopeFor(actor)] },
    },
    include: visitWithTechniciansInclude,
    orderBy: { startsAt: "asc" },
    take: 100,
  });

  return ok(visits);
}

/**
 * Visiter som berører tidsrommet `[from, to)`, for kalender og dispatch.
 * Intervallet er halvåpent, slik at en visitt som slutter ved midnatt ikke
 * dukker opp på neste dag.
 */
export async function listVisitsForDay(
  actor: ServiceActor,
  from: Date,
  to: Date,
): Promise<ServiceResult<VisitWithTechnicians[]>> {
  const denied = requirePermission(actor, "workorders.view");
  if (denied) return denied;

  if (
    !(from instanceof Date) ||
    !(to instanceof Date) ||
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to.getTime() <= from.getTime()
  ) {
    return fail("invalid", { code: VISIT_ERROR_CODES.invalidTimeRange });
  }

  const visits = await prisma.visit.findMany({
    where: {
      startsAt: { lt: to },
      endsAt: { gt: from },
      workOrder: { AND: [workOrderScopeFor(actor)] },
    },
    include: visitWithTechniciansInclude,
    orderBy: { startsAt: "asc" },
    take: 500,
  });

  return ok(visits);
}

function isUtcMidnight(value: Date): boolean {
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  );
}

/**
 * Heldagsvisiter kan komme fra kalenderen som rene UTC-midnatt-datoer
 * (eksklusiv sluttdato). Da tolkes de som kalenderdager og gjøres om til
 * Oslo-midnatt, slik at sommertidsovergangene ikke flytter dagen. Tidsstempler
 * som allerede har klokkeslett brukes uendret.
 */
function allDayPeriod(startsAt: Date, endsAt: Date): {
  startsAt: Date;
  endsAt: Date;
} {
  if (!isUtcMidnight(startsAt) || !isUtcMidnight(endsAt)) {
    return { startsAt, endsAt };
  }

  const startDay = dateOnlyInOslo(startsAt);
  const providedEndDay = dateOnlyInOslo(endsAt);
  // En sluttdato før startdatoen er ugyldig og skal avvises av periodesjekken.
  if (providedEndDay < startDay) return { startsAt, endsAt };

  // Samme dato betyr én heldagsvisitt med eksklusiv slutt ved neste midnatt.
  const endDay =
    providedEndDay === startDay
      ? toDateOnly(addDaysUtc(parseDateOnly(startDay)!, 1))
      : providedEndDay;

  return {
    startsAt: osloDayStart(startDay),
    endsAt: osloDayStart(endDay),
  };
}

function dailyRangeDays(input: DailyVisitRangeInput) {
  if (!input.scheduledFor) return [];
  const days = enumerateWorkDays(input.scheduledFor, input.scheduledTo ?? null);
  if (days.length > MAX_WORK_ORDER_DAYS) {
    throw new DailyVisitConflictError(VISIT_ERROR_CODES.invalidDateRange);
  }
  return days;
}

async function loadDailyVisits(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<DailyVisitRow[]> {
  return tx.visit.findMany({
    where: { workOrderId },
    select: dailyVisitSelect,
    orderBy: [{ startsAt: "asc" }, { sequence: "asc" }, { id: "asc" }],
  });
}

async function createDailyVisit(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  day: { sequence: number; startsAt: Date; endsAt: Date },
  technicianIds: string[],
): Promise<void> {
  await tx.visit.create({
    data: {
      workOrderId,
      sequence: day.sequence,
      startsAt: day.startsAt,
      endsAt: day.endsAt,
      allDay: true,
      status: "PLANNED",
      technicians: {
        create: technicianIds.map((userId) => ({ userId })),
      },
    },
    select: { id: true },
  });
}

/**
 * Sørger for at hver dato i oppdragets periode har nøyaktig én arbeidsøkt.
 *
 * Idempotent: eksisterende dager røres ikke, og en dag som allerede finnes
 * opprettes ikke på nytt. Brukes ved opprettelse og av import/backfill.
 */
export async function ensureDailyVisits(
  tx: Prisma.TransactionClient,
  input: DailyVisitRangeInput,
): Promise<DailyVisitReconcileResult> {
  const workOrderId = cleanId(input?.workOrderId);
  if (!workOrderId) throw new DailyVisitConflictError(VISIT_ERROR_CODES.invalidInput);

  const days = dailyRangeDays(input);
  const existing = await loadDailyVisits(tx, workOrderId);
  const existingDates = new Set(
    existing.map((visit) => dateOnlyInOslo(visit.startsAt)),
  );
  const technicianIds = cleanTechnicianIds(input.technicianIds);

  let created = 0;
  for (const day of days) {
    if (existingDates.has(day.date)) continue;
    await createDailyVisit(tx, workOrderId, day, technicianIds);
    existingDates.add(day.date);
    created += 1;
  }

  return {
    created,
    removed: 0,
    preserved: existing.length,
    dates: days.map((day) => day.date),
  };
}

/**
 * Avstemmer arbeidsøktene mot oppdragets datoperiode.
 *
 * - manglende dager legges til som rene, planlagte heldagsøkter,
 * - eksisterende dager beholdes uendret (de flyttes aldri),
 * - bare rene, planlagte dager fram i tid kan fjernes,
 * - en dag som er på vei, på stedet, fullført eller har tidsregistrering gir
 *   en tydelig konflikt i stedet for stille tap av historikk.
 *
 * Funksjonen er idempotent og kaller ikke `recomputeWorkOrderSchedule` selv;
 * den som eier transaksjonen oppdaterer de avledede datofeltene til slutt.
 */
export async function reconcileDailyVisits(
  tx: Prisma.TransactionClient,
  input: DailyVisitRangeInput,
): Promise<DailyVisitReconcileResult> {
  const workOrderId = cleanId(input?.workOrderId);
  if (!workOrderId) throw new DailyVisitConflictError(VISIT_ERROR_CODES.invalidInput);

  const days = dailyRangeDays(input);
  const targetDates = new Set(days.map((day) => day.date));
  const today = dateOnlyInOslo(input.now ?? new Date());
  const existing = await loadDailyVisits(tx, workOrderId);
  const technicianIds = cleanTechnicianIds(input.technicianIds);

  let removed = 0;
  const kept: DailyVisitRow[] = [];
  for (const visit of existing) {
    const date = dateOnlyInOslo(visit.startsAt);
    if (targetDates.has(date)) {
      kept.push(visit);
      continue;
    }
    const conflict = removalConflict(visit, today);
    if (conflict) throw conflict;
    await tx.visit.delete({ where: { id: visit.id } });
    removed += 1;
  }

  const keptDates = new Set(
    kept.map((visit) => dateOnlyInOslo(visit.startsAt)),
  );
  let created = 0;
  for (const day of days) {
    if (keptDates.has(day.date)) continue;
    await createDailyVisit(tx, workOrderId, day, technicianIds);
    created += 1;
  }

  return {
    created,
    removed,
    preserved: kept.length,
    dates: days.map((day) => day.date),
  };
}

/**
 * Oppretter en standardvisitt etter at oppdraget er skrevet.
 *
 * Kalles bare av oppdragstjenesten inne i samme transaksjon, og gjør derfor
 * ingen egen autorisasjonskontroll. En identisk heldagsvisitt opprettes ikke
 * på nytt, slik at en gjentatt integrering er idempotent. Datoperioden
 * oppdateres alltid til slutt.
 */
export async function createDefaultVisit(
  tx: Prisma.TransactionClient,
  input: CreateDefaultVisitInput,
): Promise<string> {
  const workOrderId = cleanId(input?.workOrderId);
  const inputStartsAt = input?.startsAt;
  const inputEndsAt = input?.endsAt;
  if (
    !workOrderId ||
    !(inputStartsAt instanceof Date) ||
    !(inputEndsAt instanceof Date) ||
    Number.isNaN(inputStartsAt.getTime()) ||
    Number.isNaN(inputEndsAt.getTime())
  ) {
    throw new Error("createDefaultVisit: ugyldig visitt");
  }

  const allDay = input.allDay !== false;
  const period = allDay
    ? allDayPeriod(inputStartsAt, inputEndsAt)
    : { startsAt: inputStartsAt, endsAt: inputEndsAt };
  if (periodFailure(period.startsAt, period.endsAt)) {
    throw new Error("createDefaultVisit: ugyldig visitt");
  }

  const startsAt = period.startsAt;
  const endsAt = period.endsAt;
  const technicianIds = cleanTechnicianIds(input.technicianIds);
  const status = input.status ?? "PLANNED";

  const existing = allDay
    ? await tx.visit.findFirst({
        where: {
          workOrderId,
          allDay: true,
          startsAt,
          endsAt,
        },
        select: { id: true },
      })
    : null;

  let visitId = existing?.id;
  if (!existing) {
    const created = await tx.visit.create({
      data: {
        workOrderId,
        sequence: 0,
        startsAt,
        endsAt,
        allDay,
        status,
        technicians: {
          create: technicianIds.map((userId) => ({ userId })),
        },
      },
      select: { id: true },
    });
    visitId = created.id;
  }

  await recomputeWorkOrderSchedule(tx, workOrderId);
  if (!visitId) throw new Error("createDefaultVisit: visitten ble ikke lagret");
  return visitId;
}

/**
 * `recomputeWorkOrderSchedule` eksporteres øverst i filen; implementasjonen
 * ligger i `@/lib/work-order-schedule`.
 */
