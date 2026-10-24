import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import type { Permission } from "@/lib/permissions";
import {
  timeEntryIdSchema,
  timeEntrySchema,
  timeEntryUpdateSchema,
} from "@/lib/schemas/time";
import {
  can,
  fail,
  isOfficeActor,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

const ENTRY_SELECT = {
  id: true,
  workOrderId: true,
  userId: true,
  startedAt: true,
  endedAt: true,
  minutes: true,
  description: true,
  billable: true,
  hourlyRate: true,
  createdAt: true,
  updatedAt: true,
} as const;

const MAX_ENTRY_MINUTES = 24 * 60;

type PricedWorkOrder = {
  id: string;
  departmentId: string;
  customerId: string | null;
  status: string;
  contract: { hourlyRate: unknown } | null;
  customer: { hourlyRate: unknown } | null;
};

async function requireWorkOrder(
  actor: ServiceActor,
  workOrderId: string,
  permission: Permission,
): Promise<PricedWorkOrder | null> {
  if (!actor.isActive || !can(actor, permission)) return null;
  return prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScopeFor(actor) },
    select: {
      id: true,
      departmentId: true,
      customerId: true,
      status: true,
      contract: { select: { hourlyRate: true } },
      customer: { select: { hourlyRate: true } },
    },
  });
}

/** Er verdien en unikhetskollisjon (P2002), f.eks. to samtidige start? */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function numericRate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const rate = Number(value);
  return Number.isFinite(rate) ? rate : null;
}

/** Standardpris når verken avtalen eller kunden har en timepris. */
function defaultHourlyRate(): number | null {
  const raw = process.env.DEFAULT_HOURLY_RATE;
  if (raw === undefined || raw.trim() === "") return null;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

/** Avtalens pris overstyrer kundens, som igjen overstyrer standardprisen. */
function resolveHourlyRate(workOrder: PricedWorkOrder): number | null {
  const contractRate = numericRate(workOrder.contract?.hourlyRate);
  if (contractRate !== null) return contractRate;
  const customerRate = numericRate(workOrder.customer?.hourlyRate);
  if (customerRate !== null) return customerRate;
  return defaultHourlyRate();
}

function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function invalidDuration(minutes: number): boolean {
  return !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_ENTRY_MINUTES;
}

/**
 * Har brukeren allerede en registrering som overlapper [startedAt, endedAt)?
 * Et åpent tidsintervall regnes som uendelig, og en åpen eksisterende
 * registrering overlapper alltid.
 */
async function hasOverlap(
  userId: string,
  startedAt: Date,
  endedAt: Date | null | undefined,
  excludeId?: string,
): Promise<boolean> {
  const other = await prisma.timeEntry.findFirst({
    where: {
      userId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(endedAt ? { startedAt: { lt: endedAt } } : {}),
      OR: [
        { endedAt: null },
        ...(endedAt ? [{ endedAt: { gt: startedAt } }] : []),
      ],
    },
    select: { id: true },
  });
  return Boolean(other);
}

function idFrom(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

function canSeeRate(actor: ServiceActor, entryUserId: string): boolean {
  return isOfficeActor(actor) || entryUserId === actor.id;
}

export async function listTimeEntries(
  actor: ServiceActor,
  workOrderId: unknown,
): Promise<ServiceResult<unknown[]>> {
  const id = idFrom(workOrderId);
  if (!id) return fail("invalid");
  if (!(await requireWorkOrder(actor, id, "workorders.view"))) {
    return fail("forbidden");
  }

  const entries = await prisma.timeEntry.findMany({
    where: { workOrderId: id },
    orderBy: { startedAt: "desc" },
    take: 200,
    select: ENTRY_SELECT,
  });

  return ok(
    entries.map((entry) =>
      canSeeRate(actor, entry.userId) ? entry : { ...entry, hourlyRate: null },
    ),
  );
}

/** Starter en timer. Én aktiv timer per bruker, uavhengig av oppdrag. */
export async function startTimer(
  actor: ServiceActor,
  input: { workOrderId?: unknown; description?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  const workOrderId = idFrom(input.workOrderId);
  if (!workOrderId) return fail("invalid");
  const workOrder = await requireWorkOrder(
    actor,
    workOrderId,
    "workorders.update",
  );
  if (!workOrder) return fail("forbidden");
  if (["COMPLETED", "CANCELLED"].includes(workOrder.status)) return fail("forbidden");

  const active = await prisma.timeEntry.findFirst({
    where: { userId: actor.id, endedAt: null },
    select: { id: true },
  });
  if (active) return fail("conflict");

  const description =
    typeof input.description === "string"
      ? input.description.trim().slice(0, 2000) || null
      : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.create({
        data: {
          workOrderId,
          userId: actor.id,
          startedAt: new Date(),
          description,
          billable: true,
          hourlyRate: resolveHourlyRate(workOrder),
          activeKey: actor.id,
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "TimeEntry",
        entityId: entry.id,
        action: "Startet timer",
        actor: toAuditActor(actor),
        metadata: { workOrderId },
      });
      return entry;
    });

    return ok({ id: created.id });
  } catch (error) {
    // To samtidige starter kolliderer på den unike activeKey-verdien.
    if (isUniqueViolation(error)) return fail("conflict");
    throw error;
  }
}

export async function stopTimer(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult<{ minutes: number }>> {
  const id = idFrom(input.id);
  if (!id) return fail("invalid");

  const entry = await prisma.timeEntry.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      workOrderId: true,
      startedAt: true,
      endedAt: true,
    },
  });
  if (!entry) return fail("not_found");
  if (entry.userId !== actor.id && !isOfficeActor(actor)) {
    return fail("forbidden");
  }
  if (entry.endedAt) return fail("conflict");

  const endedAt = new Date();
  const rawMinutes = minutesBetween(entry.startedAt, endedAt);
  if (rawMinutes < 0) return fail("invalid");
  const minutes = Math.min(rawMinutes, MAX_ENTRY_MINUTES);

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id },
      data: { endedAt, minutes, activeKey: null },
    });
    await audit(tx, {
      entityType: "TimeEntry",
      entityId: id,
      action: "Stoppet timer",
      actor: toAuditActor(actor),
      metadata: { workOrderId: entry.workOrderId, minutes },
    });
  });

  return ok({ minutes });
}

