// i18n-ignore-file: tjenestelaget bruker stabile feilkoder, ikke UI-tekst.
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { sha256Hex } from "@/lib/zip";
import {
  DEFAULT_POLICIES,
  TRANSFER_ERROR,
  TRANSFER_KIND,
  TRANSFER_LIMITS,
  TRANSFER_STATUS,
  normalisePolicies,
  type ConflictPolicies,
  type TransferIssue,
} from "@/lib/customer-transfer/constants";
import { buildCustomerPackage } from "@/lib/customer-transfer/build-package";
import { readPackage, type PackageReadOutcome } from "@/lib/customer-transfer/read-package";
import { analysePackage } from "@/lib/customer-transfer/analyse";
import { applyImport } from "@/lib/customer-transfer/apply-import";
import {
  abortJob,
  cleanupExpiredTransfers,
  createTransferJob,
  findJobForActor,
  isJobExpired,
  previewToken,
  previewTokenValid,
  readStagedPackage,
  removeJobStaging,
  writeStagedPackage,
} from "@/lib/customer-transfer/jobs";
import { canUseCustomerTransfer } from "@/lib/customer-transfer/guard";
import type {
  ExportOptions,
  ImportOptions,
  ImportPreview,
} from "@/lib/customer-transfer/types";
import { toAuditActor, type ServiceActor } from "./actor";

export type TransferFailure = {
  ok: false;
  status: number;
  code: string;
  messageKey: string;
  errors?: TransferIssue[];
};

export type TransferResult<T> = { ok: true; data: T } | TransferFailure;

function failure(
  status: number,
  code: string,
  messageKey: string,
  errors?: TransferIssue[],
): TransferFailure {
  return { ok: false, status, code, messageKey, ...(errors ? { errors } : {}) };
}

function forbidden(): TransferFailure {
  return failure(403, TRANSFER_ERROR.forbidden, "errors.customerTransfer.forbidden");
}

function notFound(): TransferFailure {
  return failure(404, TRANSFER_ERROR.not_found, "errors.customerTransfer.notFound");
}

function assertAdmin(actor: ServiceActor): TransferFailure | null {
  return canUseCustomerTransfer(actor) ? null : forbidden();
}

export type JobView = {
  id: string;
  kind: string;
  status: string;
  checksumPrefix: string | null;
  schemaVersion: string | null;
  sourceInstanceId: string | null;
  counts: unknown;
  errors: unknown;
  result: unknown;
  progressStage: string | null;
  progressProcessed: number;
  progressTotal: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};

function jobView(job: Awaited<ReturnType<typeof findJobForActor>>): JobView | null {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    checksumPrefix: job.packageChecksum?.slice(0, 16) ?? null,
    schemaVersion: job.schemaVersion,
    sourceInstanceId: job.sourceInstanceId,
    counts: job.countsJson,
    errors: job.errorJson,
    result: job.resultJson,
    progressStage: job.progressStage,
    progressProcessed: job.progressProcessed,
    progressTotal: job.progressTotal,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
  };
}

export function exportFileName(checksum: string, now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-")
    .slice(0, 15);
  return `fsm-customer-export-${stamp}-${checksum.slice(0, 8)}.zip`;
}

/**
 * Starter en eksport. Selve pakkebyggingen er synkron i v1, men tilstanden
 * lagres i `CustomerTransferJob` slik at nedlasting og opprydding er varig.
 */
