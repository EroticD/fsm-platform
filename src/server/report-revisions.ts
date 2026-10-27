import prisma from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import type { AccessUser } from "@/lib/access";
import {
  parseRevisionUnits,
  type RevisionSnapshotSource,
  type RevisionUnitSnapshot,
} from "@/lib/report-revision";

/**
 * Lesetjeneste for rapportrevisjoner.
 *
 * Revisjonene er uforanderlige øyeblikksbilder. Tjenesten skriver aldri, og
 * bruker samme tilgangsregler som PDF-viseren: ansatte med `reports.view` ser
 * rapporter på tvers av avdelinger, mens kundeportalbrukere bare ser rapporter
 * som tilhører deres egen kunde. Mykt slettede rapporter og oppdrag er skjult.
 */

type Actor = AccessUser | null;

export type ReportRevisionAccessError = "forbidden" | "not_found";

export type ReportRevisionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ReportRevisionAccessError };

export type RevisionReportIdentity = {
  id: string;
  name: string | null;
  templateTitle: string | null;
  reportNumber: string | null;
  requiresUnits: boolean;
  revision: number;
  completedAt: Date | null;
  isLocked: boolean;
  legalHold: boolean;
};

export type RevisionWorkOrderIdentity = {
  id: string;
  title: string;
  orderNumber: string | null;
  status: string;
  customerName: string | null;
  scheduledFor: Date | null;
};

export type ReportRevisionSummary = {
  id: string;
  revision: number;
  reason: string | null;
  createdAt: Date;
  actorName: string | null;
  name: string | null;
  templateTitle: string | null;
  reportNumber: string | null;
  requiresUnits: boolean;
  completedAt: Date | null;
  unitCount: number;
  deviationCount: number;
  hasTechnicianSignature: boolean;
  hasCustomerSignature: boolean;
  customerAcknowledgedAt: Date | null;
  customerAcknowledgedBy: string | null;
  customerAcknowledgedComment: string | null;
};

export type ReportRevisionSnapshot = ReportRevisionSummary & {
  report: RevisionReportIdentity;
  workOrder: RevisionWorkOrderIdentity;
  dataJson: string;
  comments: string | null;
  templateSnapshotJson: string | null;
  technicianSignatureUrl: string | null;
  technicianName: string | null;
  customerSignatureUrl: string | null;
  customerName: string | null;
  units: RevisionUnitSnapshot[];
};

export type WorkOrderRevisionOverview = {
  workOrder: RevisionWorkOrderIdentity;
  reports: Array<{
    report: RevisionReportIdentity;
    revisions: ReportRevisionSummary[];
  }>;
};

const REPORT_ACCESS_SELECT = {
  id: true,
  workOrderId: true,
  name: true,
  templateTitle: true,
  reportNumber: true,
  requiresUnits: true,
  revision: true,
  completedAt: true,
  isLocked: true,
  legalHold: true,
  deletedAt: true,
  workOrder: {
    select: {
      id: true,
      title: true,
      orderNumber: true,
      status: true,
      scheduledFor: true,
      customerId: true,
      deletedAt: true,
      customer: { select: { name: true } },
    },
  },
} as const;

type AccessibleReport = {
  id: string;
  workOrderId: string;
  name: string | null;
  templateTitle: string | null;
  reportNumber: string | null;
  requiresUnits: boolean;
  revision: number;
  completedAt: Date | null;
  isLocked: boolean;
  legalHold: boolean;
  deletedAt: Date | null;
  workOrder: {
    id: string;
    title: string;
    orderNumber: string | null;
    status: string;
    scheduledFor: Date | null;
    customerId: string | null;
    deletedAt: Date | null;
    customer: { name: string } | null;
  };
};

/** Kan brukeren lese rapporter på dette oppdraget? */
function canViewWorkOrder(
  viewer: Actor,
  workOrder: {
    customerId: string | null;
    status: string;
  },
): boolean {
  if (!viewer?.isActive) return false;

  if (viewer.role === "CUSTOMER") {
    // En kunde uten kundetilknytning skal aldri matche et oppdrag uten kunde.
    return Boolean(
      viewer.customerId && workOrder.customerId === viewer.customerId,
    );
  }

  if (!hasPermission(viewer, "reports.view")) return false;
  // Kansellerte oppdrag er lukket for montørene, også revisjonene.
  if (viewer.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return false;
  }
  return true;
}

function reportIdentity(report: AccessibleReport): RevisionReportIdentity {
  return {
    id: report.id,
    name: report.name,
    templateTitle: report.templateTitle,
    reportNumber: report.reportNumber,
    requiresUnits: report.requiresUnits !== false,
    revision: report.revision,
    completedAt: report.completedAt,
    isLocked: report.isLocked,
    legalHold: report.legalHold,
  };
}

