import type { Prisma } from "@prisma/client";
import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { workOrderScope, type AccessUser } from "@/lib/access";
import { parseDateOnly, toDateOnly } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import type { ServiceActor } from "@/server/actor";
import {
  changeWorkOrderStatus,
  updateWorkOrderDate,
} from "@/server/work-orders";

export const runtime = "nodejs";

const WORK_ORDER_STATUSES = [
  "OPEN",
  "PENDING",
  "PLANNED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

const PATCH_FIELDS = new Set([
  "status",
  "scheduledFor",
  "scheduledTo",
  "reason",
]);

/** Antall visiter som embeddes i oppdragsdetaljen. Resten hentes via /visits. */
const EMBEDDED_VISIT_LIMIT = 20;

const EMBEDDED_VISIT_SELECT = {
  id: true,
  workOrderId: true,
  sequence: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  technicians: {
    orderBy: { userId: "asc" },
    select: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
} as const;

const SUMMARY_SELECT = {
  id: true,
  title: true,
  orderNumber: true,
  status: true,
  scheduledFor: true,
  scheduledTo: true,
  customer: { select: { id: true, name: true } },
  technicians: { select: { id: true, name: true, email: true } },
  department: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { reports: { where: { deletedAt: null } } } },
  visits: {
    orderBy: [{ sequence: "asc" }, { startsAt: "asc" }],
    take: EMBEDDED_VISIT_LIMIT,
    select: EMBEDDED_VISIT_SELECT,
  },
  slaClocks: {
    orderBy: { startedAt: "desc" },
    take: 1,
    select: {
      id: true,
      policyId: true,
      startedAt: true,
      respondBy: true,
      resolveBy: true,
      respondedAt: true,
      resolvedAt: true,
      state: true,
      breachedAt: true,
      policy: { select: { name: true } },
    },
  },
} satisfies Prisma.WorkOrderSelect;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  description: true,
  address: true,
  postalCode: true,
  city: true,
  contact: { select: { id: true, name: true, email: true, phone: true } },
  tags: { select: { id: true, name: true, color: true } },
  templates: { select: { id: true, title: true } },
  reports: {
    where: { deletedAt: null },
    orderBy: [{ completedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      isLocked: true,
      completedAt: true,
      reportNumber: true,
    },
  },
  workComments: {
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, content: true, authorName: true, createdAt: true },
  },
  attachments: {
    orderBy: { id: "desc" },
    select: { id: true, fileName: true },
  },
} satisfies Prisma.WorkOrderSelect;

type EmbeddedVisitSource = {
  id: string;
  workOrderId: string;
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  technicians: { user: { id: string; name: string | null; email: string | null } }[];
};

type EmbeddedSlaSource = {
  id: string;
  policyId: string;
  startedAt: Date;
  respondBy: Date;
  resolveBy: Date;
  respondedAt: Date | null;
  resolvedAt: Date | null;
  state: string;
  breachedAt: Date | null;
  policy: { name: string };
};

type SummarySource = {
  id: string;
  title: string;
  orderNumber: string | null;
  status: string;
  scheduledFor: Date | null;
  scheduledTo: Date | null;
  customer: { id: string; name: string } | null;
  technicians: { id: string; name: string | null; email: string | null }[];
  department: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
  _count?: { reports: number };
  visits?: EmbeddedVisitSource[];
  slaClocks?: EmbeddedSlaSource[];
};

type DetailSource = SummarySource & {
  description: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  contact: { id: string; name: string; email: string | null; phone: string | null } | null;
  tags: { id: string; name: string; color: string }[];
  templates: { id: string; title: string }[];
  reports: {
    id: string;
    name: string | null;
    isLocked: boolean;
    completedAt: Date;
    reportNumber: string | null;
  }[];
  workComments: {
    id: string;
    content: string;
    authorName: string | null;
    createdAt: Date;
  }[];
  attachments: { id: string; fileName: string }[];
};

function dateOnlyOrNull(value: Date | null | undefined): string | null {
  return value ? toDateOnly(value) || null : null;
}

function actorForServices(actor: ServiceActor): AccessUser {
  return actor as unknown as AccessUser;
}