export async function exportCustomerPackage(
  actor: ServiceActor,
  input: {
    customerIds: string[];
    includeFiles?: boolean;
    includeDeleted?: boolean;
    includeLegalHold?: boolean;
    includeAudit?: boolean;
    includeSignatures?: boolean;
  },
): Promise<TransferResult<JobView & { downloadUrl: string; fileName: string }>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;

  const customerIds = [...new Set(input.customerIds.filter(Boolean))];
  if (customerIds.length === 0) {
    return failure(400, "validation_error", "errors.customerTransfer.noCustomers");
  }
  if (customerIds.length > TRANSFER_LIMITS.maxCustomers) {
    return failure(400, "validation_error", "errors.customerTransfer.tooManyCustomers");
  }

  const options: ExportOptions = {
    customerIds,
    includeFiles: input.includeFiles ?? true,
    includeDeleted: input.includeDeleted ?? false,
    includeLegalHold: input.includeLegalHold ?? false,
    includeAudit: input.includeAudit ?? true,
    includeSignatures: input.includeSignatures ?? false,
  };

  const exportedAt = new Date();
  const job = await createTransferJob({
    actorId: actor.id,
    kind: TRANSFER_KIND.export,
    status: TRANSFER_STATUS.pending,
    customerIds,
    expiresAt: new Date(exportedAt.getTime() + TRANSFER_LIMITS.exportTtlMs),
  });

  try {
    const built = await buildCustomerPackage(actor, options, exportedAt);
    if (built.customerIds.length === 0) {
      await failsafeJob(job.id);
      return failure(404, "not_found", "errors.customerTransfer.customerNotFound");
    }
    const stagingPath = await writeStagedPackage(job.id, built.buffer);
    const expiresAt = new Date(Date.now() + TRANSFER_LIMITS.exportTtlMs);
    await prisma.customerTransferJob.update({
      where: { id: job.id },
      data: {
        status: TRANSFER_STATUS.ready,
        packageChecksum: built.checksum,
        sourceInstanceId: built.manifest.source.instanceId,
        schemaVersion: built.manifest.schemaVersion,
        countsJson: built.counts,
        resultJson: {
          warnings: built.warnings.length,
          customerCount: built.customerIds.length,
          manifestChecksum: sha256Hex(Buffer.from(JSON.stringify(built.manifest), "utf8")),
        },
        stagingPath,
        expiresAt,
        progressStage: "ready",
        progressProcessed: built.counts.files ?? 0,
        progressTotal: built.counts.files ?? 0,
        completedAt: new Date(),
      },
    });

    const fresh = await findJobForActor(job.id, actor.id);
    const view = jobView(fresh);
    if (!view) return notFound();
    return {
      ok: true,
      data: {
        ...view,
        downloadUrl: `/api/innstillinger/kunder/eksport/${job.id}/download`,
        fileName: exportFileName(built.checksum, exportedAt),
      },
    };
  } catch {
    await failsafeJob(job.id);
    return failure(500, TRANSFER_ERROR.import_failed, "errors.customerTransfer.exportFailed");
  }
}

async function failsafeJob(jobId: string) {
  await removeJobStaging(jobId);
  await prisma.customerTransferJob
    .update({
      where: { id: jobId },
      data: {
        status: TRANSFER_STATUS.failed,
        stagingPath: null,
        completedAt: new Date(),
      },
    })
    .catch(() => undefined);
}

export async function getTransferJob(
  actor: ServiceActor,
  jobId: string,
): Promise<TransferResult<JobView>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  const job = await findJobForActor(jobId, actor.id);
  if (!job) return notFound();
  const view = jobView(job);
  if (!view) return notFound();
  return { ok: true, data: view };
}

export type DownloadResult = {
  buffer: Buffer;
  fileName: string;
  checksum: string;
};

export async function downloadExportPackage(
  actor: ServiceActor,
  jobId: string,
): Promise<TransferResult<DownloadResult>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  const job = await findJobForActor(jobId, actor.id);
  if (!job || job.kind !== TRANSFER_KIND.export) return notFound();
  if (job.status !== TRANSFER_STATUS.ready) {
    return failure(410, TRANSFER_ERROR.job_expired, "errors.customerTransfer.jobExpired");
  }
  if (isJobExpired(job)) {
    await failsafeJob(job.id);
    return failure(410, TRANSFER_ERROR.job_expired, "errors.customerTransfer.jobExpired");
  }
  const buffer = await readStagedPackage(job.id);
  if (!buffer || !job.packageChecksum) {
    return failure(410, TRANSFER_ERROR.job_expired, "errors.customerTransfer.jobExpired");
  }
  // Sjekksummen kontrolleres på nytt før filen forlater serveren.
  const actual = sha256Hex(buffer);
  if (actual !== job.packageChecksum) {
    return failure(500, TRANSFER_ERROR.checksum_mismatch, "errors.customerTransfer.checksumMismatch");
  }

  await prisma.$transaction(async (tx) => {
    await audit(tx, {
      entityType: "CustomerTransfer",
      entityId: job.id,
      action: `Lastet ned kundepakke: ${job.packageChecksum?.slice(0, 12)}`,
      actor: toAuditActor(actor),
      metadata: {
        kind: "EXPORT_DOWNLOAD",
        jobId: job.id,
        checksumPrefix: job.packageChecksum?.slice(0, 16) ?? null,
      },
    });
  });

  return {
    ok: true,
    data: {
      buffer,
      fileName: exportFileName(job.packageChecksum),
      checksum: job.packageChecksum,
    },
  };
}

