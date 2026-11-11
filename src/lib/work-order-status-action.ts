import type { Prisma, WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit, type AuditActor } from "@/lib/audit";
import { canTransition, isClosedStatus } from "@/lib/work-order-status";
import { cancelClocks, markResolved } from "@/server/sla";
import { recomputeWorkOrderSchedule } from "@/lib/work-order-schedule";

export type StatusTransitionResult =
  | { ok: true }
  | { ok: false; error: "ugyldig-status" };

/**
 * `Prisma.TransactionClient` er strukturelt tilordnbar fra `PrismaClient`, så
 * typesystemet alene hindrer ikke at ryddingen kjøres utenfor en transaksjon.
 * Denne vakten gjør feilen høylytt i stedet for stille ikke-atomisk.
 */
function assertTransactionClient(tx: Prisma.TransactionClient): void {
  const candidate = tx as unknown as {
    $transaction?: unknown;
    $connect?: unknown;
  };
  // En full `PrismaClient` har både `$transaction` og `$connect`; en ekte
  // transaksjonsklient har ingen av dem. Testmocker har ofte en `$transaction`
  // for å drive tilbakekalling, men aldri `$connect`.
  if (
    typeof candidate.$transaction === "function" &&
    typeof candidate.$connect === "function"
  ) {
    throw new Error(
      "closeWorkOrderState og reopenWorkOrderState krever en transaksjonsklient",
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CloseWorkOrderParams = {
  workOrderId: string;
  /** `true` = kansellering, `false` = fullført (eller annen lukket status). */
  cancelled: boolean;
  closedAt?: Date;
};

/**
 * Rydder all tilstand som henger på et oppdrag når det lukkes.
 *
 * Et lukket oppdrag skal ikke fortsette å se ut som en aktiv reise. Derfor
 * lukkes pågående visiter, returkjøring, offentlige sporingslenker og
 * SLA-klokken i samme transaksjon som statusendringen.
 *
 * Funksjonen er felles for alle veier som lukker et oppdrag – manuell
 * statusendring, rapport som fullfører oppdraget på stedet og importjobber –
 * slik at ingen av dem kan glemme en del av ryddingen. Kall den alltid med
 * transaksjonsklienten som faktisk skrev statusendringen.
 */
export async function closeWorkOrderState(
  tx: Prisma.TransactionClient,
  { workOrderId, cancelled, closedAt = new Date() }: CloseWorkOrderParams,
): Promise<void> {
  assertTransactionClient(tx);

  // SLA-klokken følger oppdragets livssyklus. Visittens DONE/EN_ROUTE er
  // førsteprioritet, men et kontor som fullfører eller kansellerer direkte
  // skal også lukke klokken – i samme transaksjon.
  if (cancelled) {
    await cancelClocks(tx, workOrderId, closedAt);
  } else {
    await markResolved(tx, workOrderId, closedAt);
  }

  if (cancelled) {
    // Aktiv returkjøring må avsluttes før visittene blir CANCELLED, ellers
    // mister vi muligheten til å skille dem fra allerede kansellerte rader.
    await tx.visit.updateMany({
      where: {
        workOrderId,
        status: { in: ["EN_ROUTE", "ON_SITE"] },
        travelFromEndedAt: null,
      },
      data: { travelFromEndedAt: closedAt },
    });
    await tx.visit.updateMany({
      where: {
        workOrderId,
        status: { in: ["PLANNED", "ASSIGNED", "EN_ROUTE", "ON_SITE"] },
      },
      data: { status: "CANCELLED", autoClosedAt: closedAt },
    });
  } else {
    // Fullført (eller en annen lukket status som ikke er kansellert):
    // pågående visiter er i praksis ferdige. `doneAt` bevares hvis det
    // allerede finnes, og settes ellers i samme UPDATE som statusen.
    await tx.visit.updateMany({
      where: {
        workOrderId,
        status: { in: ["EN_ROUTE", "ON_SITE"] },
        doneAt: null,
      },
      data: { status: "DONE", doneAt: closedAt, autoClosedAt: closedAt },
    });
    await tx.visit.updateMany({
      where: {
        workOrderId,
        status: { in: ["EN_ROUTE", "ON_SITE"] },
      },
      data: { status: "DONE", autoClosedAt: closedAt },
    });
  }

  // Også DONE-visiter kan ha returkjøring som aldri ble avsluttet. Returen
  // skal aldri regnes som lengre enn til arbeidet var ferdig: ved opprydding
  // av gamle rader brukes `doneAt` som sluttidspunkt, ikke tidspunktet
  // reparasjonen kjørte. Uten dette blir reisetid og kjøregodtgjørelse feil
  // for visiter som ble liggende i månedsvis.
  if (typeof tx.$executeRaw === "function") {
    await tx.$executeRaw`UPDATE "Visit"
      SET "travelFromEndedAt" = COALESCE("doneAt", ${closedAt})
      WHERE "workOrderId" = ${workOrderId}
        AND "status" = 'DONE'
        AND "travelFromEndedAt" IS NULL`;
  } else {
    await tx.visit.updateMany({
      where: {
        workOrderId,
        status: "DONE",
        travelFromEndedAt: null,
      },
      data: { travelFromEndedAt: closedAt },
    });
  }

  // En offentlig sporingslenke skal slutte å svare umiddelbart når
  // oppdraget lukkes, uavhengig av visittens status.
  await tx.trackingLink.updateMany({
    where: { workOrderId, revokedAt: null },
    data: { revokedAt: closedAt },
  });

  // Et kansellert oppdrag skal ikke beholde en datoperiode som ser ut som en
  // plan. Fullførte oppdrag beholder datoene som historikk.
  if (cancelled) {
    await recomputeWorkOrderSchedule(tx, workOrderId);
  }
}

/**
 * Gjenoppretter feltilstand når et lukket oppdrag gjenåpnes.
 *
 * Lukkingen markerer selv hvilke visiter den lukket eller kansellerte
 * (`Visit.autoClosedAt`). Bare disse gjenopprettes, slik at en visitt som ble
 * kansellert manuelt – for eksempel «kunden var ikke hjemme» – ikke vekkes til
 * live igjen. Reise- og tilstedetidspunktene nullstilles fordi visitten skal
 * planlegges på nytt; de opprinnelige verdiene følger med i revisjonsloggen.
 *
 * Sporingslenker gjenopprettes ikke; de opprettes på nytt når montøren deler
 * posisjon igjen, slik at en gammel lenke aldri blir gyldig på nytt.
 */
export type ReopenedVisit = {
  id: string;
  previousStatus: string;
  enRouteAt: string | null;
  onSiteAt: string | null;
  doneAt: string | null;
  travelFromEndedAt: string | null;
};

export async function reopenWorkOrderState(
  tx: Prisma.TransactionClient,
  { workOrderId }: { workOrderId: string },
): Promise<{ restoredVisits: number; visits: ReopenedVisit[] }> {
  assertTransactionClient(tx);

  const closedByWorkOrder = await tx.visit.findMany({
    where: { workOrderId, autoClosedAt: { not: null } },
    select: {
      id: true,
      status: true,
      enRouteAt: true,
      onSiteAt: true,
      doneAt: true,
      travelFromEndedAt: true,
      technicians: { select: { userId: true }, take: 1 },
    },
  });

  const visits: ReopenedVisit[] = [];
  for (const visit of closedByWorkOrder) {
    await tx.visit.update({
      where: { id: visit.id },
      data: {
        // En visitt som hadde montør skal ikke falle tilbake til «planlagt,
        // udelt». Tildelingen ligger i VisitTechnician og består.
        status: visit.technicians.length > 0 ? "ASSIGNED" : "PLANNED",
        autoClosedAt: null,
        enRouteAt: null,
        onSiteAt: null,
        doneAt: null,
        travelFromEndedAt: null,
      },
    });
    visits.push({
      id: visit.id,
      previousStatus: visit.status,
      enRouteAt: visit.enRouteAt?.toISOString() ?? null,
      onSiteAt: visit.onSiteAt?.toISOString() ?? null,
      doneAt: visit.doneAt?.toISOString() ?? null,
      travelFromEndedAt: visit.travelFromEndedAt?.toISOString() ?? null,
    });
  }

  if (visits.length > 0) {
    await recomputeWorkOrderSchedule(tx, workOrderId);
  }

  return { restoredVisits: visits.length, visits };
}

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

    // Et lukket oppdrag skal ikke fortsette å se ut som en aktiv reise. All
    // rydding – visiter, returkjøring, sporingslenker og SLA-klokke – ligger i
    // `closeWorkOrderState`, som også rapportveien bruker. Statuskategoriene er
    // konfigurerbare; derfor brukes `isClosedStatus` i stedet for å hardkode
    // COMPLETED/CANCELLED.
    let reopened: Awaited<ReturnType<typeof reopenWorkOrderState>> | null = null;
    if (isClosedStatus(params.to)) {
      await closeWorkOrderState(tx, {
        workOrderId: params.workOrderId,
        cancelled: params.to === "CANCELLED",
      });
    } else if (isClosedStatus(params.from)) {
      // Gjenåpning: et lukket oppdrag som skal tilbake til arbeid må ha en
      // aktiv visitt igjen. Ellers vises det ikke i felt og kan ikke startes.
      reopened = await reopenWorkOrderState(tx, {
        workOrderId: params.workOrderId,
      });
    }

    // Hvilke visiter som ble gjenopprettet, og hva de hadde av reise- og
    // tilstedetid, er en del av revisjonssporet. Uten dette finnes ingen
    // forklaring på hvorfor gamle tidsstempler er borte fra visitten.
    const metadata =
      reopened && reopened.visits.length > 0
        ? {
            ...(isPlainObject(params.metadata) ? params.metadata : {}),
            restoredVisits: reopened.visits.length,
            reopenedVisits: reopened.visits,
          }
        : params.metadata;

    await audit(tx, {
      entityType: "WorkOrder",
      entityId: params.workOrderId,
      action: params.action,
      actor: params.actor,
      metadata,
    });
    return true;
  });

  return changed ? { ok: true } : { ok: false, error: "ugyldig-status" };
}
