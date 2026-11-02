// i18n-ignore-file: arkivinnhold og revisjonshandlinger er data, ikke UI.
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { computeAuditHash, stableJson } from "@/lib/audit-chain";
import {
  archiveSigningKey,
  buildArchive,
  verifyArchive,
  type ArchiveManifest,
  type ArchiveMissingFile,
  type ArchiveVerification,
} from "@/lib/archive-manifest";
import { uploadDir } from "@/lib/uploads";
import { sha256Hex } from "@/lib/zip";
import {
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

export type EvidenceExportData = {
  buffer: Buffer;
  manifest: ArchiveManifest;
  fileName: string;
};

export type EvidenceCandidate = {
  id: string;
  reference: string;
  title: string;
  scheduledFor: Date | null;
  customerName: string | null;
};

const MAX_LEGACY_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const UPLOAD_URL = /^\/uploads\/([A-Za-z0-9._-]+)$/;

/** Bare filer helt øverst i opplastingsmappen, uten sti eller `..`. */
export function storedNameFromUploadUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const match = UPLOAD_URL.exec(url.trim());
  if (!match) return null;
  const name = match[1];
  if (name === "." || name === ".." || name.length > 255) return null;
  return name;
}

function safeArchiveName(name: string, fallback: string): string {
  const base = path
    .basename(name)
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return base || fallback;
}

function resolveUploadFile(storedName: string): string | null {
  const root = path.resolve(uploadDir());
  const filePath = path.resolve(root, storedName);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

type EvidenceFile = {
  path: string;
  data: Buffer;
  kind: string;
};

type CollectedFiles = {
  files: EvidenceFile[];
  missing: ArchiveMissingFile[];
};

type UploadRow = {
  id: string;
  storedName: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: Date;
};

/**
 * Leser alle filer som hører til oppdraget gjennom samme opplastingsmappe og
 * `Upload`-metadata som `/uploads` bruker. En manglende fil stopper ikke hele
 * bevispakken; den registreres i manifestet med årsak, slik at en administrator
 * ser at beviset er ufullstendig.
 */
async function collectWorkOrderFiles(
  workOrderId: string,
  attachments: readonly { id: string; fileName: string; dataUrl: string }[],
  referencedUrls: readonly (string | null | undefined)[],
): Promise<CollectedFiles> {
  const uploads = (await prisma.upload.findMany({
    where: { ownerType: "WORK_ORDER", ownerId: workOrderId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      storedName: true,
      originalName: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
  })) as UploadRow[];
  const byStoredName = new Map(uploads.map((upload) => [upload.storedName, upload]));

  const referencedNames = [
    ...new Set(
      referencedUrls
        .map((url) => storedNameFromUploadUrl(url))
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const extraRows = referencedNames
    .filter((name) => !byStoredName.has(name))
    .map((name) => ({
      id: name,
      storedName: name,
      originalName: name,
      mimeType: "application/octet-stream",
      size: 0,
      createdAt: new Date(0),
    })) as UploadRow[];

  const files: EvidenceFile[] = [];
  const missing: ArchiveMissingFile[] = [];
  const seen = new Set<string>();

  for (const upload of [...uploads, ...extraRows]) {
    if (seen.has(upload.storedName)) continue;
    seen.add(upload.storedName);

    const safeName = safeArchiveName(
      upload.originalName,
      upload.storedName || "fil",
    );
    const archivePath = `files/${safeArchiveName(upload.storedName, "fil")}-${safeName}`;
    const filePath = resolveUploadFile(upload.storedName);
    if (!filePath) {
      missing.push({ path: archivePath, reason: "unsafe_path" });
      continue;
    }

    try {
      const data = await fs.readFile(filePath);
      files.push({ path: archivePath, data, kind: "attachment" });
    } catch {
      missing.push({ path: archivePath, reason: "file_not_found" });
    }
  }

  // Eldre vedlegg kan ligge som data-URL i selve raden i stedet for på disk.
  for (const attachment of attachments) {
    if (!attachment.dataUrl?.startsWith("data:")) continue;
    const match = /^data:([\w/+.-]+);base64,([A-Za-z\d+/=\s]+)$/i.exec(
      attachment.dataUrl,
    );
    const archivePath = `attachments/${attachment.id}-${safeArchiveName(
      attachment.fileName,
      "vedlegg",
    )}`;
    if (!match) {
      missing.push({ path: archivePath, reason: "unsupported_attachment" });
      continue;
    }
    const data = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (data.length > MAX_LEGACY_ATTACHMENT_BYTES) {
      missing.push({ path: archivePath, reason: "too_large" });
      continue;
    }
    files.push({ path: archivePath, data, kind: "attachment" });
  }

  return { files, missing };
}

/** Oppdrag administrator kan velge i bevis-eksporten. */
export async function listEvidenceCandidates(
  actor: ServiceActor,
): Promise<ServiceResult<EvidenceCandidate[]>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  const rows = await prisma.workOrder.findMany({
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      reference: true,
      title: true,
      scheduledFor: true,
      customer: { select: { name: true } },
    },
  });
  return ok(
    rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      title: row.title,
      scheduledFor: row.scheduledFor,
      customerName: row.customer?.name ?? null,
    })),
  );
}

