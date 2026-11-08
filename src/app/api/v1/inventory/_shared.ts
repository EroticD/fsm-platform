import { apiError } from "@/lib/api-response";

export const INVENTORY_ERROR_KEYS = {
  forbidden: "errors.api.inventory.forbidden",
  notFound: "errors.api.inventory.notFound",
  conflict: "errors.api.inventory.conflict",
  validation: "errors.api.inventory.validation",
} as const;

/** Oversetter tjenestens stabile feilårsak til HTTP-kontrakten. */
export function inventoryError(
  error: string,
  details: unknown,
  forbiddenKey: string = INVENTORY_ERROR_KEYS.forbidden,
) {
  switch (error) {
    case "forbidden":
      return apiError("forbidden", 403, { messageKey: forbiddenKey });
    case "not_found":
      return apiError("not_found", 404, {
        messageKey: INVENTORY_ERROR_KEYS.notFound,
      });
    case "conflict":
      return apiError("conflict", 409, {
        messageKey: INVENTORY_ERROR_KEYS.conflict,
        details,
      });
    case "invalid":
    case "missing_fields":
      return apiError("validation_error", 422, {
        messageKey: INVENTORY_ERROR_KEYS.validation,
        details,
      });
    default:
      return apiError("server_error", 500, {
        messageKey: "errors.api.inventory.serverError",
      });
  }
}
