import type { PrismaClient, SlaState } from "@prisma/client";
import { audit } from "@/lib/audit";
import { statusKeysByCategory } from "@/lib/work-order-status";
import { resolveSlaPolicyId, startClock } from "./sla";

/**
 * Opprydding av SLA-klokker som ikke lenger har dekning i en aktiv avtale.
 *
 * Den nye SLA-regelen starter bare klokker for oppdrag som har en aktiv,
 * datogyldig avtale med en aktiv SLA-policy. Eldre data kan derfor ha klokker
 * som aldri skulle vært startet, eller som peker på en annen policy enn den
 * avtalen nå gir.
 *
 * - Klokker som allerede er `CANCELLED` røres ikke.
 * - Klokker som fortsatt har samme gyldige policy beholdes uendret.
 * - Peker klokken på feil policy, men avtalen gir en gyldig en, kanselleres
 *   den gamle og den riktige startes i samme transaksjon. Uten dette blir
 *   oppdraget stående uten SLA-dekning selv om avtalen faktisk gir det.
 * - Har oppdraget ingen aktiv avtale, kanselleres klokken.
 * - Hver endring revisjonslogges med forrige tilstand og årsak.
 * - Tørrkjøring (standard) skriver ingenting.
 */
export type SlaCleanupClient = Pick<PrismaClient, "$transaction">;

export type SlaCleanupReason =
  | "no-active-contract"
  | "applicable-policy-differs";

export type SlaCleanupCandidate = {
  clockId: string;
  workOrderId: string;
  workOrderTitle: string;
  policyId: string;
  policyName: string;
  previousState: SlaState;
  applicablePolicyId: string | null;
  reason: SlaCleanupReason;
};

export type SlaCleanupResult = {
  dryRun: boolean;
  scanned: number;
  /** Klokker som har gyldig dekning og blir beholdt. */
  kept: number;
  /** Kandidater som kanselleres (eller ville blitt det i tørrkjøring). */
  candidates: SlaCleanupCandidate[];
  cancelled: number;
  /** Klokker som er erstattet med en klokke for riktig policy. */
  replaced: number;
};

export type SlaCleanupOptions = {
  dryRun?: boolean;
  now?: Date;
  /** Sikkerhetsgrense for hvor mange klokker som vurderes i én kjøring. */
  take?: number;
};

export async function cancelUncontractedSlaClocks(
  client: SlaCleanupClient,
  options: SlaCleanupOptions = {},
): Promise<SlaCleanupResult> {
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date();
  const take = Math.min(Math.max(options.take ?? 1_000, 1), 10_000);

  return client.$transaction(async (tx) => {
    // Én opprydding om gangen, også når flere app-instanser har en scheduler.
    // Låsen slippes ved commit/rollback; neste kjøring ser da allerede
    // kansellerte klokker og gjør ingenting.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sla-cleanup'))`;

    const clocks = await tx.slaClock.findMany({
      where: {
        state: { not: "CANCELLED" },
        // Et lukket oppdrag skal ikke få en ny, levende SLA-klokke. Det ville
        // gitt falske frister i panelet og i metrics.
        workOrder: { status: { notIn: statusKeysByCategory("CLOSED") } },
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        workOrderId: true,
        policyId: true,
        state: true,
        startedAt: true,
        respondedAt: true,
        policy: { select: { name: true } },
        workOrder: { select: { title: true } },
      },
    });

    const candidates: SlaCleanupCandidate[] = [];
    let kept = 0;
    let cancelled = 0;
    let replaced = 0;

    for (const clock of clocks) {
      const applicable = await resolveSlaPolicyId(
        tx,
        clock.workOrderId,
        now,
      );
      if (applicable && applicable.policyId === clock.policyId) {
        kept += 1;
        continue;
      }

      const candidate: SlaCleanupCandidate = {
        clockId: clock.id,
        workOrderId: clock.workOrderId,
        workOrderTitle: clock.workOrder.title,
        policyId: clock.policyId,
        policyName: clock.policy.name,
        previousState: clock.state,
        applicablePolicyId: applicable?.policyId ?? null,
        reason: applicable
          ? "applicable-policy-differs"
          : "no-active-contract",
      };
      candidates.push(candidate);
      if (dryRun) continue;

      await tx.slaClock.update({
        where: { id: clock.id },
        data: { state: "CANCELLED", breachedAt: null },
      });
      await audit(tx, {
        entityType: "SlaClock",
        entityId: clock.id,
        action: "SLA: klokken kansellert ved opprydding",
        actor: { id: "", name: "SLA", email: null },
        metadata: {
          workOrderId: clock.workOrderId,
          workOrderTitle: clock.workOrder.title,
          policyId: clock.policyId,
          policyName: clock.policy.name,
          previousState: clock.state,
          applicablePolicyId: applicable?.policyId ?? null,
          reason: candidate.reason,
          cancelledAt: now.toISOString(),
        },
      });
      cancelled += 1;

      // Avtalen gir en annen, gyldig policy: start den riktige klokken i
      // samme transaksjon, med samme start- og responstidspunkt. Da beholder
      // oppdraget fristene sine i stedet for å få en fersk frist det aldri
      // hadde krav på. Klokken telles bare som erstattet når det faktisk ble
      // opprettet en ny rad.
      if (applicable) {
        const existing = await tx.slaClock.findUnique({
          where: {
            workOrderId_policyId: {
              workOrderId: clock.workOrderId,
              policyId: applicable.policyId,
            },
          },
          select: { id: true },
        });
        if (!existing) {
          const created = await startClock(tx, clock.workOrderId, {
            policyId: applicable.policyId,
            now,
            startedAt: clock.startedAt,
            respondedAt: clock.respondedAt,
          });
          if (created) replaced += 1;
        }
      }
    }

    return {
      dryRun,
      scanned: clocks.length,
      kept,
      candidates,
      cancelled,
      replaced,
    };
  });
}
