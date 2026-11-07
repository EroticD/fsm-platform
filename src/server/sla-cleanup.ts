import type { PrismaClient, SlaState } from "@prisma/client";
import { audit } from "@/lib/audit";
import { resolveSlaPolicyId } from "./sla";

/**
 * Opprydding av SLA-klokker som ikke lenger har dekning i en aktiv avtale.
 *
 * Den nye SLA-regelen starter bare klokker for oppdrag som har en aktiv,
 * datogyldig avtale med en aktiv SLA-policy. Eldre data kan derfor ha klokker
 * som aldri skulle vært startet, eller som peker på en annen policy enn den
 * avtalen nå gir. Denne tjenesten finner slike klokker og kansellerer dem.
 *
 * - Klokker som allerede er `CANCELLED` røres ikke.
 * - Klokker som fortsatt har samme gyldige policy beholdes uendret.
 * - Hver kansellering revisjonslogges med forrige tilstand og årsak.
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
    const clocks = await tx.slaClock.findMany({
      where: { state: { not: "CANCELLED" } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        workOrderId: true,
        policyId: true,
        state: true,
        policy: { select: { name: true } },
        workOrder: { select: { title: true } },
      },
    });

    const candidates: SlaCleanupCandidate[] = [];
    let kept = 0;
    let cancelled = 0;

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
    }

    return {
      dryRun,
      scanned: clocks.length,
      kept,
      candidates,
      cancelled,
    };
  });
}
