import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import {
  getExternalOrder,
  updateExternalOrder,
} from "@/server/external-orders";
import {
  externalOrderError,
  serializeExternalOrderDetail,
} from "../_shared";

export const runtime = "nodejs";

const PATCH_FIELDS = new Set(["status", "cancel", "reason"]);

const ERROR_KEYS = {
  forbidden: "errors.api.orders.forbidden",
  notFound: "errors.api.orders.notFound",
  conflict: "errors.api.orders.conflict",
  validation: "errors.api.orders.validation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth.actor, "workorders.view")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.orders.forbidden",
    });
  }

  const { id } = await params;
  const result = await getExternalOrder(auth.actor, id);
  if (!result.ok) {
    return externalOrderError(result.reason, result.details, ERROR_KEYS);
  }
  return apiJson(serializeExternalOrderDetail(result.data));
}

/**
 * Endrer status på oppdraget som den eksterne ordren mapper til, eller
 * kansellerer det med `cancel: true`. Kansellering krever `workorders.edit`,
 * akkurat som i kontorflaten.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth.actor, "workorders.update")) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.orders.updateForbidden",
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
      messageKey: "errors.api.orders.unknownField",
      details: { field: unknownField },
    });
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasCancel = Object.prototype.hasOwnProperty.call(body, "cancel");
  if (!hasStatus && !hasCancel) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.orders.noFields",
    });
  }
  if (hasStatus && hasCancel) {
    return apiError("validation_error", 400, {
      messageKey: "errors.api.orders.validation",
      details: { field: "cancel" },
    });
  }
  if (hasCancel && typeof body.cancel !== "boolean") {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.validation",
      details: { field: "cancel" },
    });
  }
  if (hasCancel && body.cancel !== true) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.orders.validation",
      details: { field: "cancel" },
    });
  }

  const status = hasCancel ? "CANCELLED" : body.status;

  const { id } = await params;
  const result = await updateExternalOrder(auth.actor, id, {
    status,
    reason: body.reason,
  });
  if (!result.ok) {
    return externalOrderError(result.reason, result.details, {
      ...ERROR_KEYS,
      forbidden: "errors.api.orders.updateForbidden",
    });
  }
  return apiJson(serializeExternalOrderDetail(result.data));
}