type EvidenceAuditRow = {
  id: string;
  seq: number;
  entityType: string;
  entityId: string;
  action: string;
  userName: string;
  actorId: string | null;
  departmentId: string | null;
  metadata: unknown;
  prevHash: string | null;
  hash: string | null;
  createdAt: Date;
};

function evidenceFileName(reference: string, date: Date): string {
  const safeReference = reference.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  return `bevis-${safeReference || "oppdrag"}-${stamp.slice(0, 8)}-${stamp.slice(9, 15)}.zip`;
}

/**
 * Bygger en bevispakke for ett oppdrag: oppdrag, kunde, rapporter med
 * revisjoner, vedlegg/signaturer og relevante revisjonslogger.
 *
 * Pakken er administratoreksport. Den inneholder ingen passord, nøkler eller
 * absolutte stier, og leser bare filer gjennom opplastingsmappens trygge
 * oppslag. Eksporten logges selv i revisjonsloggen.
 */
export async function exportEvidenceArchive(
  actor: ServiceActor,
  workOrderId: string,
): Promise<ServiceResult<EvidenceExportData>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workOrderId)) return fail("invalid");

  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      department: { select: { id: true, name: true } },
      customer: true,
      contact: true,
      attachments: true,
      reports: {
        include: {
          units: { orderBy: { sortOrder: "asc" } },
          revisions: { orderBy: { revision: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!workOrder) return fail("not_found");

  const reportIds = workOrder.reports.map((report) => report.id);
  const auditRows = (await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "WorkOrder", entityId: workOrder.id },
        ...(reportIds.length
          ? [{ entityType: "Report", entityId: { in: reportIds } }]
          : []),
      ],
    },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      entityType: true,
      entityId: true,
      action: true,
      userName: true,
      actorId: true,
      departmentId: true,
      metadata: true,
      prevHash: true,
      hash: true,
      createdAt: true,
    },
  })) as EvidenceAuditRow[];

  const referencedUrls: (string | null | undefined)[] = [
    ...workOrder.attachments.map((attachment) => attachment.dataUrl),
  ];
  for (const report of workOrder.reports) {
    referencedUrls.push(
      report.technicianSignatureUrl,
      report.customerSignatureUrl,
      report.pdfUrl,
    );
    for (const revision of report.revisions) {
      referencedUrls.push(
        revision.technicianSignatureUrl,
        revision.customerSignatureUrl,
      );
    }
  }

  const { files, missing } = await collectWorkOrderFiles(
    workOrder.id,
    workOrder.attachments,
    referencedUrls,
  );

  const { reports, attachments, ...order } = workOrder;
  files.push(
    {
      path: "work-order.json",
      data: Buffer.from(`${JSON.stringify(order, null, 2)}\n`, "utf8"),
      kind: "work-order",
    },
    {
      path: "audit/audit.jsonl",
      data: Buffer.from(
        auditRows
          .map((row) =>
            stableJson({
              ...row,
              createdAt:
                row.createdAt instanceof Date
                  ? row.createdAt.toISOString()
                  : row.createdAt,
            }),
          )
          .join("\n") + (auditRows.length ? "\n" : ""),
        "utf8",
      ),
      kind: "audit",
    },
  );

  if (workOrder.customer) {
    files.push({
      path: "customer.json",
      data: Buffer.from(
        `${JSON.stringify(workOrder.customer, null, 2)}\n`,
        "utf8",
      ),
      kind: "customer",
    });
  }

  for (const report of reports) {
    const { revisions, units, ...reportData } = report;
    files.push({
      path: `reports/${report.id}.json`,
      data: Buffer.from(
        `${JSON.stringify({ ...reportData, units }, null, 2)}\n`,
        "utf8",
      ),
      kind: "report",
    });
    for (const revision of revisions) {
      files.push({
        path: `reports/${report.id}/revisions/${revision.revision}.json`,
        data: Buffer.from(`${JSON.stringify(revision, null, 2)}\n`, "utf8"),
        kind: "revision",
      });
    }
  }

  const auditHashesOk = auditRows.every((row) => {
    if (!row.hash) return false;
    return (
      computeAuditHash(
        {
          entityType: row.entityType,
          entityId: row.entityId,
          action: row.action,
          userName: row.userName,
          actorId: row.actorId,
          departmentId: row.departmentId,
          metadata: row.metadata,
          createdAt: row.createdAt,
        },
        row.prevHash,
      ) === row.hash
    );
  });

  const readme = [
    "FSM bevispakke",
    "",
    `Oppdrag: ${workOrder.reference} – ${workOrder.title}`,
    "",
    "Arkivet inneholder oppdrag, kunde, rapporter, revisjoner, vedlegg og",
    "relevante revisjonslogger. manifest.json har SHA-256 for hver fil.",
    "manifest.sha256 forsegler manifestet. Manglende filer står i manifestets",
    "missing-liste med årsak.",
    "",
    "Verifiser offline:",
    "  sha256sum -c manifest.sha256",
    "  # Sammenlign deretter hver fil i manifest.json med sha256sum <fil>",
    "",
    "Pakken kan inneholde personopplysninger og skal behandles konfidensielt.",
    "",
  ].join("\n");
  files.push({
    path: "README.txt",
    data: Buffer.from(readme, "utf8"),
    kind: "readme",
  });

  const generatedAt = new Date();
  const built = buildArchive({
    kind: "work-order-evidence",
    files,
    missing,
    metadata: {
      workOrderId: workOrder.id,
      reference: workOrder.reference,
      departmentId: workOrder.departmentId,
      exportedBy: { id: actor.id, name: actor.name },
      audit: {
        rowCount: auditRows.length,
        hashesOk: auditHashesOk,
        firstHash: auditRows[0]?.hash ?? null,
        lastHash: auditRows[auditRows.length - 1]?.hash ?? null,
      },
      attachments: attachments.length,
      signatureAlgorithm: archiveSigningKey() ? "hmac-sha256" : null,
    },
    signingKey: archiveSigningKey(),
    generatedAt,
  });

  await prisma.$transaction(async (tx) => {
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: workOrder.id,
      action:
        `Eksporterte bevispakke for oppdraget «${workOrder.title}» ` +
        `(${files.length} filer, ${missing.length} manglende)`,
      actor: toAuditActor(actor),
      departmentId: workOrder.departmentId,
      metadata: {
        reference: workOrder.reference,
        files: files.length,
        missing: missing.length,
        reports: reports.length,
        revisions: reports.reduce(
          (sum, report) => sum + report.revisions.length,
          0,
        ),
        auditRows: auditRows.length,
        manifestSha256: sha256Hex(
          Buffer.from(`${JSON.stringify(built.manifest, null, 2)}\n`, "utf8"),
        ),
      },
    });
  });

  return ok({
    buffer: built.buffer,
    manifest: built.manifest,
    fileName: evidenceFileName(workOrder.reference, generatedAt),
  });
}

