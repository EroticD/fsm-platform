import type { Prisma, WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit, type AuditActor } from "@/lib/audit";
import { canTransition } from "@/lib/work-order-status";

export type StatusTransitionResult =
  | { ok: true }
  | { ok: false; error: "ugyldig-status" };

/**
 * Bytter status på et oppdrag på serveren, med tilstandsmaskinen som vakt.
 *
 * Statusendringen og revisjonsloggen skrives i samme transaksjon. Da kan ikke
 * et oppdrag få ny status uten at endringen er logget, og en feil i loggen
 * ruller hele endringen tilbake. `updateMany` med `status: from` hindrer også
 * at to samtidige forespørsler bytter fra en status som ikke lenger gjelder.
 */
export async function transitionWorkOrderStatus(params: {
  workOrderId: string;
  from: WorkStatus;
  to: WorkStatus;
  isAdmin: boolean;
  actor: AuditActor;
  action: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<StatusTransitionResult> {
  if (!canTransition(params.from, params.to, params.isAdmin)) {
    return { ok: false, error: "ugyldig-status" };
  }

  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.workOrder.updateMany({
      where: { id: params.workOrderId, status: params.from },
      data: { status: params.to },
    });
    if (result.count === 0) return false;

    await audit(tx, {
      entityType: "WorkOrder",
      entityId: params.workOrderId,
      action: params.action,
      actor: params.actor,
      metadata: params.metadata,
    });
    return true;
  });

  return changed ? { ok: true } : { ok: false, error: "ugyldig-status" };
}
