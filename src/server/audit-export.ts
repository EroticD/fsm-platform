// i18n-ignore-file: eksportens README og revisjonshandlinger er data, ikke UI.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { stableJson, verifyAuditChain } from "@/lib/audit-chain";
import {
  archiveSigningKey,
  buildArchive,
  verifyArchive,
  type ArchiveManifest,
  type ArchiveVerification,
} from "@/lib/archive-manifest";
import { sha256Hex } from "@/lib/zip";
import {
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import { loadAuditChainRows } from "./audit-retention";

export type AuditExportParams = {
  dateFrom?: Date | null;
  dateTo?: Date | null;
  departmentId?: string | null;
};

export type AuditExportData = {
  buffer: Buffer;
  manifest: ArchiveManifest;
  fileName: string;
};

export type AuditExportError = "forbidden" | "invalid" | "too_large";

const MAX_EXPORT_ROWS = 50_000;

function fileNameFor(date: Date): string {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  return `revisjonslogg-${stamp.slice(0, 8)}-${stamp.slice(9, 15)}.zip`;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Eksporterer revisjonsloggen som et signert ZIP-arkiv med manifest.
 *
 * Bare administrator kan eksportere. Selve eksporten logges etter at arkivet
 * er bygget, slik at eksporthendelsen ikke refererer til seg selv inne i
 * pakken. Hash-kjeden verifiseres før eksport; resultatet følger manifestet.
 */
export async function exportAuditArchive(
  actor: ServiceActor,
  params: AuditExportParams = {},
): Promise<ServiceResult<AuditExportData>> {
  if (!isAdminActor(actor)) return fail("forbidden");

  const dateFrom = parseDate(params.dateFrom);
  const dateTo = parseDate(params.dateTo);
  if (params.dateFrom && !dateFrom) return fail("invalid");
  if (params.dateTo && !dateTo) return fail("invalid");
  if (dateFrom && dateTo && dateFrom > dateTo) return fail("invalid");

  const departmentId = params.departmentId?.trim() || null;
  const rows = await loadAuditChainRows(
    { dateFrom, dateTo, departmentId },
    MAX_EXPORT_ROWS + 1,
  );
  if (rows.length > MAX_EXPORT_ROWS) return fail("too_large");

  const purged = await prisma.auditPurgedHash.findMany({
    select: { hash: true, purgedAt: true, reason: true },
    orderBy: { purgedAt: "asc" },
  });
  const verification = verifyAuditChain(rows, {
    purgedHashes: purged.map((row) => row.hash),
    // En filtrert eksport kan starte midt i kjeden. Den første radens
    // prevHash er da et anker, ikke et brudd.
    allowFirstAnchor: Boolean(dateFrom || dateTo || departmentId),
  });

  const auditJsonl = rows
    .map((row) =>
      stableJson({
        id: row.id,
        seq: row.seq,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        userName: row.userName,
        actorId: row.actorId,
        departmentId: row.departmentId,
        metadata: row.metadata,
        prevHash: row.prevHash,
        hash: row.hash,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : row.createdAt,
      }),
    )
    .join("\n");
  const tombstones = purged
    .map((row) =>
      stableJson({
        hash: row.hash,
        purgedAt: row.purgedAt.toISOString(),
        reason: row.reason,
      }),
    )
    .join("\n");

  const readme = [
    "FSM revisjonslogg-eksport",
    "",
    "Arkivet inneholder:",
    "- audit.jsonl: én kanonisk JSON-rad per revisjonslogg, inkludert hash-kjeden",
    "- purge-tombstones.jsonl: hash-verdier som er fjernet av retensjonsjobben",
    "- manifest.json: SHA-256 for hver fil og kjedehode",
    "- manifest.sha256: SHA-256 av manifest.json",
    "",
    "Verifiser offline:",
    "  sha256sum -c manifest.sha256",
    "  # Deretter sammenlign hver fil i manifest.json med sha256sum <fil>",
    "",
    "Hash-kjeden verifiseres ved å beregne SHA-256 av hver rad med samme",
    "kanoniske format som appen bruker, og kontrollere at prevHash peker på",
    "forrige rad. Tombstones forklarer kontrollerte hull fra retensjon.",
    "",
    "Eksporten kan inneholde personopplysninger og skal behandles som",
    "konfidensielt materiale.",
    "",
  ].join("\n");

  const files = [
    { path: "audit.jsonl", data: Buffer.from(auditJsonl + (auditJsonl ? "\n" : ""), "utf8"), kind: "audit" },
    {
      path: "purge-tombstones.jsonl",
      data: Buffer.from(tombstones + (tombstones ? "\n" : ""), "utf8"),
      kind: "retention",
    },
    { path: "README.txt", data: Buffer.from(readme, "utf8"), kind: "readme" },
  ];

  const generatedAt = new Date();
  const built = buildArchive({
    kind: "audit-log",
    files,
    metadata: {
      rowCount: rows.length,
      exportedBy: { id: actor.id, name: actor.name },
      filters: {
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        departmentId,
      },
      chain: {
        ok: verification.ok,
        checked: verification.checked,
        firstHash: verification.firstHash,
        lastHash: verification.lastHash,
        brokenAt: verification.brokenAt,
        purgedGaps: verification.purgedGaps,
      },
      purgedHashes: purged.length,
      signatureAlgorithm: archiveSigningKey() ? "hmac-sha256" : null,
    },
    signingKey: archiveSigningKey(),
    generatedAt,
  });

  await prisma.$transaction(async (tx) => {
    // Lesingen føres som egen hendelse ved siden av eksporten, slik at et
    // uttrekk av loggen kan spores også når arkivet bare brukes til kontroll.
    await audit(tx, {
      entityType: "AuditLog",
      entityId: "read",
      action: `Leste ${rows.length} revisjonslogger for eksport`,
      actor: toAuditActor(actor),
      departmentId: null,
      actionCode: "audit.log.read",
      retentionClass: "SECURITY_1Y",
      metadata: {
        rowCount: rows.length,
        chainOk: verification.ok,
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        departmentId,
      },
    });
    await audit(tx, {
      entityType: "AuditLog",
      entityId: "export",
      action: `Eksporterte ${rows.length} revisjonslogger som ZIP-arkiv`,
      actor: toAuditActor(actor),
      departmentId: null,
      actionCode: "audit.log.exported",
      retentionClass: "SECURITY_1Y",
      metadata: {
        rowCount: rows.length,
        manifestSha256: sha256Hex(
          Buffer.from(`${JSON.stringify(built.manifest, null, 2)}\n`, "utf8"),
        ),
        chainOk: verification.ok,
        dateFrom: dateFrom?.toISOString() ?? null,
        dateTo: dateTo?.toISOString() ?? null,
        departmentId,
      },
    });
  });

  return ok({
    buffer: built.buffer,
    manifest: built.manifest,
    fileName: fileNameFor(generatedAt),
  });
}

export type AuditArchiveVerification = ArchiveVerification & {
  rowsChecked: number;
  chainOk: boolean;
  chainBrokenAt: { id: string; seq: number; reason: string } | null;
};

type ExportedAuditRow = {
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
  createdAt: string;
};

/** Verifiserer både filhashlene og selve revisjonskjeden i et arkiv. */
export function verifyAuditArchive(
  buffer: Buffer,
  options: { signingKey?: string | null } = {},
): AuditArchiveVerification {
  const verified = verifyArchive(buffer, options);
  let rowsChecked = 0;
  let chainOk = false;
  let chainBrokenAt: { id: string; seq: number; reason: string } | null = null;

  const auditEntry = verified.entries.find((entry) => entry.path === "audit.jsonl");
  if (!auditEntry) {
    return {
      ...verified,
      ok: false,
      errors: [...verified.errors, "Arkivet mangler audit.jsonl"],
      rowsChecked,
      chainOk,
      chainBrokenAt,
    };
  }

  const tombstoneEntry = verified.entries.find(
    (entry) => entry.path === "purge-tombstones.jsonl",
  );
  const tombstones = new Set<string>();
  if (tombstoneEntry) {
    for (const line of tombstoneEntry.data.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { hash?: string };
        if (parsed.hash) tombstones.add(parsed.hash);
      } catch {
        // En ugyldig tombstone-linje gjør verifiseringen under sterkere:
        // hullet kan ikke forklares, men filhash-verifiseringen fanger det.
      }
    }
  }

  const rows: ExportedAuditRow[] = [];
  for (const line of auditEntry.data.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as ExportedAuditRow);
    } catch {
      return {
        ...verified,
        ok: false,
        errors: [...verified.errors, "audit.jsonl inneholder ugyldig JSON"],
        rowsChecked,
        chainOk,
        chainBrokenAt,
      };
    }
  }

  const chain = verifyAuditChain(rows, {
    purgedHashes: tombstones,
    allowFirstAnchor: true,
  });
  rowsChecked = chain.checked;
  chainOk = chain.ok;
  chainBrokenAt = chain.brokenAt;
  const manifestChain = verified.manifest?.chain as
    | { lastHash?: string | null }
    | undefined;
  const errors = [...verified.errors];
  if (!chain.ok) {
    errors.push(
      `Revisjonskjeden er brutt${chain.brokenAt ? ` ved rad ${chain.brokenAt.seq}` : ""}`,
    );
  }
  if (
    manifestChain?.lastHash !== undefined &&
    chain.lastHash !== manifestChain.lastHash
  ) {
    errors.push("Kjedehodet stemmer ikke med manifestet");
  }

  return {
    ...verified,
    ok: errors.length === 0,
    errors,
    rowsChecked,
    chainOk,
    chainBrokenAt,
  };
}

export function auditExportWhereForTests(): Prisma.AuditLogWhereInput {
  return {};
}
