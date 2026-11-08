import { apiError } from "@/lib/api-response";
import type {
  ExternalOrderDetail,
  ExternalOrderView,
} from "@/server/external-orders";

export function serializeExternalOrder(order: ExternalOrderView) {
  return {
    id: order.id,
    source: order.source,
    externalId: order.externalId,
    idempotencyKey: order.idempotencyKey,
    priority: order.priority,
    receivedAt: order.receivedAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customer: order.customer,
    site: order.site,
    totals: order.totals,
    lines: order.lines,
    workOrder: order.workOrder,
  };
}

export function serializeExternalOrderDetail(order: ExternalOrderDetail) {
  return {
    ...serializeExternalOrder(order),
    payload: order.payload,
  };
}

export function externalOrderError(
  error: string,
  details: unknown,
  keys: {
    forbidden: string;
    notFound: string;
    conflict: string;
    validation: string;
  },
) {
  switch (error) {
    case "forbidden":
      return apiError("forbidden", 403, { messageKey: keys.forbidden });
    case "not_found":
      return apiError("not_found", 404, { messageKey: keys.notFound });
    case "conflict":
      return apiError("conflict", 409, {
        messageKey: keys.conflict,
        details,
      });
    case "invalid":
    case "missing_fields":
      return apiError("validation_error", 422, {
        messageKey: keys.validation,
        details,
      });
    default:
      return apiError("server_error", 500, {
        messageKey: "errors.api.orders.serverError",
      });
  }
}
