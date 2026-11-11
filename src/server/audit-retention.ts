// i18n-ignore-file: driftsmeldinger og revisjonshandlinger er data, ikke UI.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { auditMaintenancePrisma } from "@/lib/prisma-audit-maintenance";
import { audit } from "@/lib/audit";
import {
  backfillAuditChain,
  verifyAuditChain,
  type AuditBackfillResult,
  type AuditChainRow,
  type AuditChainVerification,
} from "@/lib/audit-chain";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Standard oppbevaringstid når verken databasen eller miljøet sier noe. */
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
export const MIN_AUDIT_RETENTION_DAYS = 1;
export const MAX_AUDIT_RETENTION_DAYS = 3_650;
/** 0 slår retensjonen av; da purres ingenting automatisk. */
export const AUDIT_RETENTION_DISABLED = 0;

/** Hvor mange rader retensjonsjobben vurderer per transaksjon. */
export const AUDIT_RETENTION_BATCH_SIZE = 500;
/** Sikkerhetsgrense per kjøring, så en feilkonfigurert jobb ikke tømmer alt. */
export const AUDIT_RETENTION_MAX_BATCHES = 20;

const DAY_MS = 24 * 60 * 60_000;

export type AuditRetentionView = {
  retentionDays: number;
  /** True når verdien kommer fra miljøet fordi databasen mangler rad. */
  fromEnvironment: boolean;
  minimum: number;
  maximum: number;
};

function clampRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUDIT_RETENTION_DAYS;
  const integer = Math.trunc(value);
  if (integer === AUDIT_RETENTION_DISABLED) return AUDIT_RETENTION_DISABLED;
  return Math.min(
    MAX_AUDIT_RETENTION_DAYS,
    Math.max(MIN_AUDIT_RETENTION_DAYS, integer),
  );
}

export function parseAuditRetentionDays(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return null;
  if (parsed === AUDIT_RETENTION_DISABLED) return AUDIT_RETENTION_DISABLED;
  if (parsed < MIN_AUDIT_RETENTION_DAYS || parsed > MAX_AUDIT_RETENTION_DAYS) {
    return null;
  }
  return parsed;
}

type RetentionClient = Pick<
  typeof prisma,
  "auditRetentionSetting"
>;

export async function getAuditRetentionSetting(
  client: RetentionClient = prisma,
): Promise<AuditRetentionView> {
  const row = await client.auditRetentionSetting.findUnique({
    where: { id: "default" },
  });
  if (row) {
    return {
      retentionDays: clampRetentionDays(row.retentionDays),
      fromEnvironment: false,
      minimum: MIN_AUDIT_RETENTION_DAYS,
      maximum: MAX_AUDIT_RETENTION_DAYS,
    };
  }

  const fromEnv = process.env.AUDIT_RETENTION_DAYS
    ? Number.parseInt(process.env.AUDIT_RETENTION_DAYS, 10)
    : Number.NaN;
  return {
    retentionDays: Number.isFinite(fromEnv)
      ? clampRetentionDays(fromEnv)
      : DEFAULT_AUDIT_RETENTION_DAYS,
    fromEnvironment: true,
    minimum: MIN_AUDIT_RETENTION_DAYS,
    maximum: MAX_AUDIT_RETENTION_DAYS,
  };
}

/** Lesetilgang til retensjonsinnstillingen. Bare administrator. */
export async function getAuditRetentionView(
  actor: ServiceActor,
): Promise<ServiceResult<AuditRetentionView>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  return ok(await getAuditRetentionSetting());
}

/** Lagrer oppbevaringstiden. Krever administrator, og endringen logges. */
export async function saveAuditRetention(
  actor: ServiceActor,
  value: unknown,
): Promise<ServiceResult<AuditRetentionView>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  const days = parseAuditRetentionDays(value);
  if (days === null) return fail("invalid");

  await prisma.$transaction(async (tx) => {
    await tx.auditRetentionSetting.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        retentionDays: days,
        updatedById: actor.id,
      },
      update: {
        retentionDays: days,
        updatedById: actor.id,
      },
    });
    await audit(tx, {
      entityType: "AuditRetentionSetting",
      entityId: "default",
      action:
        days === AUDIT_RETENTION_DISABLED
          ? "Slått av automatisk retensjon for revisjonsloggen"
          : `Endret oppbevaringstid for revisjonsloggen til ${days} dager`,
      actor: toAuditActor(actor),
      departmentId: null,
      metadata: { retentionDays: days },
    });
  });

  return ok(await getAuditRetentionSetting());
}

