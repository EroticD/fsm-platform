// i18n-ignore-file: jobbrunnerens logger er driftsdata, ikke UI-tekst.
import type { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  slaCleanupEnabled,
  slaCleanupIsDue,
} from "@/lib/sla-cleanup-config";
import {
  cancelUncontractedSlaClocks,
  type SlaCleanupClient,
  type SlaCleanupResult,
} from "./sla-cleanup";

export type SlaCleanupSkipReason = "disabled" | "not_due";

export type SlaCleanupJobResult = {
  enabled: boolean;
  skipped: SlaCleanupSkipReason | null;
  runId: string | null;
  result: SlaCleanupResult | null;
  error: string | null;
};

type SlaCleanupRunRow = {
  id: string;
  startedAt: Date;
  status: string;
};

export type SlaCleanupJobClient = Pick<
  PrismaClient,
  "$transaction" | "slaCleanupRun"
> &
  SlaCleanupClient;

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

/**
 * Tar en «due»-sjekk og oppretter kjøringsraden i samme transaksjon, med en
 * advisory-lås. To app-instanser som våkner samtidig kan derfor ikke begge
 * starte oppryddingen; den andre ser den ferske RUNNING-raden og hopper over.
 */
async function claimRun(
  client: SlaCleanupJobClient,
  now: Date,
  env: Record<string, string | undefined>,
): Promise<{ runId: string } | { skip: "not_due" }> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sla-cleanup-claim'))`;

    const latest = (await tx.slaCleanupRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true, status: true },
    })) as SlaCleanupRunRow | null;

    if (!slaCleanupIsDue(latest?.startedAt ?? null, now, env)) {
      return { skip: "not_due" } as const;
    }

    const run = (await tx.slaCleanupRun.create({
      data: { startedAt: now, status: "RUNNING" },
      select: { id: true },
    })) as { id: string };
    return { runId: run.id };
  });
}

/**
 * Kjører den automatiske SLA-oppryddingen én gang.
 *
 * - `SLA_CLEANUP_ENABLED=false` gjør kallet til en trygg no-op.
 * - Kjøringen starter bare når intervallet (`SLA_CLEANUP_INTERVAL_HOURS`) er
 *   passert, slik at både den interne scheduleren og en ekstern cron kan kalle
 *   den uten å duplisere arbeid.
 * - Feil logges og lagres på kjøringsraden; funksjonen kaster aldri videre, så
 *   en ødelagt opprydding stopper ikke de andre bakgrunnsjøbbene.
 *
 * Selve kanselleringen og revisjonsloggen skjer i én transaksjon per klokke
 * inne i `cancelUncontractedSlaClocks`.
 */
export async function runSlaCleanupJob(
  options: {
    now?: Date;
    env?: Record<string, string | undefined>;
    client?: SlaCleanupJobClient;
  } = {},
): Promise<SlaCleanupJobResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const client = options.client ?? (prisma as unknown as SlaCleanupJobClient);

  if (!slaCleanupEnabled(env)) {
    logger.debug("SLA cleanup: disabled", {
      reason: "SLA_CLEANUP_ENABLED=false",
    });
    return {
      enabled: false,
      skipped: "disabled",
      runId: null,
      result: null,
      error: null,
    };
  }

  let claimed: Awaited<ReturnType<typeof claimRun>>;
  try {
    claimed = await claimRun(client, now, env);
  } catch (error) {
    const message = errorText(error);
    logger.error("SLA cleanup: could not claim a run", { error: message });
    return {
      enabled: true,
      skipped: null,
      runId: null,
      result: null,
      error: message,
    };
  }

  if ("skip" in claimed) {
    return {
      enabled: true,
      skipped: claimed.skip,
      runId: null,
      result: null,
      error: null,
    };
  }

  const runId = claimed.runId;
  try {
    const result = await cancelUncontractedSlaClocks(client, { now });
    await client.slaCleanupRun.update({
      where: { id: runId },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        scanned: result.scanned,
        kept: result.kept,
        cancelled: result.cancelled,
      },
    });

    if (result.cancelled > 0) {
      logger.warn("SLA cleanup: cancelled clocks without active coverage", {
        runId,
        scanned: result.scanned,
        kept: result.kept,
        cancelled: result.cancelled,
      });
    } else {
      logger.info("SLA cleanup: nothing to cancel", {
        runId,
        scanned: result.scanned,
        kept: result.kept,
      });
    }

    return {
      enabled: true,
      skipped: null,
      runId,
      result,
      error: null,
    };
  } catch (error) {
    const message = errorText(error);
    logger.error("SLA cleanup: run failed", { runId, error: message });
    try {
      await client.slaCleanupRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: message,
        },
      });
    } catch (updateError) {
      logger.error("SLA cleanup: could not store the failure", {
        runId,
        error: errorText(updateError),
      });
    }
    return {
      enabled: true,
      skipped: null,
      runId,
      result: null,
      error: message,
    };
  }
}
