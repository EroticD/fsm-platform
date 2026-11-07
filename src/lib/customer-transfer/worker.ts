// i18n-ignore-file: workerkøen bruker stabile koder og tekniske statuser.
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { moduleEnabled } from "@/server/modules";
import type { ServiceActor } from "@/server/actor";
import { applyImport } from "./apply-import";
import { analysePackage } from "./analyse";
import { buildCustomerPackage } from "./build-package";
import { readPackage } from "./read-package";
import {
  TRANSFER_ERROR,
  TRANSFER_KIND,
  TRANSFER_LIMITS,
  TRANSFER_STATUS,
  normalisePolicies,
} from "./constants";
import {
  readStagedPackage,
  removeJobStaging,
  writeStagedPackage,
} from "./jobs";
import { disabledImportModules } from "./module-gate";
import { reconcileTransferJobFiles } from "./reconcile";
import { normaliseExportOptions } from "./export-request";
import type { ExportOptions, ImportOptions } from "./types";

/**
 * Vedvarende worker for kundeoverføring.
 *
 * Køen er `CustomerTransferJob` selv: eksport settes til PENDING, bekreftet
 * import til QUEUED. Workeren henter én og én jobb med `FOR UPDATE SKIP
 * LOCKED`, flytter den til RUNNING og oppdaterer stage/progress underveis.
 * Alle tilstandsoverganger er betinget av forrige status, slik at en avbrutt
 * jobb eller en samtidig worker ikke kan overskrive et ferdig resultat.
 *
 * Gjenopptak:
 * - Eksportbygging er idempotent. En gammel RUNNING settes tilbake til PENDING
 *   og staging slettes før ny bygging.
 * - Import er én databasetransaksjon med filskriving før commit. Krasjer
 *   prosessen, er transaksjonen rullet tilbake (eller committet med status
 *   COMPLETED). En gammel RUNNING kan derfor trygt kjøres på nytt; filer fra
 *   forsøket ryddes av avstemmingen.
 */

export type TransferJobRow = {
  id: string;
  actorId: string;
  kind: string;
  status: string;
  packageChecksum: string | null;
  sourceInstanceId: string | null;
  schemaVersion: string | null;
  customerIdsJson: unknown;
  countsJson: unknown;
  errorJson: unknown;
  resultJson: unknown;
  progressStage: string | null;
  progressProcessed: number;
  progressTotal: number;
  previewTokenHash: string | null;
  previewExpiresAt: Date | null;
  targetFingerprint: string | null;
  stagingPath: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};

const STALE_JOB_MS = Math.max(
  5 * 60_000,
  Number.parseInt(process.env.CUSTOMER_TRANSFER_STALE_JOB_MS ?? "", 10) ||
    60 * 60_000,
);

async function jobActor(actorId: string): Promise<ServiceActor> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      departmentId: true,
    },
  });
  // En slettet bruker må ikke stoppe en allerede bestilt eksport. Revisjonen
  // beholder bare id-en; vi finner ikke på navn eller e-post.
  return (
    user ?? {
      id: actorId,
      name: null,
      email: null,
      role: "ADMIN",
      isActive: false,
      departmentId: null,
    }
  );
}

function resultRecord(job: { resultJson: unknown }): Record<string, unknown> {
  return job.resultJson && typeof job.resultJson === "object"
    ? (job.resultJson as Record<string, unknown>)
    : {};
}

function exportOptionsFrom(job: TransferJobRow): ExportOptions {
  const stored = resultRecord(job).exportOptions;
  if (stored && typeof stored === "object") {
    return stored as ExportOptions;
  }
  // Eldre PENDING-jobber (før worker-flyttingen) har bare kunde-ID-ene.
  return normaliseExportOptions({
    customerIds: Array.isArray(job.customerIdsJson)
      ? (job.customerIdsJson as string[])
      : [],
  });
}

