// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger.
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { addDaysUtc, osloDayStart, parseDateOnly } from "@/lib/dates";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  can,
  fail,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

const MAX_SEQUENCE = 9999;

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

/**
 * Leser et rekkefølgenummer. Tomt eller 0 betyr «automatisk» og lagres som
 * null, slik at planleggeren kan optimalisere uten en manuell overstyring.
 */
export function parseRouteSequence(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return null;
  return Math.min(MAX_SEQUENCE, Math.round(numeric));
}

export type SetVisitRouteSequenceInput = {
  visitId: unknown;
  sequence: unknown;
};

/**
 * Setter manuell rute-rekkefølge på én visitt. Brukes fra oppdragssiden.
 *
 * Rekkefølgen er per montør og dag. Når den er satt, sorterer ruteplanleggeren
 * visittene etter dette nummeret i stedet for automatisk optimalisering.
 * Selve tidspunktene flyttes først når kontoret bruker rekkefølgen i
 * ruteplanleggeren.
 */
export async function setVisitRouteSequence(
  actor: ServiceActor | null | undefined,
  input: SetVisitRouteSequenceInput,
): Promise<ServiceResult<{ visitId: string; routeSequence: number | null }>> {
  if (
    !actor?.isActive ||
    (!can(actor, "workorders.update") && !can(actor, "workorders.assign"))
  ) {
    return fail("forbidden");
  }

  const visitId = cleanId(input.visitId);
  if (!visitId) return fail("invalid");
  const routeSequence = parseRouteSequence(input.sequence);

  const visit = await prisma.visit.findFirst({
    where: {
      id: visitId,
      workOrder: { AND: [workOrderScopeFor(actor)] },
    },
    select: {
      id: true,
      workOrderId: true,
      workOrder: { select: { title: true } },
    },
  });
  if (!visit) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.visit.update({
      where: { id: visit.id },
      data: { routeSequence },
    });
    await audit(tx, {
      entityType: "Visit",
      entityId: visit.id,
      action: `Satte manuell rute-rekkefølge: ${visit.workOrder.title}`,
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: visit.workOrderId,
        routeSequence,
      },
    });
  });

  return ok({ visitId: visit.id, routeSequence });
}

export type RouteSequenceItem = {
  visitId: unknown;
  sequence: unknown;
};

/**
 * Lagrer en hel manuell rekkefølge for én montør og dag. Alle visittene må
 * tilhøre samme dag, montør og avdeling. Nummereringen normaliseres ikke;
 * kontoret kan bevisst bruke 10, 20, 30 for å legge inn plass senere.
 */
export async function setRouteSequences(
  actor: ServiceActor | null | undefined,
  input: {
    date: unknown;
    technicianId: unknown;
    items: RouteSequenceItem[];
  },
): Promise<ServiceResult<{ updated: number }>> {
  if (
    !actor?.isActive ||
    (!can(actor, "workorders.update") && !can(actor, "workorders.assign"))
  ) {
    return fail("forbidden");
  }

  const date = cleanText(input.date, { maxLength: 10 });
  const technicianId = cleanId(input.technicianId);
  const parsedDate = parseDateOnly(date);
  if (!parsedDate || !technicianId || !Array.isArray(input.items)) {
    return fail("invalid");
  }

  const items = input.items
    .map((item) => ({
      visitId: cleanId(item.visitId),
      routeSequence: parseRouteSequence(item.sequence),
    }))
    .filter((item) => item.visitId);
  if (items.length === 0) return fail("invalid");

  const uniqueIds = Array.from(new Set(items.map((item) => item.visitId)));
  if (uniqueIds.length !== items.length) return fail("invalid");

  const dayStart = osloDayStart(date);
  const dayEnd = addDaysUtc(dayStart, 1);
  const visits = await prisma.visit.findMany({
    where: {
      id: { in: uniqueIds },
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      technicians: { some: { userId: technicianId } },
      workOrder: { AND: [workOrderScopeFor(actor)] },
    },
    select: {
      id: true,
      workOrderId: true,
      workOrder: { select: { title: true } },
    },
  });
  if (visits.length !== uniqueIds.length) return fail("not_found");

  const byId = new Map(visits.map((visit) => [visit.id, visit]));
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const visit = byId.get(item.visitId);
      if (!visit) continue;
      await tx.visit.update({
        where: { id: visit.id },
        data: { routeSequence: item.routeSequence },
      });
      await audit(tx, {
        entityType: "Visit",
        entityId: visit.id,
        action: `Satte manuell rute-rekkefølge: ${visit.workOrder.title}`,
        actor: toAuditActor(actor),
        metadata: {
          workOrderId: visit.workOrderId,
          date,
          technicianId,
          routeSequence: item.routeSequence,
        },
      });
    }
  });

  return ok({ updated: items.length });
}
