import type { Prisma, WorkStatus } from "@prisma/client";
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { workOrderScope, type AccessUser } from "@/lib/access";
import { parseDateOnly, toDateOnly } from "@/lib/dates";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import type { ServiceActor } from "@/server/actor";
import { createWorkOrder } from "@/server/work-orders";

export const runtime = "nodejs";

const MAX_QUERY_LENGTH = 100;

const WORK_ORDER_STATUSES = [
  "OPEN",
  "PENDING",
  "PLANNED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}

/** Antall visiter som embeddes i en oppdragsliste. Resten hentes via /visits. */
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
};

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

function dateOnlyOrNull(value: Date | null | undefined): string | null {
  return value ? toDateOnly(value) || null : null;
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function actorForServices(actor: ServiceActor): AccessUser {
  return actor as unknown as AccessUser;
}

type ParsedDay =
  | { ok: true; value: Date | null }
  | { ok: false };

function readDay(params: URLSearchParams, name: string): ParsedDay {
  const raw = params.get(name);
  if (raw === null || !raw.trim()) return { ok: true, value: null };
  const date = parseDateOnly(raw.trim());
  return date ? { ok: true, value: date } : { ok: false };
}

/**
 * Oppdrag listen for API-klienter.
 *
 * Omfanget legges som én egen AND-gren, slik at et filter på kunde, montør
 * eller fritekst aldri kan overstyre avdelingssperren. Myk-slettede oppdrag
 * er allerede utelatt av `workOrderScope`.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.view")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til oppdrag.");
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const { page, limit, skip } = parseApiPagination(url);

  const statusRaw = (params.get("status") ?? "").trim();
  if (statusRaw && !isWorkOrderStatus(statusRaw)) {
    return apiError(400, "validation_error", "Ugyldig statusfilter.", {
      field: "status",
    });
  }

  const customerId = (params.get("customerId") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const technicianId = (params.get("technicianId") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const query = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

  const from = readDay(params, "scheduledFrom");
  if (!from.ok) {
    return apiError(400, "validation_error", "Ugyldig fra-dato.", {
      field: "scheduledFrom",
    });
  }
  const to = readDay(params, "scheduledTo");
  if (!to.ok) {
    return apiError(400, "validation_error", "Ugyldig til-dato.", {
      field: "scheduledTo",
    });
  }
  if (from.value && to.value && from.value > to.value) {
    return apiError(
      400,
      "validation_error",
      "Fra-dato kan ikke være etter til-dato.",
      { field: "scheduledFrom" },
    );
  }

  let updatedSince: Date | null = null;
  const updatedSinceRaw = (params.get("updatedSince") ?? "").trim();
  if (updatedSinceRaw) {
    updatedSince = new Date(updatedSinceRaw);
    if (Number.isNaN(updatedSince.getTime())) {
      return apiError(400, "validation_error", "Ugyldig tidspunkt.", {
        field: "updatedSince",
      });
    }
  }

  const filters: Prisma.WorkOrderWhereInput[] = [
    workOrderScope(actorForServices(auth.actor)),
  ];

  if (statusRaw) filters.push({ status: statusRaw as WorkStatus });
  if (customerId) filters.push({ customerId });
  if (technicianId) filters.push({ technicians: { some: { id: technicianId } } });
  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    filters.push({
      OR: [{ title: contains }, { customer: { name: contains } }],
    });
  }
  if (from.value || to.value) {
    filters.push({
      scheduledFor: {
        ...(from.value ? { gte: from.value } : {}),
        ...(to.value ? { lte: to.value } : {}),
      },
    });
  }
  if (updatedSince) filters.push({ updatedAt: { gte: updatedSince } });

  const where: Prisma.WorkOrderWhereInput = { AND: filters };

  const [total, workOrders] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      skip,
      take: limit,
      select: SUMMARY_SELECT,
    }),
  ]);

  return apiJson(
    workOrders.map((workOrder) => toSummary(workOrder)),
    paginationMeta(total, page, limit),
  );
}

const CREATE_FIELDS = new Set([
  "title",
  "description",
  "orderNumber",
  "customerId",
  "contactId",
  "departmentId",
  "address",
  "postalCode",
  "city",
  "scheduledFor",
  "scheduledTo",
  "technicianIds",
  "templateIds",
  "tagNames",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

function readIdList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (value.some((item) => typeof item !== "string")) return null;
  return value.map((item) => (item as string).trim()).filter(Boolean);
}

/**
 * Normaliserer en dato til kalenderdatoen tjenestelaget forventer. Både
 * `YYYY-MM-DD` og en full ISO-tidsstempel godtas, men tiden kastes.
 */
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
      return apiError(401, "unauthorized", "Ikke autentisert.");
    case "ikke-tilgang":
    case "ingen-tilgang":
      return apiError(403, "forbidden", "Du har ikke tilgang til oppdraget.");
    case "ikke-funnet":
    case "not_found":
      return apiError(404, "not_found", "Fant ikke oppdraget.");
    case "duplikat-ordrenummer":
    case "kunde-last":
    case "legal-hold":
    case "workorder-locked":
      return apiError(409, "conflict", "Oppdraget kan ikke endres.");
    case "reason-required":
    case "avdeling":
    case "ingen-endring":
    case "dato-mangler":
    case "sluttdato-for-startdato":
      return apiError(422, "validation_error", "Feltene er ikke gyldige.");
    default:
      if (error.startsWith("ugyldig-")) {
        return apiError(422, "validation_error", "Feltene er ikke gyldige.");
      }
      return apiError(500, "server_error", "Kunne ikke oppdatere oppdraget.");
  }
}

