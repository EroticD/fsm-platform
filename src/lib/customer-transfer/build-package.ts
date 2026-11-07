// i18n-ignore-file: bygger tekniske filer og manifest for en kundepakke.
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { createZip, sha256Hex, type ZipEntryInput } from "@/lib/zip";
import {
  DATA_FILES,
  README_TEXT,
  REFERENCE_FILES,
  TRANSFER_FORMAT,
  TRANSFER_LIMITS,
  TRANSFER_SCHEMA_VERSION,
  type DatasetKey,
} from "./constants";
import { collectExportDataset } from "./export-data";
import {
  buildChecksumsFile,
  manifestChecksum,
  stableJson,
  type TransferManifest,
} from "./manifest";
import { signPackage, transferSigningConfig } from "./signature";
import type {
  AuditSnapshotRow,
  ExportOptions,
  TransferDataset,
  TransferFileEntry,
} from "./types";
import type { TransferIssue } from "./constants";
import { toAuditActor, type ServiceActor } from "@/server/actor";

export type BuiltPackage = {
  buffer: Buffer;
  checksum: string;
  manifest: TransferManifest;
  counts: Record<string, number>;
  warnings: TransferIssue[];
  customerIds: string[];
};

export function instanceId(): string {
  const configured = process.env.FSM_INSTANCE_ID?.trim();
  if (configured) return configured.slice(0, 128);
  return createHash("sha256")
    .update(process.env.NEXTAUTH_URL ?? "fsm-local-installation")
    .digest("hex")
    .slice(0, 24);
}

function appVersion(): string {
  return process.env.npm_package_version ?? "0.8.5";
}

function baseUrl(): string | undefined {
  const value = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  return value && /^https?:\/\//.test(value) ? value : undefined;
}

async function collectAuditSnapshot(
  dataset: TransferDataset,
): Promise<AuditSnapshotRow[]> {
  const ids = new Set<string>();
  const types = new Set<string>();
  for (const [key, rows] of Object.entries(dataset) as Array<
    [string, Array<Record<string, unknown>>]
  >) {
    if (key === "auditSnapshot") continue;
    for (const row of rows) {
      if (typeof row.id === "string") ids.add(row.id);
    }
  }
  types.add("Customer");
  types.add("Contact");
  types.add("CustomerSite");
  types.add("Product");
  types.add("Contract");
  types.add("ContractLine");
  types.add("WorkOrder");
  types.add("Report");
  types.add("Document");
  types.add("DocumentVersion");
  types.add("CustomerAttachment");
  types.add("Upload");
  types.add("Comment");
  types.add("MaintenancePlan");
  types.add("MeterReading");
  if (ids.size === 0) return [];

  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: { in: [...types] },
      entityId: { in: [...ids] },
    },
    orderBy: { seq: "asc" },
    take: TRANSFER_LIMITS.maxAuditRows,
    select: {
      entityType: true,
      entityId: true,
      action: true,
      userName: true,
      actorId: true,
      departmentId: true,
      metadata: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    userName: row.userName,
    actorId: row.actorId,
    departmentId: row.departmentId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }));
}

function countsFor(
  dataset: TransferDataset,
  fileCount: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of Object.keys(DATA_FILES) as DatasetKey[]) {
    counts[key] = dataset[key].length;
  }
  counts.auditRows = dataset.auditSnapshot.length;
  counts.files = fileCount;
  return counts;
}

function referenceRows(dataset: TransferDataset, key: string) {
  return (dataset as unknown as Record<string, unknown[]>)[key] ?? [];
}

/**
 * Bygger hele ZIP-en deterministisk. `exportedAt` settes av jobben, slik at
 * testen kan sammenligne to eksporter av uendrede data ved å se bort fra
 * tidsstempler.
 */
