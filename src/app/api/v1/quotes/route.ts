import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { isQuoteStatus, listQuotes, type QuoteStatusValue } from "@/server/quotes";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import {
  canManageQuotes,
  canReadQuotes,
  quoteError,
  serializeQuoteList,
} from "./_shared";
import { createQuote } from "@/server/quotes";

export const runtime = "nodejs";

const CREATE_FIELDS = new Set([
  "title",
  "customerId",
  "customerName",
  "contactId",
  "workOrderId",
  "contractId",
  "productId",
  "departmentId",
  "validUntil",
  "notes",
  "vatRate",
  "lines",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tilbud brukeren har tilgang til, alltid avgrenset av tjenestens omfang. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!canReadQuotes(auth.actor)) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.quotes.forbidden",
    });
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.max(
    1,
    Math.min(100, Number.parseInt(params.get("limit") ?? "50", 10) || 50),
  );
  const statusRaw = (params.get("status") ?? "").trim();
  if (statusRaw && !isQuoteStatus(statusRaw)) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.quotes.invalidStatus",
      details: { field: "status" },
    });
  }
  const customerId = (params.get("customerId") ?? "").trim().slice(0, 100);
  const query = (params.get("q") ?? "").trim().slice(0, 100);

  const result = await listQuotes(auth.actor, {
    page,
    pageSize: limit,
    status: statusRaw ? (statusRaw as QuoteStatusValue) : null,
    customerId,
    query,
  });
  if (!result.ok) return quoteError(result.reason, {
    forbidden: "errors.api.quotes.forbidden",
    notFound: "errors.api.quotes.notFound",
    conflict: "errors.api.quotes.conflict",
    validation: "errors.api.quotes.validation",
  });

  const total = result.data.total;
  return apiJson(
    result.data.quotes.map(serializeQuoteList),
    {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  );
}

/** Oppretter et tilbud. Alle beløp regnes på nytt på serveren. */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!canManageQuotes(auth.actor)) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.quotes.createForbidden",
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

  const unknownField = Object.keys(parsed.data).find(
    (key) => !CREATE_FIELDS.has(key),
  );
  if (unknownField) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.quotes.unknownField",
      details: { field: unknownField },
    });
  }

  const title =
    typeof parsed.data.title === "string" ? parsed.data.title.trim() : "";
  if (!title) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.quotes.titleRequired",
      details: { field: "title" },
    });
  }
  if (
    !Array.isArray(parsed.data.lines) ||
    parsed.data.lines.length === 0
  ) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.quotes.linesRequired",
      details: { field: "lines" },
    });
  }

  const result = await createQuote(auth.actor, {
    title,
    customerId: parsed.data.customerId,
    customerName: parsed.data.customerName,
    contactId: parsed.data.contactId,
    workOrderId: parsed.data.workOrderId,
    contractId: parsed.data.contractId,
    productId: parsed.data.productId,
    departmentId: parsed.data.departmentId,
    validUntil: parsed.data.validUntil,
    notes: parsed.data.notes,
    vatRate: parsed.data.vatRate,
    lines: parsed.data.lines,
  });
  if (!result.ok) {
    return quoteError(result.reason, {
      forbidden: "errors.api.quotes.createForbidden",
      notFound: "errors.api.quotes.notFound",
      conflict: "errors.api.quotes.conflict",
      validation: "errors.api.quotes.validation",
    });
  }

  const response = apiJson({ id: result.data.id }, 201);
  response.headers.set("Location", `/api/v1/quotes/${result.data.id}`);
  return response;
}
