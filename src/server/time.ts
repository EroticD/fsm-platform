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

async function requireWorkOrder(
  actor: ServiceActor,
  workOrderId: string,
  permission: Permission,
) {
  if (!actor.isActive || !can(actor, permission)) return null;
  return prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScopeFor(actor) },
    select: { id: true, departmentId: true, customerId: true },
  });
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function idFrom(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
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
  return ok(entries);
}

/** Starter en timer. Én aktiv timer per bruker, uavhengig av oppdrag. */
export async function startTimer(
  actor: ServiceActor,
  input: { workOrderId?: unknown; description?: unknown },
): Promise<ServiceResult<{ id: string }>> {
  const workOrderId = idFrom(input.workOrderId);
  if (!workOrderId) return fail("invalid");
  if (!(await requireWorkOrder(actor, workOrderId, "workorders.update"))) {
    return fail("forbidden");
  }

  const active = await prisma.timeEntry.findFirst({
    where: { userId: actor.id, endedAt: null },
    select: { id: true },
  });
  if (active) return fail("conflict");

  const description =
    typeof input.description === "string"
      ? input.description.trim().slice(0, 2000) || null
      : null;

  const created = await prisma.$transaction(async (tx) => {
    const entry = await tx.timeEntry.create({
      data: {
        workOrderId,
        userId: actor.id,
        startedAt: new Date(),
        description,
        billable: true,
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
  if (entry.userId !== actor.id && actor.role !== "ADMIN") {
    return fail("forbidden");
  }
  if (entry.endedAt) return fail("conflict");

  const endedAt = new Date();
  const minutes = minutesBetween(entry.startedAt, endedAt);

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id },
      data: { endedAt, minutes },
    });
    await audit(tx, {
      entityType: "TimeEntry",
      entityId: id,
      action: "Stoppet timer",
      actor: toAuditActor(actor),
      metadata: { workOrderId: entry.workOrderId },
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

  const minutes = parsed.data.endedAt
    ? minutesBetween(parsed.data.startedAt, parsed.data.endedAt)
    : parsed.data.minutes ?? 0;
  if (minutes <= 0) return fail("invalid");

  const created = await prisma.$transaction(async (tx) => {
    const entry = await tx.timeEntry.create({
      data: {
        workOrderId: parsed.data.workOrderId,
        userId: actor.id,
        startedAt: parsed.data.startedAt,
        endedAt: parsed.data.endedAt ?? null,
        minutes,
        description: parsed.data.description ?? null,
        billable: parsed.data.billable ?? true,
        hourlyRate: parsed.data.hourlyRate ?? null,
      },
      select: { id: true },
    });

    await audit(tx, {
      entityType: "TimeEntry",
      entityId: entry.id,
      action: "Registrerte timer",
      actor: toAuditActor(actor),
      metadata: { workOrderId: parsed.data.workOrderId, minutes },
    });
    return entry;
  });

  return ok({ id: created.id, minutes });
}

export async function updateTimeEntry(
  actor: ServiceActor,
  input: Record<string, unknown>,
): Promise<ServiceResult<{ minutes: number }>> {
  const parsed = timeEntryUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");

  const entry = await prisma.timeEntry.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, userId: true, workOrderId: true },
  });
  if (!entry) return fail("not_found");
  if (entry.userId !== actor.id && actor.role !== "ADMIN") {
    return fail("forbidden");
  }
  if (!(await requireWorkOrder(actor, entry.workOrderId, "workorders.update"))) {
    return fail("forbidden");
  }

  const minutes =
    parsed.data.endedAt && parsed.data.startedAt
      ? minutesBetween(parsed.data.startedAt, parsed.data.endedAt)
      : parsed.data.minutes;
  if (!minutes || minutes <= 0) return fail("invalid");

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        ...(parsed.data.startedAt ? { startedAt: parsed.data.startedAt } : {}),
        ...(parsed.data.endedAt !== undefined
          ? { endedAt: parsed.data.endedAt ?? null }
          : {}),
        minutes,
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description ?? null }
          : {}),
        ...(parsed.data.billable !== undefined
          ? { billable: parsed.data.billable }
          : {}),
        ...(parsed.data.hourlyRate !== undefined
          ? { hourlyRate: parsed.data.hourlyRate ?? null }
          : {}),
      },
    });
    await audit(tx, {
      entityType: "TimeEntry",
      entityId: entry.id,
      action: "Oppdaterte timer",
      actor: toAuditActor(actor),
      metadata: { workOrderId: entry.workOrderId, minutes },
    });
  });

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
  if (entry.userId !== actor.id && actor.role !== "ADMIN") {
    return fail("forbidden");
  }
  if (!(await requireWorkOrder(actor, entry.workOrderId, "workorders.view"))) {
    return fail("forbidden");
  }

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
    select: { minutes: true, billable: true, hourlyRate: true },
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
      amount += (entryMinutes / 60) * Number(entry.hourlyRate ?? 0);
    }
  }

  return ok({ minutes, billableMinutes, amount: Math.round(amount * 100) / 100 });
}