export async function buildCustomerPackage(
  actor: ServiceActor,
  options: ExportOptions,
  exportedAt: Date = new Date(),
): Promise<BuiltPackage> {
  const collected = await collectExportDataset(options);
  const dataset = collected.dataset;

  if (options.includeAudit) {
    dataset.auditSnapshot = await collectAuditSnapshot(dataset);
  }

  const entries: ZipEntryInput[] = [];
  const checksums: Record<string, string> = {};
  let dataBytes = 0;

  for (const key of Object.keys(DATA_FILES) as DatasetKey[]) {
    const json = stableJson(dataset[key]);
    const filePath = `data/${DATA_FILES[key]}.json`;
    dataBytes += json.length;
    checksums[filePath] = sha256Hex(json);
    entries.push({ path: filePath, data: json, modifiedAt: exportedAt });
  }

  for (const key of Object.keys(REFERENCE_FILES) as Array<
    keyof typeof REFERENCE_FILES
  >) {
    const json = stableJson(referenceRows(dataset, key));
    const filePath = `data/${REFERENCE_FILES[key]}.json`;
    dataBytes += json.length;
    checksums[filePath] = sha256Hex(json);
    entries.push({ path: filePath, data: json, modifiedAt: exportedAt });
  }

  // Proveniens: kildeinfo og revisjonssnapshot. Snapshotet ligger både som
  // datafil (for import) og refereres fra provenance/audit.json.
  const sourceInfo = stableJson({
    instanceId: instanceId(),
    appVersion: appVersion(),
    exportedAt: exportedAt.toISOString(),
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    customerIds: [...collected.customerIds].sort(),
    scope: {
      includeFiles: options.includeFiles,
      includeDeleted: options.includeDeleted,
      includeLegalHold: options.includeLegalHold,
      includeAudit: options.includeAudit,
      includeSignatures: options.includeSignatures,
    },
  });
  const sourceInfoPath = "provenance/source-info.json";
  dataBytes += sourceInfo.length;
  checksums[sourceInfoPath] = sha256Hex(sourceInfo);
  entries.push({ path: sourceInfoPath, data: sourceInfo, modifiedAt: exportedAt });

  const auditPath = "data/audit-snapshot.json";
  if (options.includeAudit) {
    const auditJson = stableJson(dataset.auditSnapshot);
    dataBytes += auditJson.length;
    checksums[auditPath] = sha256Hex(auditJson);
    entries.push({ path: auditPath, data: auditJson, modifiedAt: exportedAt });
  }
  const auditPointer = stableJson({
    snapshotPath: options.includeAudit ? auditPath : null,
    snapshotSha256: options.includeAudit ? checksums[auditPath] : null,
    count: dataset.auditSnapshot.length,
    note: "Source audit rows are provenance only; they are not copied into the target audit log.",
  });
  const auditPointerPath = "provenance/audit.json";
  dataBytes += auditPointer.length;
  checksums[auditPointerPath] = sha256Hex(auditPointer);
  entries.push({
    path: auditPointerPath,
    data: auditPointer,
    modifiedAt: exportedAt,
  });

  let fileBytes = 0;
  for (const file of collected.files) {
    fileBytes += file.data.length;
    checksums[file.path] = file.sha256;
    entries.push({ path: file.path, data: file.data, modifiedAt: exportedAt });
  }

  const counts = countsFor(dataset, collected.files.length);
  const source = {
    instanceId: instanceId(),
    appVersion: appVersion(),
    ...(baseUrl() ? { baseUrl: baseUrl() } : {}),
    databaseLabel: process.env.NODE_ENV === "production" ? "production" : "development",
  };
  const scope = {
    customerIds: [...collected.customerIds].sort(),
    includeFiles: options.includeFiles,
    includeDeleted: options.includeDeleted,
    includeLegalHold: options.includeLegalHold,
    includeAudit: options.includeAudit,
    includeSignatures: options.includeSignatures,
  };
  // Deterministisk proveniens-ID. Den avhenger av innholdet som allerede er
  // bygget, ikke av en tilfeldig UUID, slik at to like eksporter får samme ID.
  const packageId = createHash("sha256")
    .update(
      stableJson({
        format: TRANSFER_FORMAT,
        exportedAt: exportedAt.toISOString(),
        source,
        scope,
        counts,
        checksums,
      }),
    )
    .digest("hex")
    .slice(0, 32);

  const signed = Boolean(transferSigningConfig().primary);
  const manifest: TransferManifest = {
    format: TRANSFER_FORMAT,
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    packageId,
    exportedAt: exportedAt.toISOString(),
    source,
    scope,
    counts,
    files: collected.files.map((file) => manifestFileFor(file)),
    checksums,
    totals: {
      dataBytes,
      fileBytes,
      // manifest.json, checksums.sha256, README.txt (+ manifest.sig)
      entries: entries.length + 3 + (signed ? 1 : 0),
    },
  };

  const manifestJson = stableJson(manifest);
  const checksumsFile = buildChecksumsFile(checksums);
  const signature = signPackage(manifestJson, checksumsFile, {
    signedAt: exportedAt,
  });
  entries.push(
    { path: "manifest.json", data: manifestJson, modifiedAt: exportedAt },
    { path: "checksums.sha256", data: checksumsFile, modifiedAt: exportedAt },
    { path: "README.txt", data: Buffer.from(README_TEXT, "utf8"), modifiedAt: exportedAt },
  );
  if (signature) {
    entries.push({
      path: "manifest.sig",
      data: signature,
      modifiedAt: exportedAt,
    });
  }

  const buffer = createZip(entries);
  const checksum = sha256Hex(buffer);

  // Selve eksporten logges i en egen transaksjon etter at pakken er bygget.
  // Metadata inneholder bare id-er, antall, sjekksum og schema – ingen navn,
  // filnavn eller innhold.
  await prisma.$transaction(async (tx) => {
    await audit(tx, {
      entityType: "CustomerTransfer",
      entityId: `export:${checksum.slice(0, 16)}`,
      action: `Eksporterte kundepakke: ${checksum.slice(0, 12)}`,
      actor: toAuditActor(actor),
      metadata: {
        kind: "EXPORT",
        checksumPrefix: checksum.slice(0, 16),
        schemaVersion: TRANSFER_SCHEMA_VERSION,
        sourceInstanceId: instanceId(),
        customerCount: collected.customerIds.length,
        counts,
        manifestChecksum: manifestChecksum(manifest),
        warnings: collected.warnings.length,
      },
    });
  });

  return {
    buffer,
    checksum,
    manifest,
    counts,
    warnings: collected.warnings,
    customerIds: collected.customerIds,
  };
}

function manifestFileFor(file: TransferFileEntry) {
  return {
    path: file.path,
    sha256: file.sha256,
    size: file.size,
    mimeType: file.mimeType,
    kind: file.kind,
    ...(file.originalName ? { originalName: file.originalName } : {}),
    ...(file.sourceUrl ? { sourceUrl: file.sourceUrl } : {}),
    ...(file.sourceEntityType ? { sourceEntityType: file.sourceEntityType } : {}),
    ...(file.sourceEntityId ? { sourceEntityId: file.sourceEntityId } : {}),
    ...(file.references ? { references: file.references } : {}),
  };
}