/** Oppretter et oppdrag for en API-klient. */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "workorders.create")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til å opprette oppdrag.");
  }

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError(413, "validation_error", "Forespørselen er for stor.")
      : apiError(400, "validation_error", "Ugyldig JSON.");
  }

  const body = parsed.data;
  if (!isRecord(body)) {
    return apiError(400, "validation_error", "Body må være et JSON-objekt.");
  }

  const unknownField = Object.keys(body).find((key) => !CREATE_FIELDS.has(key));
  if (unknownField) {
    return apiError(400, "validation_error", "Ukjent felt.", {
      field: unknownField,
    });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return apiError(422, "validation_error", "Tittel er påkrevd.", {
      field: "title",
    });
  }

  const scheduledFor = normalizeDate(body.scheduledFor);
  if (!scheduledFor) {
    return apiError(422, "validation_error", "Gyldig startdato er påkrevd.", {
      field: "scheduledFor",
    });
  }

  let scheduledTo = "";
  if (
    body.scheduledTo !== undefined &&
    body.scheduledTo !== null &&
    body.scheduledTo !== ""
  ) {
    const normalized = normalizeDate(body.scheduledTo);
    if (!normalized) {
      return apiError(422, "validation_error", "Ugyldig sluttdato.", {
        field: "scheduledTo",
      });
    }
    scheduledTo = normalized;
  }

  const description = readOptionalText(body.description);
  const orderNumber = readOptionalText(body.orderNumber);
  const customerId = readOptionalText(body.customerId);
  const contactId = readOptionalText(body.contactId);
  const departmentId = readOptionalText(body.departmentId);
  const address = readOptionalText(body.address);
  const postalCode = readOptionalText(body.postalCode);
  const city = readOptionalText(body.city);
  const technicianIds = readIdList(body.technicianIds);
  const templateIds = readIdList(body.templateIds);
  const tagNames = readIdList(body.tagNames);

  if (
    description === null ||
    orderNumber === null ||
    customerId === null ||
    contactId === null ||
    departmentId === null ||
    address === null ||
    postalCode === null ||
    city === null
  ) {
    return apiError(422, "validation_error", "Feltene må være tekst.");
  }
  if (!technicianIds || !templateIds || !tagNames) {
    return apiError(422, "validation_error", "Listefeltene må være tekstlister.");
  }

  const result = await createWorkOrder(actorForServices(auth.actor), {
    title,
    description,
    orderNumber,
    customerId,
    contactId,
    departmentId,
    address,
    postalCode,
    city,
    scheduledFor,
    scheduledTo,
    technicianIds,
    templateIds,
    tagNames,
  });

  if (!result.ok) return workOrderError(result.error);

  const response = apiJson({ id: result.id }, 201);
  response.headers.set("Location", `/api/v1/work-orders/${result.id}`);
  return response;
}
