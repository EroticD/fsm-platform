import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { toDateOnly } from "@/lib/dates";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { getQuote, updateQuote } from "@/server/quotes";
import {
  canManageQuotes,
  canReadQuotes,
  quoteError,
  serializeQuoteDetail,
} from "../_shared";

export const runtime = "nodejs";

const PATCH_FIELDS = new Set([
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

const ERROR_KEYS = {
  forbidden: "errors.api.quotes.forbidden",
  notFound: "errors.api.quotes.notFound",
  conflict: "errors.api.quotes.conflict",
  validation: "errors.api.quotes.validation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function textOrEmpty(value: unknown): unknown {
  return value === undefined || value === null ? "" : value;
}

/** Ett tilbud, slått opp gjennom tjenestens avdelings-/kundeomfang. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!canReadQuotes(auth.actor)) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.quotes.forbidden",
    });
  }

  const { id } = await params;
  const result = await getQuote(auth.actor, id);
  if (!result.ok) return quoteError(result.reason, ERROR_KEYS);
  return apiJson(serializeQuoteDetail(result.data));
}

/**
 * Oppdaterer et tilbud som fortsatt er kladd. Felt som ikke sendes bevares,
 * slik at en integrasjon kan endre bare linjene eller bare notatet. Beløpene
 * regnes alltid på nytt av tjenestelaget.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!canManageQuotes(auth.actor)) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.quotes.updateForbidden",
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
  const unknownField = Object.keys(body).find((key) => !PATCH_FIELDS.has(key));
  if (unknownField) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.quotes.unknownField",
      details: { field: unknownField },
    });
  }
  if (!Object.keys(body).some((key) => PATCH_FIELDS.has(key))) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.quotes.noFields",
    });
  }

  const { id } = await params;
  const existing = await getQuote(auth.actor, id);
  if (!existing.ok) return quoteError(existing.reason, ERROR_KEYS);
  const quote = existing.data;

  const input = {
    title: hasOwn(body, "title") ? body.title : quote.title,
    customerId: hasOwn(body, "customerId")
      ? body.customerId
      : (quote.customerId ?? ""),
    customerName: hasOwn(body, "customerName")
      ? body.customerName
      : (quote.customerName ?? ""),
    contactId: hasOwn(body, "contactId")
      ? body.contactId
      : (quote.contactId ?? ""),
    workOrderId: hasOwn(body, "workOrderId")
      ? body.workOrderId
      : (quote.workOrderId ?? ""),
    contractId: hasOwn(body, "contractId")
      ? body.contractId
      : (quote.contractId ?? ""),
    productId: hasOwn(body, "productId")
      ? body.productId
      : (quote.productId ?? ""),
    departmentId: hasOwn(body, "departmentId")
      ? body.departmentId
      : quote.departmentId,
    validUntil: hasOwn(body, "validUntil")
      ? textOrEmpty(body.validUntil)
      : quote.validUntil
        ? toDateOnly(quote.validUntil)
        : "",
    notes: hasOwn(body, "notes") ? body.notes : (quote.notes ?? ""),
    vatRate: hasOwn(body, "vatRate") ? body.vatRate : quote.vatRate.toString(),
    lines: hasOwn(body, "lines")
      ? body.lines
      : quote.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity.toString(),
          unit: line.unit,
          unitPrice: line.unitPrice.toString(),
          vatRate: line.vatRate.toString(),
        })),
  };

  const updated = await updateQuote(auth.actor, id, input);
  if (!updated.ok) {
    return quoteError(updated.reason, {
      ...ERROR_KEYS,
      forbidden: "errors.api.quotes.updateForbidden",
    });
  }

  const fresh = await getQuote(auth.actor, id);
  if (!fresh.ok) return quoteError(fresh.reason, ERROR_KEYS);
  return apiJson(serializeQuoteDetail(fresh.data));
}