function toEmbeddedVisit(visit: EmbeddedVisitSource) {
  return {
    id: visit.id,
    workOrderId: visit.workOrderId,
    sequence: visit.sequence,
    startsAt: visit.startsAt.toISOString(),
    endsAt: visit.endsAt.toISOString(),
    allDay: visit.allDay,
    status: visit.status,
    notes: visit.notes,
    technicians: visit.technicians.map((technician) => technician.user),
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  };
}

function toEmbeddedSla(clock: EmbeddedSlaSource | undefined) {
  if (!clock) return null;
  return {
    id: clock.id,
    policyId: clock.policyId,
    policyName: clock.policy.name,
    state: clock.state,
    startedAt: clock.startedAt.toISOString(),
    respondBy: clock.respondBy.toISOString(),
    resolveBy: clock.resolveBy.toISOString(),
    respondedAt: clock.respondedAt?.toISOString() ?? null,
    resolvedAt: clock.resolvedAt?.toISOString() ?? null,
    breachedAt: clock.breachedAt?.toISOString() ?? null,
  };
}

function toSummary(row: SummarySource) {
  return {
    id: row.id,
    title: row.title,
    orderNumber: row.orderNumber,
    status: row.status,
    scheduledFor: dateOnlyOrNull(row.scheduledFor),
    scheduledTo: dateOnlyOrNull(row.scheduledTo),
    customer: row.customer ?? null,
    technicians: row.technicians ?? [],
    department: row.department,
    reportCount: row._count?.reports ?? 0,
    visits: (row.visits ?? []).map(toEmbeddedVisit),
    sla: toEmbeddedSla(row.slaClocks?.[0]),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: DetailSource) {
  return {
    ...toSummary(row),
    description: row.description ?? null,
    address: row.address ?? null,
    postalCode: row.postalCode ?? null,
    city: row.city ?? null,
    contact: row.contact ?? null,
    tags: row.tags ?? [],
    templates: row.templates ?? [],
    reports: row.reports ?? [],
    comments: (row.workComments ?? []).map((comment) => ({
      id: comment.id,
      body: comment.content,
      authorName: comment.authorName,
      createdAt: comment.createdAt,
    })),
    // Bare metadata. `Attachment.dataUrl` peker på selve filen og skal aldri
    // serialiseres tilbake til en API-klient.
    attachments: (row.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function isWorkOrderStatus(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (WORK_ORDER_STATUSES as readonly string[]).includes(value)
  );
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = parseDateOnly(trimmed);
  if (dateOnly) return trimmed;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function workOrderError(error: string) {
  switch (error) {
    case "ikke-autentisert":
      return apiError("unauthorized", 401, { messageKey: "errors.api.unauthorized" });
    case "ikke-tilgang":
    case "ingen-tilgang":
      return apiError("forbidden", 403, { messageKey: "errors.api.workOrders.forbidden" });
    case "ikke-funnet":
    case "not_found":
      return apiError("not_found", 404, { messageKey: "errors.api.workOrders.notFound" });
    case "duplikat-ordrenummer":
    case "kunde-last":
    case "legal-hold":
    case "workorder-locked":
      return apiError("conflict", 409, { messageKey: "errors.api.workOrders.conflict" });
    case "reason-required":
    case "avdeling":
    case "ingen-endring":
    case "dato-mangler":
    case "sluttdato-for-startdato":
      return apiError("validation_error", 422, { messageKey: "errors.api.workOrders.validation" });
    default:
      if (error.startsWith("ugyldig-")) {
        return apiError("validation_error", 422, { messageKey: "errors.api.workOrders.validation" });
      }
      return apiError("server_error", 500, { messageKey: "errors.api.workOrders.serverError" });
  }
}

/** Ett oppdrag, slått opp gjennom aktørens avdelings- eller kundeomfang. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.view")) {
    return apiError("forbidden", 403, { messageKey: "errors.api.workOrders.forbidden" });
  }

  const { id } = await params;
  const workOrder = await prisma.workOrder.findFirst({
    where: { id, AND: [workOrderScope(actorForServices(auth.actor))] },
    select: DETAIL_SELECT,
  });

  if (!workOrder) {
    return apiError("not_found", 404, { messageKey: "errors.api.workOrders.notFound" });
  }

  return apiJson(toDetail(workOrder));
}

/**
 * Endrer status og/eller planlagte datoer.
 *
 * Statusen går gjennom samme tilstandsmaskin, autorisasjon og revisjonslogg
 * som kontorflaten. Datoene går gjennom `updateWorkOrderDate`, som bevarer
 * lengden på et flerdagsoppdrag når bare startdatoen sendes.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.update")) {
    return apiError("forbidden", 403, { messageKey: "errors.api.workOrders.updateForbidden" });
  }

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError("validation_error", 413, { messageKey: "errors.api.tooLarge" })
      : apiError("validation_error", 400, { messageKey: "errors.api.invalidJson" });
  }

  const body = parsed.data;
  if (!isRecord(body)) {
    return apiError("validation_error", 400, { messageKey: "errors.api.bodyObject" });
  }

  const unknownField = Object.keys(body).find((key) => !PATCH_FIELDS.has(key));
  if (unknownField) {
    return apiError("validation_error", 400, { messageKey: "errors.api.workOrders.unknownField", details: {
      field: unknownField,
    } });
  }

  const hasStatus = hasOwn(body, "status");
  const hasScheduledFor = hasOwn(body, "scheduledFor");
  const hasScheduledTo = hasOwn(body, "scheduledTo");

  if (!hasStatus && !hasScheduledFor && !hasScheduledTo) {
    return apiError("validation_error", 400, { messageKey: "errors.api.workOrders.noFields" });
  }

  let status: string | null = null;
  if (hasStatus) {
    if (!isWorkOrderStatus(body.status)) {
      return apiError("validation_error", 422, { messageKey: "errors.api.workOrders.invalidStatus", details: {
        field: "status",
      } });
    }
    status = body.status;
  }

  let reason: string | undefined;
  if (hasOwn(body, "reason")) {
    if (typeof body.reason !== "string") {
      return apiError("validation_error", 422, { messageKey: "errors.api.workOrders.reasonText", details: {
        field: "reason",
      } });
    }
    reason = body.reason.trim();
  }

  const { id } = await params;
  const actor = actorForServices(auth.actor);

  let newDate: string | null = null;
  if (hasScheduledFor) {
    newDate = normalizeDate(body.scheduledFor);
    if (!newDate) {
      return apiError("validation_error", 422, { messageKey: "errors.api.workOrders.invalidStartDate", details: {
        field: "scheduledFor",
      } });
    }
  } else if (hasScheduledTo) {
    // Sluttdato alene flytter bare slutten. Da må startdatoen hentes fra
    // oppdraget, men fortsatt gjennom samme omfang som detaljvisningen.
    const current = await prisma.workOrder.findFirst({
      where: { id, AND: [workOrderScope(actor)] },
      select: { scheduledFor: true },
    });
    if (!current) {
      return apiError("not_found", 404, { messageKey: "errors.api.workOrders.notFound" });
    }
    newDate = current.scheduledFor ? toDateOnly(current.scheduledFor) : null;
    if (!newDate) {
      return apiError("validation_error", 422, { messageKey: "errors.api.workOrders.missingStartDate", details: { field: "scheduledTo" } });
    }
  }

  let newEnd: string | undefined;
  if (hasScheduledTo) {
    const raw = body.scheduledTo;
    if (raw === null || raw === undefined || raw === "") {
      newEnd = "";
    } else {
      const normalized = normalizeDate(raw);
      if (!normalized) {
        return apiError("validation_error", 422, { messageKey: "errors.api.workOrders.invalidEndDate", details: {
          field: "scheduledTo",
        } });
      }
      newEnd = normalized;
    }
  }

  if (newDate) {
    const dateBody: { newDate: string; newEnd?: string } = { newDate };
    if (hasScheduledTo) dateBody.newEnd = newEnd;

    const result = await updateWorkOrderDate(actor, id, dateBody);
    if (!result.ok) return workOrderError(result.error);
  }

  if (status) {
    const result = await changeWorkOrderStatus(
      actor,
      id,
      status,
      "office",
      reason,
    );
    if (!result.ok) return workOrderError(result.error);
  }

  const updated = await prisma.workOrder.findFirst({
    where: { id, AND: [workOrderScope(actor)] },
    select: SUMMARY_SELECT,
  });
  if (!updated) {
    return apiError("not_found", 404, { messageKey: "errors.api.workOrders.notFound" });
  }

  return apiJson(toSummary(updated));
}