export type AuditHoldInput = {
  auditLogId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  reason: string;
};

export type AuditHoldView = {
  id: string;
  auditLogId: string | null;
  entityType: string | null;
  entityId: string | null;
  reason: string;
  createdAt: Date;
};

/** Aktive bevaringsplikt-markeringer. Bare administrator kan se dem. */
export async function listAuditHolds(
  actor: ServiceActor,
): Promise<ServiceResult<AuditHoldView[]>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  const holds = await prisma.auditHold.findMany({
    where: { releasedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      auditLogId: true,
      entityType: true,
      entityId: true,
      reason: true,
      createdAt: true,
    },
  });
  return ok(holds);
}

/** Setter bevaringsplikt på én logg eller en hel entitet. */
export async function setAuditHold(
  actor: ServiceActor,
  input: AuditHoldInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500) return fail("invalid");

  const auditLogId = input.auditLogId?.trim() || null;
  const entityType = input.entityType?.trim() || null;
  const entityId = input.entityId?.trim() || null;
  if (!auditLogId && !(entityType && entityId)) return fail("invalid");
  if (auditLogId && (entityType || entityId)) return fail("invalid");

  if (auditLogId) {
    const exists = await prisma.auditLog.findUnique({
      where: { id: auditLogId },
      select: { id: true },
    });
    if (!exists) return fail("not_found");
  }

  const hold = await prisma.$transaction(async (tx) => {
    const created = await tx.auditHold.create({
      data: {
        auditLogId,
        entityType,
        entityId,
        reason,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await audit(tx, {
      entityType: "AuditHold",
      entityId: created.id,
      action: `Slo på bevaringsplikt for revisjonslogg: ${reason}`,
      actor: toAuditActor(actor),
      departmentId: null,
      metadata: { auditLogId, entityType, entityId, reason },
    });
    return created;
  });

  return ok(hold);
}

/** Opphever et hold. Selve revisjonsradene røres aldri. */
export async function releaseAuditHold(
  actor: ServiceActor,
  holdId: string,
): Promise<ServiceResult<{ id: string }>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  if (!holdId || holdId.length > 100) return fail("invalid");

  const hold = await prisma.auditHold.findUnique({
    where: { id: holdId },
    select: { id: true, releasedAt: true },
  });
  if (!hold) return fail("not_found");
  if (hold.releasedAt) return fail("conflict");

  await prisma.$transaction(async (tx) => {
    await tx.auditHold.update({
      where: { id: holdId },
      data: { releasedAt: new Date(), releasedById: actor.id },
    });
    await audit(tx, {
      entityType: "AuditHold",
      entityId: holdId,
      action: "Opphevet bevaringsplikt for revisjonslogg",
      actor: toAuditActor(actor),
      departmentId: null,
    });
  });

  return ok({ id: holdId });
}

type CleanupClient = Pick<
  typeof prisma,
  | "auditLog"
  | "auditHold"
  | "auditPurgedHash"
  | "workOrder"
  | "report"
  | "auditRetentionSetting"
  | "$transaction"
>;

export type AuditRetentionCleanupResult = {
  deleted: number;
  held: number;
  retentionDays: number;
  cutoff: Date | null;
  disabled: boolean;
};

type Candidate = {
  id: string;
  entityType: string;
  entityId: string;
  hash?: string | null;
  retentionClass?: string | null;
};

async function heldEntityIds(
  client: Pick<typeof prisma, "workOrder" | "report">,
  candidates: readonly Candidate[],
): Promise<{ workOrders: Set<string>; reports: Set<string> }> {
  const workOrderIds = [
    ...new Set(
      candidates
        .filter((row) => row.entityType === "WorkOrder")
        .map((row) => row.entityId)
        .filter(Boolean),
    ),
  ];
  const reportIds = [
    ...new Set(
      candidates
        .filter((row) => row.entityType === "Report")
        .map((row) => row.entityId)
        .filter(Boolean),
    ),
  ];

  const [workOrders, reports] = await Promise.all([
    workOrderIds.length
      ? client.workOrder.findMany({
          where: { id: { in: workOrderIds }, legalHold: true },
          select: { id: true },
        })
      : Promise.resolve([]),
    reportIds.length
      ? client.report.findMany({
          where: {
            id: { in: reportIds },
            OR: [{ legalHold: true }, { workOrder: { legalHold: true } }],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    workOrders: new Set(workOrders.map((row) => row.id)),
    reports: new Set(reports.map((row) => row.id)),
  };
}

/**
 * Purrer revisjonslogger eldre enn oppbevaringstiden.
 *
 * Rekkefølgen er viktig: hold kontrolleres på nytt inne i transaksjonen, og
 * hver slettet hash registreres som tombstone før raden forsvinner. Da kan
 * verifiseringen fortsatt skille et kontrollert hull fra en ulovlig sletting.
 *
 * Selve slettingen krever en databasebruker med DELETE på `AuditLog`. Når
 * runtime-rollen er låst (se docs/audit-retention.md), må jobben kjøres med
 * vedlikeholdsrollen.
 */
export async function cleanupExpiredAuditLogs(
  now: Date = new Date(),
  client: CleanupClient = auditMaintenancePrisma() as CleanupClient,
): Promise<AuditRetentionCleanupResult> {
  const setting = await getAuditRetentionSetting(
    client as unknown as RetentionClient,
  );
  if (setting.retentionDays === AUDIT_RETENTION_DISABLED) {
    return {
      deleted: 0,
      held: 0,
      retentionDays: 0,
      cutoff: null,
      disabled: true,
    };
  }

  const cutoff = new Date(now.getTime() - setting.retentionDays * DAY_MS);
  // Retensjonsklasser kan kreve lengre oppbevaring enn den globale innstillingen
  // – først og fremst regnskapsmateriale, som skal bevares i fem år etter
  // bokføringsloven § 13. Den globale verdien fungerer som et gulv, aldri som
  // en forkortelse av en strengere klasse.
  const classDays: Record<string, number> = {
    ACCOUNTING_5Y: Math.max(setting.retentionDays, 5 * 365),
    SECURITY_1Y: Math.max(setting.retentionDays, 365),
    OPS_90D: Math.max(setting.retentionDays, 90),
  };
  const retentionFilter = {
    OR: [
      { retentionClass: null, createdAt: { lt: cutoff } },
      {
        retentionClass: "ACCOUNTING_5Y",
        createdAt: {
          lt: new Date(now.getTime() - classDays.ACCOUNTING_5Y * DAY_MS),
        },
      },
      {
        retentionClass: "SECURITY_1Y",
        createdAt: {
          lt: new Date(now.getTime() - classDays.SECURITY_1Y * DAY_MS),
        },
      },
      {
        retentionClass: "OPS_90D",
        createdAt: { lt: new Date(now.getTime() - classDays.OPS_90D * DAY_MS) },
      },
    ],
  };
  let deleted = 0;
  let heldTotal = 0;

  for (let batch = 0; batch < AUDIT_RETENTION_MAX_BATCHES; batch += 1) {
    const candidates = (await client.auditLog.findMany({
      where: retentionFilter,
      orderBy: { seq: "asc" },
      take: AUDIT_RETENTION_BATCH_SIZE,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        hash: true,
        retentionClass: true,
      },
    })) as Candidate[];
    if (candidates.length === 0) break;

    const result = await client.$transaction(async (tx) => {
      const activeHolds = await tx.auditHold.findMany({
        where: { releasedAt: null },
        select: { auditLogId: true, entityType: true, entityId: true },
      });
      const heldLogIds = new Set(
        activeHolds.map((hold) => hold.auditLogId).filter(Boolean),
      );
      const heldEntities = new Set(
        activeHolds
          .filter((hold) => hold.entityType && hold.entityId)
          .map((hold) => `${hold.entityType}\u0000${hold.entityId}`),
      );
      const legalHolds = await heldEntityIds(tx, candidates);

      const deletable = candidates.filter((row) => {
        if (heldLogIds.has(row.id)) return false;
        if (heldEntities.has(`${row.entityType}\u0000${row.entityId}`)) {
          return false;
        }
        if (
          row.entityType === "WorkOrder" &&
          legalHolds.workOrders.has(row.entityId)
        ) {
          return false;
        }
        if (
          row.entityType === "Report" &&
          legalHolds.reports.has(row.entityId)
        ) {
          return false;
        }
        return true;
      });
      const held = candidates.length - deletable.length;
      if (deletable.length === 0) {
        return { deleted: 0, held };
      }

      const purgedHashes = deletable
        .map((row) => row.hash)
        .filter((hash): hash is string => Boolean(hash));
      if (purgedHashes.length) {
        await tx.auditPurgedHash.createMany({
          data: purgedHashes.map((hash) => ({
            hash,
            reason: `retention:${setting.retentionDays}d`,
          })),
          skipDuplicates: true,
        });
      }

      const removed = await tx.auditLog.deleteMany({
        where: { id: { in: deletable.map((row) => row.id) } },
      });

      await audit(tx, {
        entityType: "AuditLog",
        entityId: "retention",
        action:
          `Automatisk slettet ${removed.count} revisjonslogger eldre enn ` +
          `${setting.retentionDays} dager (${held} holdt tilbake)`,
        actor: { id: "system", name: "System", email: null },
        departmentId: null,
        metadata: {
          retentionDays: setting.retentionDays,
          cutoff: cutoff.toISOString(),
          deleted: removed.count,
          held,
          automatic: true,
        },
      });

      return { deleted: removed.count, held };
    });

    deleted += result.deleted;
    heldTotal += result.held;
    if (result.deleted === 0) break;
  }

  return {
    deleted,
    held: heldTotal,
    retentionDays: setting.retentionDays,
    cutoff,
    disabled: false,
  };
}

/** Backfill av hash-kjeden. Brukes av skriptet og integrasjonstester. */
export async function backfillStoredAuditChain(
  options: { batchSize?: number; maxRows?: number } = {},
): Promise<AuditBackfillResult> {
  return backfillAuditChain(
    prisma as unknown as Parameters<typeof backfillAuditChain>[0],
    options,
  );
}

export type AuditVerificationFilters = {
  dateFrom?: Date | null;
  dateTo?: Date | null;
  departmentId?: string | null;
};

/** Henter rader i `seq`-rekkefølge for verifisering eller eksport. */
export async function loadAuditChainRows(
  filters: AuditVerificationFilters = {},
  take = 100_000,
): Promise<AuditChainRow[]> {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.departmentId) where.departmentId = filters.departmentId;

  return prisma.auditLog.findMany({
    where,
    orderBy: { seq: "asc" },
    take,
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
  });
}

/** Verifiserer hele eller et utsnitt av kjeden. Bare administrator. */
export async function verifyStoredAuditChain(
  actor: ServiceActor,
  filters: AuditVerificationFilters = {},
): Promise<ServiceResult<AuditChainVerification>> {
  if (!isAdminActor(actor)) return fail("forbidden");
  const rows = await loadAuditChainRows(filters);
  const purged = await prisma.auditPurgedHash.findMany({
    select: { hash: true },
  });
  return ok(
    verifyAuditChain(rows, {
      purgedHashes: purged.map((row) => row.hash),
      allowFirstAnchor: Boolean(filters.dateFrom || filters.departmentId),
    }),
  );
}

/** Bare for tester og helsesjekker: antall aktive hold. */
export async function countActiveAuditHolds(): Promise<number> {
  return prisma.auditHold.count({ where: { releasedAt: null } });
}

export function actorCanViewAudit(actor: ServiceActor): boolean {
  return can(actor, "audit.view");
}