/** Henter og låser neste jobb. Eksport PENDING og import QUEUED. */
export async function claimNextTransferJob(): Promise<TransferJobRow | null> {
  const rows = await prisma.$queryRaw<TransferJobRow[]>`
    UPDATE "CustomerTransferJob"
    SET "status" = 'RUNNING',
        "startedAt" = COALESCE("startedAt", now()),
        "progressStage" = 'claimed',
        "updatedAt" = now()
    WHERE "id" = (
      SELECT "id"
      FROM "CustomerTransferJob"
      WHERE (
        ("kind" = 'EXPORT' AND "status" = 'PENDING')
        OR ("kind" = 'IMPORT' AND "status" = 'QUEUED')
      )
        AND ("expiresAt" IS NULL OR "expiresAt" > now())
      ORDER BY "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Setter jobber som en krasjet prosess etterlot i RUNNING tilbake i køen.
 * Kalles ved oppstart og med jevne mellomrom.
 */
export async function requeueStaleTransferJobs(
  now = new Date(),
): Promise<number> {
  // Rydd eventuelle halvskrevne sluttfiler før importen prøves på nytt.
  await reconcileTransferJobFilesFromJobs();

  const cutoff = new Date(now.getTime() - STALE_JOB_MS);
  const exportRows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "CustomerTransferJob"
    SET "status" = 'PENDING',
        "startedAt" = NULL,
        "progressStage" = 'requeued',
        "updatedAt" = now()
    WHERE "kind" = 'EXPORT'
      AND "status" = 'RUNNING'
      AND "updatedAt" < ${cutoff}
    RETURNING "id"
  `;
  const importRows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "CustomerTransferJob"
    SET "status" = 'QUEUED',
        "startedAt" = NULL,
        "progressStage" = 'requeued',
        "updatedAt" = now()
    WHERE "kind" = 'IMPORT'
      AND "status" = 'RUNNING'
      AND "updatedAt" < ${cutoff}
    RETURNING "id"
  `;

  // Før en krasjet import kjøres på nytt, må filene fra det forrige forsøket
  // avstemmes mens den gamle fillisten fortsatt finnes. Ellers ville det nye
  // forsøket overskrevet listen og latt de gamle filene ligge.
  for (const row of importRows) {
    await reconcileTransferJobFiles(row.id).catch(() => undefined);
  }

  const count = exportRows.length + importRows.length;
  if (count > 0) {
    logger.warn("Requeued stale customer transfer jobs", {
      exports: exportRows.length,
      imports: importRows.length,
    });
  }
  return count;
}

async function reconcileTransferJobFilesFromJobs(): Promise<void> {
  const jobs = await prisma.customerTransferJob.findMany({
    where: {
      kind: TRANSFER_KIND.import,
      status: {
        in: [
          TRANSFER_STATUS.failed,
          TRANSFER_STATUS.aborted,
          TRANSFER_STATUS.expired,
        ],
      },
    },
    select: { id: true },
    take: 200,
  });
  for (const job of jobs) {
    await reconcileTransferJobFiles(job.id).catch(() => undefined);
  }
}

export async function failTransferJob(
  jobId: string,
  input: {
    code: string;
    messageKey: string;
    stage: string;
    keepStaging: boolean;
  },
): Promise<void> {
  await prisma.customerTransferJob
    .updateMany({
      where: { id: jobId, status: TRANSFER_STATUS.running },
      data: {
        status: TRANSFER_STATUS.failed,
        errorJson: {
          code: input.code,
          messageKey: input.messageKey,
          stage: input.stage,
        },
        progressStage: input.stage,
        completedAt: new Date(),
        previewTokenHash: null,
        previewExpiresAt: null,
        ...(input.keepStaging ? {} : { stagingPath: null }),
      },
    })
    .catch(() => undefined);
  if (!input.keepStaging) {
    await removeJobStaging(jobId);
  } else {
    await reconcileTransferJobFiles(jobId).catch(() => undefined);
  }
}

async function processExportJob(job: TransferJobRow): Promise<void> {
  const options = exportOptionsFrom(job);
  const exportedAt = new Date();
  await removeJobStaging(job.id);
  await prisma.customerTransferJob.updateMany({
    where: { id: job.id, status: TRANSFER_STATUS.running },
    data: { progressStage: "build", updatedAt: new Date() },
  });

  const actor = await jobActor(job.actorId);
  const built = await buildCustomerPackage(actor, options, exportedAt);
  if (built.customerIds.length === 0) {
    await failTransferJob(job.id, {
      code: TRANSFER_ERROR.not_found,
      messageKey: "errors.customerTransfer.customerNotFound",
      stage: "build",
      keepStaging: false,
    });
    return;
  }

  await prisma.customerTransferJob.updateMany({
    where: { id: job.id, status: TRANSFER_STATUS.running },
    data: { progressStage: "stage", updatedAt: new Date() },
  });
  const stagingPath = await writeStagedPackage(job.id, built.buffer);
  const expiresAt = new Date(Date.now() + TRANSFER_LIMITS.exportTtlMs);
  const previous = resultRecord(job);

  const updated = await prisma.customerTransferJob.updateMany({
    where: { id: job.id, status: TRANSFER_STATUS.running },
    data: {
      status: TRANSFER_STATUS.ready,
      packageChecksum: built.checksum,
      sourceInstanceId: built.manifest.source.instanceId,
      schemaVersion: built.manifest.schemaVersion,
      countsJson: built.counts,
      resultJson: {
        requestFingerprint: previous.requestFingerprint ?? null,
        warnings: built.warnings.length,
        customerCount: built.customerIds.length,
        packageId: built.manifest.packageId,
        progress: {
          stage: "ready",
          files: built.counts.files ?? 0,
        },
      },
      stagingPath,
      expiresAt,
      progressStage: "ready",
      progressProcessed: built.counts.files ?? 0,
      progressTotal: built.counts.files ?? 0,
      completedAt: new Date(),
    },
  });
  // Jobben kan ha blitt avbrutt mens pakken ble bygget. Da skal den ikke
  // gjenoppstå som READY eller legge igjen en nedlastbar fil.
  if (updated.count === 0) {
    await removeJobStaging(job.id);
  }
}

async function processImportJob(job: TransferJobRow): Promise<void> {
  const stored = resultRecord(job);
  const confirm =
    stored.confirm && typeof stored.confirm === "object"
      ? (stored.confirm as Record<string, unknown>)
      : null;
  if (!confirm) {
    await failTransferJob(job.id, {
      code: TRANSFER_ERROR.invalid_job_state,
      messageKey: "errors.customerTransfer.invalidJobState",
      stage: "confirm",
      keepStaging: true,
    });
    return;
  }

  const buffer = await readStagedPackage(job.id);
  if (!buffer) {
    await failTransferJob(job.id, {
      code: TRANSFER_ERROR.job_expired,
      messageKey: "errors.customerTransfer.jobExpired",
      stage: "read",
      keepStaging: true,
    });
    return;
  }

  await prisma.customerTransferJob.updateMany({
    where: { id: job.id, status: TRANSFER_STATUS.running },
    data: { progressStage: "validate", updatedAt: new Date() },
  });

  const read = readPackage(buffer);
  if (!read.ok) {
    await failTransferJob(job.id, {
      code: read.errors[0]?.code ?? TRANSFER_ERROR.invalid_manifest,
      messageKey:
        read.errors[0]?.messageKey ??
        "errors.customerTransfer.invalidManifest",
      stage: "validate",
      keepStaging: true,
    });
    return;
  }
  if (read.result.checksum !== job.packageChecksum) {
    await failTransferJob(job.id, {
      code: TRANSFER_ERROR.checksum_mismatch,
      messageKey: "errors.customerTransfer.checksumMismatch",
      stage: "validate",
      keepStaging: true,
    });
    return;
  }

  const options: ImportOptions = {
    createMissingReferences: confirm.createMissingReferences === true,
    restoreDeleted: false,
  };
  const policies = normalisePolicies(confirm.policies);
  const analysis = await analysePackage(read.result, policies, options);
  const disabled = await disabledImportModules(analysis.entities);
  if (disabled.length > 0) {
    await failTransferJob(job.id, {
      code: TRANSFER_ERROR.module_disabled,
      messageKey: "errors.customerTransfer.moduleDisabled",
      stage: "validate",
      keepStaging: true,
    });
    return;
  }
  if (job.targetFingerprint && analysis.fingerprint !== job.targetFingerprint) {
    await failTransferJob(job.id, {
      code: TRANSFER_ERROR.preview_stale,
      messageKey: "errors.customerTransfer.previewStale",
      stage: "validate",
      keepStaging: true,
    });
    return;
  }
  if (!analysis.canImport) {
    await failTransferJob(job.id, {
      code: TRANSFER_ERROR.conflict,
      messageKey: "errors.customerTransfer.conflict",
      stage: "validate",
      keepStaging: true,
    });
    return;
  }

  await prisma.customerTransferJob.updateMany({
    where: { id: job.id, status: TRANSFER_STATUS.running },
    data: { progressStage: "apply", updatedAt: new Date() },
  });

  const applied = await applyImport({
    actor: await jobActor(job.actorId),
    jobId: job.id,
    read: read.result,
    policies,
    options,
    expectedStatuses: [TRANSFER_STATUS.running],
  });
  if (!applied.ok) {
    await failTransferJob(job.id, {
      code: applied.errors[0]?.code ?? TRANSFER_ERROR.import_failed,
      messageKey:
        applied.errors[0]?.messageKey ??
        "errors.customerTransfer.importFailed",
      stage: "apply",
      keepStaging: true,
    });
    return;
  }

  await removeJobStaging(job.id);
  await prisma.customerTransferJob.updateMany({
    where: { id: job.id, status: TRANSFER_STATUS.completed },
    data: { stagingPath: null },
  });
}

/** Kjører én hentet jobb. Feil oversettes til en stabil FAILED-tilstand. */
export async function processTransferJob(job: TransferJobRow): Promise<void> {
  try {
    if (job.kind === TRANSFER_KIND.export) {
      await processExportJob(job);
    } else if (job.kind === TRANSFER_KIND.import) {
      await processImportJob(job);
    } else {
      await failTransferJob(job.id, {
        code: TRANSFER_ERROR.invalid_job_state,
        messageKey: "errors.customerTransfer.invalidJobState",
        stage: "claim",
        keepStaging: false,
      });
    }
  } catch (error) {
    logger.error("Customer transfer job failed", {
      jobId: job.id,
      kind: job.kind,
      error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
    });
    await failTransferJob(job.id, {
      code:
        job.kind === TRANSFER_KIND.export
          ? TRANSFER_ERROR.export_failed
          : TRANSFER_ERROR.import_failed,
      messageKey:
        job.kind === TRANSFER_KIND.export
          ? "errors.customerTransfer.exportFailed"
          : "errors.customerTransfer.importFailed",
      stage: "worker",
      keepStaging: job.kind === TRANSFER_KIND.import,
    });
  }
}

/** Tømmer køen én gang. Brukes av workeren og av integrasjonstester. */
export async function runTransferQueueOnce(
  limit = 20,
): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const job = await claimNextTransferJob();
    if (!job) break;
    await processTransferJob(job);
    processed += 1;
  }
  return processed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WorkerGlobal = typeof globalThis & {
  __fsmTransferWorkerStarted?: boolean;
};

export function resetTransferWorkerForTests(): void {
  (globalThis as WorkerGlobal).__fsmTransferWorkerStarted = false;
}

/**
 * Starter transferworkeren i denne prosessen. Kalles fra `startJobWorker()`
 * når `transfer`-modulen er på. Egen global markør hindrer dobbeltstart ved
 * HMR og gjentatte kall.
 */
export function startTransferWorker(): void {
  const scope = globalThis as WorkerGlobal;
  if (scope.__fsmTransferWorkerStarted) return;
  scope.__fsmTransferWorkerStarted = true;

  void (async () => {
    await requeueStaleTransferJobs().catch((error) => {
      logger.error("Could not requeue stale customer transfer jobs", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    for (;;) {
      try {
        if (!(await moduleEnabled("transfer"))) {
          await sleep(10_000);
          continue;
        }
        const job = await claimNextTransferJob();
        if (!job) {
          await sleep(3_000);
          continue;
        }
        await processTransferJob(job);
      } catch (error) {
        logger.error("Customer transfer worker loop failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(5_000);
      }
    }
  })();
}