function workOrderIdentity(report: AccessibleReport): RevisionWorkOrderIdentity {
  return {
    id: report.workOrder.id,
    title: report.workOrder.title,
    orderNumber: report.workOrder.orderNumber,
    status: report.workOrder.status,
    customerName: report.workOrder.customer?.name ?? null,
    scheduledFor: report.workOrder.scheduledFor,
  };
}

async function actorNames(
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  return new Map(
    users.map((user) => [user.id, user.name || user.email || user.id]),
  );
}

type RevisionRow = RevisionSnapshotSource & {
  createdAt: Date;
  reportId?: string;
};

function dateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function summaryOf(
  revision: RevisionRow,
  names: Map<string, string>,
): ReportRevisionSummary {
  const units = parseRevisionUnits(revision.unitsJson);
  return {
    id: revision.id,
    revision: revision.revision,
    reason: revision.reason ?? null,
    createdAt: revision.createdAt,
    actorName: revision.createdById
      ? names.get(revision.createdById) ?? revision.createdById
      : null,
    name: revision.name ?? null,
    templateTitle: revision.templateTitle ?? null,
    reportNumber: revision.reportNumber ?? null,
    requiresUnits: revision.requiresUnits !== false,
    completedAt: dateOrNull(revision.completedAt),
    unitCount: revision.requiresUnits === false ? 0 : units.length,
    deviationCount:
      revision.requiresUnits === false
        ? 0
        : units.filter((unit) => unit.status === "AVVIK").length,
    hasTechnicianSignature: Boolean(revision.technicianSignatureUrl),
    hasCustomerSignature: Boolean(revision.customerSignatureUrl),
    customerAcknowledgedAt: dateOrNull(revision.customerAcknowledgedAt),
    customerAcknowledgedBy: revision.customerAcknowledgedBy ?? null,
    customerAcknowledgedComment:
      revision.customerAcknowledgedComment ?? null,
  };
}

async function loadReport(
  viewer: Actor,
  reportId: string,
): Promise<
  | { ok: true; report: AccessibleReport }
  | { ok: false; error: ReportRevisionAccessError }
> {
  if (!viewer?.isActive) return { ok: false, error: "forbidden" };

  const report = (await prisma.report.findFirst({
    where: {
      id: reportId,
      deletedAt: null,
      workOrder: { deletedAt: null },
    },
    select: REPORT_ACCESS_SELECT,
  })) as AccessibleReport | null;

  if (!report) return { ok: false, error: "not_found" };
  if (!canViewWorkOrder(viewer, report.workOrder)) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, report };
}

/** Alle revisjoner for én rapport, nyeste først. */
export async function listReportRevisions(
  viewer: Actor,
  reportId: string,
): Promise<ReportRevisionResult<ReportRevisionSummary[]>> {
  const access = await loadReport(viewer, reportId);
  if (!access.ok) return access;

  const revisions = (await prisma.reportRevision.findMany({
    where: { reportId },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
  })) as RevisionRow[];

  const names = await actorNames(revisions.map((revision) => revision.createdById));
  return {
    ok: true,
    data: revisions.map((revision) => summaryOf(revision, names)),
  };
}

/** Ett fullstendig revisjonsøyeblikksbilde, med enheter og signaturer. */
export async function getReportRevision(
  viewer: Actor,
  reportId: string,
  revisionId: string,
): Promise<ReportRevisionResult<ReportRevisionSnapshot>> {
  const access = await loadReport(viewer, reportId);
  if (!access.ok) return access;

  const revision = (await prisma.reportRevision.findFirst({
    where: { id: revisionId, reportId },
  })) as RevisionRow | null;
  if (!revision) return { ok: false, error: "not_found" };

  const names = await actorNames([revision.createdById]);
  return {
    ok: true,
    data: {
      ...summaryOf(revision, names),
      report: reportIdentity(access.report),
      workOrder: workOrderIdentity(access.report),
      dataJson: revision.dataJson,
      comments: revision.comments ?? null,
      templateSnapshotJson: revision.templateSnapshotJson ?? null,
      technicianSignatureUrl: revision.technicianSignatureUrl ?? null,
      technicianName: revision.technicianName ?? null,
      customerSignatureUrl: revision.customerSignatureUrl ?? null,
      customerName: revision.customerName ?? null,
      units: parseRevisionUnits(revision.unitsJson),
    },
  };
}

