import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { reserveStock } from "@/server/inventory";
import { inventoryError } from "../_shared";
import type { ErrorCode } from "@/lib/error-codes";

export const runtime = "nodejs";

const CREATE_FIELDS = new Set([
  "itemId",
  "locationId",
  "quantity",
  "workOrderId",
  "visitId",
  "note",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reserverer deler mot et oppdrag eller en visitt. Reservasjonen og
 * beholdningslåsen kjøres atomisk i tjenestelaget; utilstrekkelig beholdning
 * gir 409 og ingen delvis endring.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

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
      messageKey: "errors.api.inventory.unknownField",
      details: { field: unknownField },
    });
  }

  if (!text(body.itemId)) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.inventory.itemRequired",
      details: { field: "itemId" },
    });
  }
  if (!text(body.locationId)) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.inventory.locationRequired",
      details: { field: "locationId" },
    });
  }
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.inventory.quantityRequired",
      details: { field: "quantity" },
    });
  }
  if (!text(body.workOrderId) && !text(body.visitId)) {
    return apiError("validation_error", 422, {
      messageKey: "errors.api.inventory.validation",
      details: { field: "workOrderId", code: "inventory.workOrderRequired" satisfies ErrorCode },
    });
  }

  const result = await reserveStock(auth.actor, {
    itemId: body.itemId,
    locationId: body.locationId,
    quantity,
    workOrderId: body.workOrderId,
    visitId: body.visitId,
    note: body.note,
  });
  if (!result.ok) {
    return inventoryError(
      result.reason,
      result.details,
      "errors.api.inventory.reservationForbidden",
    );
  }

  return apiJson({ status: "ACTIVE", ...result.data }, 201);
}