export async function addManualTime(
  actor: ServiceActor,
  input: Record<string, unknown>,
): Promise<ServiceResult<{ id: string; minutes: number }>> {
  const parsed = timeEntrySchema.safeParse(input);
  if (!parsed.success) return fail("invalid");

  const workOrder = await requireWorkOrder(
    actor,
    parsed.data.workOrderId,
    "workorders.update",
  );
  if (!workOrder) return fail("forbidden");
  if (["COMPLETED", "CANCELLED"].includes(workOrder.status)) return fail("forbidden");

  const endedAt = parsed.data.endedAt ?? null;
  const minutes = endedAt
    ? minutesBetween(parsed.data.startedAt, endedAt)
    : (parsed.data.minutes ?? 0);
  if (invalidDuration(minutes)) return fail("invalid");

  if (await hasOverlap(actor.id, parsed.data.startedAt, endedAt)) {
    return fail("conflict");
  }

  const resolvedRate = resolveHourlyRate(workOrder);
  const override =
    isOfficeActor(actor) && parsed.data.hourlyRate !== undefined && parsed.data.hourlyRate !== null
      ? parsed.data.hourlyRate
      : null;
  const hourlyRate = override ?? resolvedRate;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.create({
        data: {
          workOrderId: parsed.data.workOrderId,
          userId: actor.id,
          startedAt: parsed.data.startedAt,
          endedAt,
          minutes,
          description: parsed.data.description ?? null,
          billable: parsed.data.billable ?? true,
          hourlyRate,
          activeKey: endedAt ? null : actor.id,
        },
        select: { id: true },
      });

      await audit(tx, {
        entityType: "TimeEntry",
        entityId: entry.id,
        action: "Registrerte timer",
        actor: toAuditActor(actor),
        metadata: {
          workOrderId: parsed.data.workOrderId,
          minutes,
          ...(override !== null
            ? { hourlyRate: { before: resolvedRate, after: override } }
            : {}),
        },
      });
      return entry;
    });

    return ok({ id: created.id, minutes });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict");
    throw error;
  }
}