/**
 * Revisjonen slås opp direkte på id, for PDF-ruten. Rapporten og oppdraget må
 * fortsatt være lesbare for brukeren.
 */
export async function getReportRevisionForPdf(
  viewer: Actor,
  revisionId: string,
): Promise<ReportRevisionResult<ReportRevisionSnapshot>> {
  if (!viewer?.isActive) return { ok: false, error: "forbidden" };

  const revision = (await prisma.reportRevision.findFirst({
    where: { id: revisionId },
    select: {
      id: true,
      reportId: true,
      revision: true,
      dataJson: true,
      unitsJson: true,
      comments: true,
      templateTitle: true,
      name: true,
      reportNumber: true,
      requiresUnits: true,
      templateCategory: true,
      hmsType: true,
      completedAt: true,
      templateSnapshotJson: true,
      technicianSignatureUrl: true,
      technicianName: true,
      customerSignatureUrl: true,
      customerName: true,
      customerAcknowledgedAt: true,
      customerAcknowledgedBy: true,
      customerAcknowledgedComment: true,
      reason: true,
      createdById: true,
      createdAt: true,
    },
  })) as RevisionRow | null;
  if (!revision) return { ok: false, error: "not_found" };

  const report = (await prisma.report.findFirst({
    where: {
      id: revision.reportId,
      deletedAt: null,
      workOrder: { deletedAt: null },
    },
    select: REPORT_ACCESS_SELECT,
  })) as AccessibleReport | null;
  if (!report) return { ok: false, error: "not_found" };
  if (!canViewWorkOrder(viewer, report.workOrder)) {
    return { ok: false, error: "forbidden" };
  }

  const names = await actorNames([revision.createdById]);
  return {
    ok: true,
    data: {
      ...summaryOf(revision, names),
      report: reportIdentity(report),
      workOrder: workOrderIdentity(report),
      dataJson: revision.dataJson,
      comments: revision.comments ?? null,
      templateSnapshotJson: revision.templateSnapshotJson ?? null,
      technicianSignatureUrl: revision.technicianSignatureUrl ?? null,
      technicianName: revision.technicianName ?? null,
      customerSignatureUrl: revision.customerSignatureUrl ?? null,
      customerName: revision.customerName ?? null,
      units: parseRevisionUnits(revision.unitsJson),
    },
  };
}

/** Alle rapporter på et oppdrag med revisjonslisten sin, for revisjonssiden. */
export async function getWorkOrderRevisionOverview(
  viewer: Actor,
  workOrderId: string,
): Promise<ReportRevisionResult<WorkOrderRevisionOverview>> {
  if (!viewer?.isActive) return { ok: false, error: "forbidden" };

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, deletedAt: null },
    select: {
      id: true,
      title: true,
      orderNumber: true,
      status: true,
      scheduledFor: true,
      customerId: true,
      customer: { select: { name: true } },
      reports: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          workOrderId: true,
          name: true,
          templateTitle: true,
          reportNumber: true,
          requiresUnits: true,
          revision: true,
          completedAt: true,
          isLocked: true,
          legalHold: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!workOrder) return { ok: false, error: "not_found" };
  if (!canViewWorkOrder(viewer, workOrder)) {
    return { ok: false, error: "forbidden" };
  }

  const reportIds = workOrder.reports.map((report) => report.id);
  const revisions = reportIds.length
    ? ((await prisma.reportRevision.findMany({
        where: { reportId: { in: reportIds } },
        orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
      })) as RevisionRow[])
    : [];
  const names = await actorNames(
    revisions.map((revision) => revision.createdById),
  );

  const byReport = new Map<string, ReportRevisionSummary[]>();
  for (const revision of revisions) {
    const reportId = revision.reportId;
    if (!reportId) continue;
    const list = byReport.get(reportId) ?? [];
    list.push(summaryOf(revision, names));
    byReport.set(reportId, list);
  }

  return {
    ok: true,
    data: {
      workOrder: {
        id: workOrder.id,
        title: workOrder.title,
        orderNumber: workOrder.orderNumber,
        status: workOrder.status,
        customerName: workOrder.customer?.name ?? null,
        scheduledFor: workOrder.scheduledFor ?? null,
      },
      reports: workOrder.reports.map((report) => ({
        report: {
          id: report.id,
          name: report.name,
          templateTitle: report.templateTitle,
          reportNumber: report.reportNumber,
          requiresUnits: report.requiresUnits !== false,
          revision: report.revision,
          completedAt: report.completedAt,
          isLocked: report.isLocked,
          legalHold: report.legalHold,
        },
        revisions: byReport.get(report.id) ?? [],
      })),
    },
  };
}
