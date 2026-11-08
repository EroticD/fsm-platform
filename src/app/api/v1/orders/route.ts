import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import {
  createExternalOrder,
  getExternalOrder,
  listExternalOrders,
} from "@/server/external-orders";
import {
  externalOrderError,
  serializeExternalOrder,
  serializeExternalOrderDetail,
} from "./_shared";

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

const CREATE_FIELDS = new Set([
  "source",
  "externalId",
  "customerId",
  "customerNumber",
  "orgNumber",
  "siteId",
  "departmentId",
  "title",
  "description",
  "requestedDate",
  "scheduledFor",
  "priority",
  "lines",
  "payload",
  "externalPayload",
]);

const ERROR_KEYS = {
  forbidden: "errors.api.orders.forbidden",
  notFound: "errors.api.orders.notFound",
  conflict: "errors.api.orders.conflict",
  validation: "errors.api.orders.validation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Innmeldte ordrer i aktørens oppdragsomfang. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth.actor, "workorders.view")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.orders.forbidden",
    });
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.max(
    1,
    Math.min(100, Number.parseInt(params.get("limit") ?? "50", 10) || 50),
  );
  const status = text(params.get("status"));
  if (
    status &&
    !(WORK_ORDER_STATUSES as readonly string[]).includes(status)
  ) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.orders.validation",
      details: { field: "status" },
    });
  }

  const result = await listExternalOrders(auth.actor, {
    page,
    limit,
    status: status || undefined,
    source: text(params.get("source")) || undefined,
  });
  if (!result.ok) {
    return externalOrderError(result.reason, undefined, ERROR_KEYS);
  }

  const total = result.data.total;
  return apiJson(
    result.data.orders.map(serializeExternalOrder),
    {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  );
}

/**
 * Idempotent innmelding av en ordre fra et annet system.
 *
 * `(source, externalId)` er alltid idempotensnøkkelen. `Idempotency-Key` kan
 * brukes i tillegg. En replay med samme innhold returnerer samme ordre med
 * `200`; samme nøkkel med annet innhold gir `409`.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth.actor, "workorders.create")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.orders.createForbidden",
    });
  }

  const parsed = await readJsonWithLimit<unknown>(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? apiError("validation_error", 413, { messageKey: "errors.api.tooLarge" })
      : apiError("validation_error", 400, {
          messageKey: "errors.api.invalidJson",
        });
  }
  if (!isRecord(parsed.data)) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.bodyObject",
    });
  }

  const body = parsed.data;
  const unknownField = Object.keys(body).find((key) => !CREATE_FIELDS.has(key));
  if (unknownField) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.orders.unknownField",
      details: { field: unknownField },
    });
  }

  const source = text(body.source);
  if (!source) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.sourceRequired",
      details: { field: "source" },
    });
  }
  const externalId = text(body.externalId);
  if (!externalId) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.externalIdRequired",
      details: { field: "externalId" },
    });
  }
  const title = text(body.title);
  if (!title) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.titleRequired",
      details: { field: "title" },
    });
  }
  if (!text(body.requestedDate) && !text(body.scheduledFor)) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.dateRequired",
      details: { field: "requestedDate" },
    });
  }
  if (body.lines !== undefined && !Array.isArray(body.lines)) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.invalidLines",
      details: { field: "lines" },
    });
  }
  if (
    !text(body.customerId) &&
    !text(body.customerNumber) &&
    !text(body.orgNumber)
  ) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.customerRequired",
    });
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey && idempotencyKey.length > 500) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.orders.validation",
      details: { field: "Idempotency-Key" },
    });
  }

  const payload =
    body.payload !== undefined ? body.payload : body.externalPayload;

  const result = await createExternalOrder(auth.actor, {
    source,
    externalId,
    idempotencyKey,
    customerId: body.customerId,
    customerNumber: body.customerNumber,
    orgNumber: body.orgNumber,
    siteId: body.siteId,
    departmentId: body.departmentId,
    title,
    description: body.description,
    requestedDate: body.requestedDate,
    scheduledFor: body.scheduledFor,
    priority: body.priority,
    lines: body.lines,
    payload,
  });
  if (!result.ok) {
    return externalOrderError(result.reason, result.details, {
      ...ERROR_KEYS,
      forbidden: "errors.api.orders.createForbidden",
      validation: "errors.api.orders.validation",
    });
  }

  const detail = await getExternalOrder(auth.actor, result.data.id);
  if (!detail.ok) {
    return externalOrderError(detail.reason, detail.details, ERROR_KEYS);
  }

  const response = apiJson(
    serializeExternalOrderDetail(detail.data),
    result.data.replay ? 200 : 201,
  );
  if (!result.data.replay) {
    response.headers.set(
      "Location",
      `/api/v1/orders/${result.data.id}`,
    );
  } else {
    response.headers.set("Idempotent-Replay", "true");
  }
  return response;
}