export async function updateTimeEntry(
  actor: ServiceActor,
  input: Record<string, unknown>,
): Promise<ServiceResult<{ minutes: number }>> {
  const parsed = timeEntryUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");

  const entry = await prisma.timeEntry.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      userId: true,
      workOrderId: true,
      startedAt: true,
      endedAt: true,
      minutes: true,
      hourlyRate: true,
    },
  });
  if (!entry) return fail("not_found");
  if (entry.userId !== actor.id && !isOfficeActor(actor)) {
    return fail("forbidden");
  }
  if (!(await requireWorkOrder(actor, entry.workOrderId, "workorders.update"))) {
    return fail("forbidden");
  }

  const startedAt = parsed.data.startedAt ?? entry.startedAt;
  const endedAt =
    parsed.data.endedAt !== undefined ? parsed.data.endedAt : entry.endedAt;
  const minutes = endedAt
    ? minutesBetween(startedAt, endedAt)
    : (parsed.data.minutes ?? entry.minutes ?? 0);
  if (invalidDuration(minutes)) return fail("invalid");

  if (await hasOverlap(entry.userId, startedAt, endedAt, entry.id)) {
    return fail("conflict");
  }

  // Bare kontoret kan endre timeprisen. Teknikere kan ikke overstyre den
  // verken ved opprettelse eller oppdatering.
  const rateOverride =
    isOfficeActor(actor) && parsed.data.hourlyRate !== undefined
      ? (parsed.data.hourlyRate ?? null)
      : undefined;
  const rateAudit =
    rateOverride !== undefined
      ? { before: numericRate(entry.hourlyRate), after: rateOverride }
      : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          ...(parsed.data.startedAt ? { startedAt: parsed.data.startedAt } : {}),
          ...(parsed.data.endedAt !== undefined
            ? { endedAt: parsed.data.endedAt ?? null }
            : {}),
          minutes,
          activeKey: endedAt ? null : entry.userId,
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description ?? null }
            : {}),
          ...(parsed.data.billable !== undefined
            ? { billable: parsed.data.billable }
            : {}),
          ...(rateOverride !== undefined ? { hourlyRate: rateOverride } : {}),
        },
      });
      await audit(tx, {
        entityType: "TimeEntry",
        entityId: entry.id,
        action: "Oppdaterte timer",
        actor: toAuditActor(actor),
        metadata: {
          workOrderId: entry.workOrderId,
          minutes,
          ...(rateAudit ? { hourlyRate: rateAudit } : {}),
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("conflict");
    throw error;
  }

  return ok({ minutes });
}

export async function deleteTimeEntry(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  const parsed = timeEntryIdSchema.safeParse({ id: idFrom(input.id) });
  if (!parsed.success) return fail("invalid");

  const entry = await prisma.timeEntry.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, userId: true, workOrderId: true },
  });
  if (!entry) return fail("not_found");
  if (entry.userId !== actor.id && !isOfficeActor(actor)) {
    return fail("forbidden");
  }
  const workOrder = await requireWorkOrder(
    actor,
    entry.workOrderId,
    "workorders.view",
  );
  if (!workOrder) return fail("forbidden");
  if (["COMPLETED", "CANCELLED"].includes(workOrder.status)) return fail("forbidden");

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.delete({ where: { id: entry.id } });
    await audit(tx, {
      entityType: "TimeEntry",
      entityId: entry.id,
      action: "Slettet timeregistrering",
      actor: toAuditActor(actor),
      metadata: { workOrderId: entry.workOrderId },
    });
  });

  return ok(undefined);
}

export async function getTimeTotals(
  actor: ServiceActor,
  workOrderId: unknown,
): Promise<ServiceResult<{ minutes: number; billableMinutes: number; amount: number }>> {
  const id = idFrom(workOrderId);
  if (!id) return fail("invalid");
  if (!(await requireWorkOrder(actor, id, "workorders.view"))) {
    return fail("forbidden");
  }

  const entries = await prisma.timeEntry.findMany({
    where: { workOrderId: id },
    select: { userId: true, minutes: true, billable: true, hourlyRate: true },
    take: 2000,
  });

  let minutes = 0;
  let billableMinutes = 0;
  let amount = 0;
  for (const entry of entries) {
    const entryMinutes = entry.minutes ?? 0;
    minutes += entryMinutes;
    if (entry.billable) {
      billableMinutes += entryMinutes;
      // Feltbrukere skal ikke kunne utlede andre brukeres timepris via summen.
      if (canSeeRate(actor, entry.userId)) {
        amount += (entryMinutes / 60) * Number(entry.hourlyRate ?? 0);
      }
    }
  }

  return ok({ minutes, billableMinutes, amount: Math.round(amount * 100) / 100 });
}