export async function abortTransferJob(
  actor: ServiceActor,
  jobId: string,
): Promise<TransferResult<{ aborted: true }>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  const job = await findJobForActor(jobId, actor.id);
  if (!job) return notFound();
  if (job.status === TRANSFER_STATUS.completed) {
    return failure(409, TRANSFER_ERROR.conflict, "errors.customerTransfer.alreadyCompleted");
  }
  await abortJob(job.id);
  return { ok: true, data: { aborted: true } };
}

/**
 * Tar imot en ZIP som allerede er begrenset av ruten, lagrer den i staging og
 * oppretter en importjobb. Ingen parsing eller DB-skriving av kundedata skjer
 * før dry-run/confirm.
 */
export async function createImportJob(
  actor: ServiceActor,
  buffer: Buffer,
  _fileName: string,
): Promise<TransferResult<JobView>> {
  // Filnavnet logges/lagres bevisst ikke: det kan inneholde personopplysninger.
  void _fileName;
  const denied = assertAdmin(actor);
  if (denied) return denied;
  if (!buffer.length) {
    return failure(400, "invalid_request", "errors.customerTransfer.emptyPackage");
  }
  if (buffer.length > TRANSFER_LIMITS.maxPackageBytes) {
    return failure(413, TRANSFER_ERROR.package_too_large, "errors.customerTransfer.packageTooLarge");
  }
  // Et ekte ZIP-arkiv starter med PK. Dette er bare en tidlig avvisning;
  // full strukturkontroll skjer i dry-run.
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    (buffer[2] !== 0x03 && buffer[2] !== 0x05 && buffer[2] !== 0x07)
  ) {
    return failure(415, TRANSFER_ERROR.invalid_manifest, "errors.customerTransfer.invalidManifest");
  }
  const checksum = sha256Hex(buffer);
  const job = await createTransferJob({
    actorId: actor.id,
    kind: TRANSFER_KIND.import,
    status: TRANSFER_STATUS.staged,
    packageChecksum: checksum,
    expiresAt: new Date(Date.now() + TRANSFER_LIMITS.exportTtlMs),
  });
  try {
    const stagingPath = await writeStagedPackage(job.id, buffer);
    await prisma.customerTransferJob.update({
      where: { id: job.id },
      data: {
        stagingPath,
        // Bare størrelse – opprinnelig filnavn kan inneholde personopplysninger.
        resultJson: { size: buffer.length },
        progressStage: "staged",
      },
    });
    const fresh = await findJobForActor(job.id, actor.id);
    const view = jobView(fresh);
    if (!view) return notFound();
    return { ok: true, data: view };
  } catch {
    await failsafeJob(job.id);
    return failure(500, TRANSFER_ERROR.import_failed, "errors.customerTransfer.importFailed");
  }
}

function toPreview(
  jobId: string,
  read: Extract<PackageReadOutcome, { ok: true }>,
  analysis: Awaited<ReturnType<typeof analysePackage>>,
  token?: string,
  expiresAt?: Date,
): ImportPreview {
  return {
    jobId,
    package: {
      schemaVersion: read.result.manifest.schemaVersion,
      sourceInstanceId: read.result.manifest.source.instanceId,
      checksum: read.result.checksum,
      exportedAt: read.result.manifest.exportedAt,
      appVersion: read.result.manifest.source.appVersion,
    },
    customers: analysis.customers,
    entities: analysis.entities,
    counts: analysis.counts,
    warnings: [...analysis.warnings, ...read.result.warnings],
    errors: analysis.errors,
    canImport: analysis.canImport,
    ...(token ? { previewToken: token } : {}),
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  };
}