export type EvidenceArchiveVerification = ArchiveVerification & {
  workOrderId: string | null;
  auditRowsChecked: number;
  auditHashesOk: boolean;
};

/** Verifiserer filhashlene og hver enkelt revisjonsrads hash i pakken. */
export function verifyEvidenceArchive(
  buffer: Buffer,
  options: { signingKey?: string | null } = {},
): EvidenceArchiveVerification {
  const verified = verifyArchive(buffer, options);
  const manifest = verified.manifest;
  const workOrderId =
    typeof manifest?.workOrderId === "string" ? manifest.workOrderId : null;
  const auditEntry = verified.entries.find(
    (entry) => entry.path === "audit/audit.jsonl",
  );
  if (!auditEntry) {
    return {
      ...verified,
      ok: false,
      errors: [...verified.errors, "Arkivet mangler audit/audit.jsonl"],
      workOrderId,
      auditRowsChecked: 0,
      auditHashesOk: false,
    };
  }

  const errors = [...verified.errors];
  let checked = 0;
  let hashesOk = true;
  for (const line of auditEntry.data.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let row: EvidenceAuditRow;
    try {
      row = JSON.parse(line) as EvidenceAuditRow;
    } catch {
      errors.push("audit/audit.jsonl inneholder ugyldig JSON");
      hashesOk = false;
      break;
    }
    checked += 1;
    const expected = row.hash
      ? computeAuditHash(
          {
            entityType: row.entityType,
            entityId: row.entityId,
            action: row.action,
            userName: row.userName,
            actorId: row.actorId,
            departmentId: row.departmentId,
            metadata: row.metadata,
            createdAt: row.createdAt,
          },
          row.prevHash,
        )
      : null;
    if (!row.hash || expected !== row.hash) {
      errors.push(`Revisjonsrad ${row.id} har feil hash`);
      hashesOk = false;
    }
  }

  return {
    ...verified,
    ok: errors.length === 0,
    errors,
    workOrderId,
    auditRowsChecked: checked,
    auditHashesOk: hashesOk,
  };
}
