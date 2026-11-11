import type { Prisma, WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit, type AuditActor } from "@/lib/audit";
import { canTransition, isClosedStatus } from "@/lib/work-order-status";
import { cancelClocks, markResolved } from "@/server/sla";

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
  /** Administrator kan bevisst overstyre tilstandsmaskinen (med grunn). */
  force?: boolean;
  actor: AuditActor;
  action: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<StatusTransitionResult> {
  if (!params.force && !canTransition(params.from, params.to, params.isAdmin)) {
    return { ok: false, error: "ugyldig-status" };
  }

  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.workOrder.updateMany({
      where: { id: params.workOrderId, status: params.from },
      data: { status: params.to },
    });
    if (result.count === 0) return false;

    // SLA-klokken følger oppdragets livssyklus. Visittens DONE/EN_ROUTE er
    // førsteprioritet, men et kontor som fullfører eller kansellerer direkte
    // skal også lukke klokken – i samme transaksjon.
    if (params.to === "COMPLETED") {
      await markResolved(tx, params.workOrderId);
    } else if (params.to === "CANCELLED") {
      await cancelClocks(tx, params.workOrderId);
    }

    // Et lukket oppdrag skal ikke fortsette å se ut som en aktiv reise. Vi
    // lukker visittene og returkjøringen i samme transaksjon som statusen, slik
    // at verken dashbordet, kartet eller sporingslenken blir hengende igjen.
    // Statuskategoriene er konfigurerbare; derfor brukes `isClosedStatus` i
    // stedet for å hardkode COMPLETED/CANCELLED.
    if (isClosedStatus(params.to)) {
      const closedAt = new Date();

      if (params.to === "CANCELLED") {
        // Aktiv returkjøring må avsluttes før visittene blir CANCELLED, ellers
        // mister vi muligheten til å skille dem fra allerede kansellerte rader.
        await tx.visit.updateMany({
          where: {
            workOrderId: params.workOrderId,
            status: { in: ["EN_ROUTE", "ON_SITE"] },
            travelFromEndedAt: null,
          },
          data: { travelFromEndedAt: closedAt },
        });
        await tx.visit.updateMany({
          where: {
            workOrderId: params.workOrderId,
            status: { in: ["PLANNED", "ASSIGNED", "EN_ROUTE", "ON_SITE"] },
          },
          data: { status: "CANCELLED" },
        });
      } else {
        // Fullført (eller en annen lukket status som ikke er kansellert):
        // pågående visiter er i praksis ferdige. `doneAt` bevares hvis det
        // allerede finnes, og settes ellers i samme UPDATE som statusen.
        await tx.visit.updateMany({
          where: {
            workOrderId: params.workOrderId,
            status: { in: ["EN_ROUTE", "ON_SITE"] },
            doneAt: null,
          },
          data: { status: "DONE", doneAt: closedAt },
        });
        await tx.visit.updateMany({
          where: {
            workOrderId: params.workOrderId,
            status: { in: ["EN_ROUTE", "ON_SITE"] },
          },
          data: { status: "DONE" },
        });
      }

      // Også DONE-visiter kan ha returkjøring som aldri ble avsluttet. Dette
      // rydder opp i gamle rader samtidig som det beskytter nye.
      await tx.visit.updateMany({
        where: {
          workOrderId: params.workOrderId,
          status: "DONE",
          travelFromEndedAt: null,
        },
        data: { travelFromEndedAt: closedAt },
      });

      // En offentlig sporingslenke skal slutte å svare umiddelbart når
      // oppdraget lukkes, uavhengig av visittens status.
      await tx.trackingLink.updateMany({
        where: { workOrderId: params.workOrderId, revokedAt: null },
        data: { revokedAt: closedAt },
      });
    }

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