/** Kjører en dry-run: validerer pakken og beregner handlinger uten skriving. */
export async function dryRunImport(
  actor: ServiceActor,
  jobId: string,
  input: { createMissingReferences?: boolean } = {},
): Promise<TransferResult<ImportPreview>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  const job = await findJobForActor(jobId, actor.id);
  if (!job || job.kind !== TRANSFER_KIND.import) return notFound();
  if (isJobExpired(job)) {
    await failsafeJob(job.id);
    return failure(410, TRANSFER_ERROR.job_expired, "errors.customerTransfer.jobExpired");
  }
  if (
    job.status !== TRANSFER_STATUS.staged &&
    job.status !== TRANSFER_STATUS.dryRun &&
    job.status !== TRANSFER_STATUS.failed
  ) {
    return failure(409, TRANSFER_ERROR.conflict, "errors.customerTransfer.invalidJobState");
  }

  const buffer = await readStagedPackage(job.id);
  if (!buffer) return failure(410, TRANSFER_ERROR.job_expired, "errors.customerTransfer.jobExpired");

  const read = readPackage(buffer);
  const options: ImportOptions = {
    createMissingReferences: Boolean(input.createMissingReferences),
    restoreDeleted: false,
  };
  if (!read.ok) {
    await prisma.customerTransferJob.update({
      where: { id: job.id },
      data: {
        status: TRANSFER_STATUS.dryRun,
        errorJson: read.errors,
        countsJson: { create: 0, skip: 0, update: 0, conflict: 0, invalid: read.errors.length },
        resultJson: { canImport: false, createMissingReferences: options.createMissingReferences },
        progressStage: "validated",
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + TRANSFER_LIMITS.exportTtlMs),
      },
    });
    return {
      ok: true,
      data: {
        jobId: job.id,
        package: {
          schemaVersion: job.schemaVersion ?? "unknown",
          sourceInstanceId: job.sourceInstanceId ?? "",
          checksum: job.packageChecksum ?? "",
          exportedAt: job.createdAt.toISOString(),
          appVersion: "unknown",
        },
        customers: [],
        entities: [],
        counts: { create: 0, skip: 0, update: 0, conflict: 0, invalid: read.errors.length },
        warnings: [],
        errors: read.errors,
        canImport: false,
      },
    };
  }

  const analysis = await analysePackage(read.result, DEFAULT_POLICIES, options);
  const token = previewToken();
  const previewExpiresAt = new Date(Date.now() + TRANSFER_LIMITS.previewTtlMs);
  await prisma.customerTransferJob.update({
    where: { id: job.id },
    data: {
      status: TRANSFER_STATUS.dryRun,
      packageChecksum: read.result.checksum,
      sourceInstanceId: read.result.manifest.source.instanceId,
      schemaVersion: read.result.manifest.schemaVersion,
      customerIdsJson: read.result.manifest.scope.customerIds,
      countsJson: analysis.counts,
      errorJson: analysis.errors,
      targetFingerprint: analysis.fingerprint,
      previewTokenHash: token.hash,
      previewExpiresAt,
      resultJson: {
        canImport: analysis.canImport,
        warnings: analysis.warnings.length + read.result.warnings.length,
        createMissingReferences: options.createMissingReferences,
      },
      progressStage: "preview",
      progressProcessed: analysis.entities.length,
      progressTotal: analysis.entities.length,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + TRANSFER_LIMITS.exportTtlMs),
    },
  });

  return {
    ok: true,
    data: toPreview(job.id, read, analysis, token.token, previewExpiresAt),
  };
}

export async function confirmImport(
  actor: ServiceActor,
  jobId: string,
  input: {
    previewToken: string;
    policies: unknown;
    createMissingReferences?: boolean;
    confirmation: boolean;
  },
): Promise<
  TransferResult<{
    jobId: string;
    counts: Record<string, number>;
    warnings: number;
    customers: number;
    status: string;
  }>
> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  if (input.confirmation !== true) {
    return failure(400, "validation_error", "errors.customerTransfer.confirmationRequired");
  }
  const job = await findJobForActor(jobId, actor.id);
  if (!job || job.kind !== TRANSFER_KIND.import) return notFound();
  if (job.status === TRANSFER_STATUS.completed) {
    return failure(409, TRANSFER_ERROR.conflict, "errors.customerTransfer.alreadyCompleted");
  }
  if (job.status !== TRANSFER_STATUS.dryRun) {
    return failure(409, TRANSFER_ERROR.conflict, "errors.customerTransfer.dryRunRequired");
  }
  if (isJobExpired(job)) {
    await failsafeJob(job.id);
    return failure(410, TRANSFER_ERROR.job_expired, "errors.customerTransfer.jobExpired");
  }
  if (!job.packageChecksum || !previewTokenValid(job, input.previewToken, job.packageChecksum)) {
    return failure(
      409,
      TRANSFER_ERROR.preview_expired,
      "errors.customerTransfer.previewExpired",
    );
  }

  const buffer = await readStagedPackage(job.id);
  if (!buffer) return failure(410, TRANSFER_ERROR.job_expired, "errors.customerTransfer.jobExpired");
  const read = readPackage(buffer);
  if (!read.ok) {
    return failure(422, TRANSFER_ERROR.invalid_manifest, "errors.customerTransfer.invalidManifest", read.errors);
  }
  if (read.result.checksum !== job.packageChecksum) {
    return failure(
      409,
      TRANSFER_ERROR.checksum_mismatch,
      "errors.customerTransfer.checksumMismatch",
    );
  }

  const policies = normalisePolicies(input.policies);
  const previewedReferences =
    (job.resultJson as { createMissingReferences?: unknown } | null)
      ?.createMissingReferences === true;
  if (previewedReferences !== Boolean(input.createMissingReferences)) {
    return failure(
      409,
      TRANSFER_ERROR.preview_stale,
      "errors.customerTransfer.previewStale",
    );
  }
  const options: ImportOptions = {
    createMissingReferences: previewedReferences,
    restoreDeleted: false,
  };
  const freshAnalysis = await analysePackage(read.result, policies, options);
  if (
    job.targetFingerprint &&
    freshAnalysis.fingerprint !== job.targetFingerprint
  ) {
    return failure(
      409,
      TRANSFER_ERROR.preview_stale,
      "errors.customerTransfer.previewStale",
    );
  }
  if (!freshAnalysis.canImport) {
    return failure(
      422,
      TRANSFER_ERROR.conflict,
      "errors.customerTransfer.conflict",
      freshAnalysis.errors,
    );
  }

  const applied = await applyImport({
    actor,
    jobId: job.id,
    read: read.result,
    policies,
    options,
  });
  if (!applied.ok) {
    const conflict = applied.errors.some(
      (error) => error.code === TRANSFER_ERROR.conflict,
    );
    return failure(
      conflict ? 409 : 500,
      conflict ? TRANSFER_ERROR.conflict : TRANSFER_ERROR.import_failed,
      conflict
        ? "errors.customerTransfer.alreadyCompleted"
        : "errors.customerTransfer.importFailed",
      applied.errors,
    );
  }

  await removeJobStaging(job.id);
  await prisma.customerTransferJob.update({
    where: { id: job.id },
    data: { stagingPath: null, previewTokenHash: null, previewExpiresAt: null },
  });

  return {
    ok: true,
    data: {
      jobId: job.id,
      counts: applied.counts,
      warnings: freshAnalysis.warnings.length,
      customers: freshAnalysis.customers.length,
      status: TRANSFER_STATUS.completed,
    },
  };
}

export async function getImportPreview(
  actor: ServiceActor,
  jobId: string,
): Promise<TransferResult<ImportPreview>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  const job = await findJobForActor(jobId, actor.id);
  if (!job || job.kind !== TRANSFER_KIND.import) return notFound();
  if (!job.schemaVersion || !job.sourceInstanceId) {
    return failure(409, TRANSFER_ERROR.conflict, "errors.customerTransfer.dryRunRequired");
  }
  const counts = (job.countsJson ?? {}) as Record<string, number>;
  return {
    ok: true,
    data: {
      jobId: job.id,
      package: {
        schemaVersion: job.schemaVersion,
        sourceInstanceId: job.sourceInstanceId,
        checksum: job.packageChecksum ?? "",
        exportedAt: job.createdAt.toISOString(),
        appVersion: "unknown",
      },
      customers: [],
      entities: [],
      counts,
      warnings: [],
      errors: (job.errorJson as TransferIssue[] | null) ?? [],
      canImport:
        job.status === TRANSFER_STATUS.dryRun &&
        ((job.errorJson as TransferIssue[] | null)?.length ?? 0) === 0,
      expiresAt: job.previewExpiresAt?.toISOString(),
    },
  };
}

export async function getImportReport(
  actor: ServiceActor,
  jobId: string,
): Promise<TransferResult<{ job: JobView; historical: unknown[] }>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  const job = await findJobForActor(jobId, actor.id);
  if (!job || job.kind !== TRANSFER_KIND.import) return notFound();
  const view = jobView(job);
  if (!view) return notFound();
  const records = await prisma.customerTransferRecord.findMany({
    where: { jobId: job.id },
    select: {
      sourceEntityType: true,
      sourceId: true,
      targetEntityType: true,
      targetId: true,
      action: true,
    },
    orderBy: { createdAt: "asc" },
    take: 20_000,
  });
  // Bare id-er/typer – ingen kundenavn eller innhold.
  return { ok: true, data: { job: view, historical: records } };
}

export async function cleanupTransfers(): Promise<number> {
  return cleanupExpiredTransfers();
}

export type TransferCustomerOption = {
  id: string;
  name: string;
  customerNumber: string | null;
  orgNumber: string | null;
};

/** Begrenset kundeliste til eksportvelgeren. Ingen kontakter eller PII utover navn. */
export async function listTransferCustomers(
  actor: ServiceActor,
): Promise<TransferResult<TransferCustomerOption[]>> {
  const denied = assertAdmin(actor);
  if (denied) return denied;
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      customerNumber: true,
      orgNumber: true,
    },
  });
  return { ok: true, data: customers };
}

export { DEFAULT_POLICIES, type ConflictPolicies };
