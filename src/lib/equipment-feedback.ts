import type { ServiceError, ServiceFailure } from "@/server/actor";

const EQUIPMENT_ERROR_FALLBACKS: Record<ServiceError, string> = {
  forbidden: "assets.errors.forbidden",
  invalid: "assets.errors.invalidInput",
  not_found: "assets.errors.notFound",
  conflict: "assets.errors.generic",
  in_use: "assets.errors.equipmentInUse",
  rate_limited: "assets.errors.generic",
  error: "assets.errors.generic",
  missing_fields: "assets.errors.invalidInput",
  missing_contact: "assets.errors.invalidInput",
  invalid_contact: "assets.errors.invalidInput",
  duplicate_email: "assets.errors.invalidInput",
  invalid_logo: "assets.errors.invalidInput",
  file_not_found: "assets.errors.notFound",
  customer_not_found: "assets.errors.notFound",
  deadline_passed: "assets.errors.generic",
};

/** Oversetter en tjenestefeil til en i18n-nøkkel under `assets.errors`. */
export function equipmentErrorKey(failure: ServiceFailure): string {
  const details = failure.details;
  if (details && typeof details === "object") {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") {
      if (code.startsWith("equipment.errors.")) {
        return `assets.errors.${code.slice("equipment.errors.".length)}`;
      }
      if (code.startsWith("maintenance.errors.")) {
        return `assets.errors.${code.slice("maintenance.errors.".length)}`;
      }
    }
  }
  return EQUIPMENT_ERROR_FALLBACKS[failure.reason] ?? "assets.errors.generic";
}

export const EQUIPMENT_FEEDBACK_KEYS: Record<string, string> = {
  created: "assets.feedback.created",
  updated: "assets.feedback.updated",
  moved: "assets.feedback.moved",
  "qr-rotated": "assets.feedback.qrRotated",
  "reading-added": "assets.feedback.readingAdded",
  "plan-created": "assets.feedback.planCreated",
  "plan-updated": "assets.feedback.planUpdated",
  deleted: "assets.feedback.deleted",
};

export const EQUIPMENT_ERROR_KEYS = new Set([
  "assets.errors.invalidInput",
  "assets.errors.invalidStatus",
  "assets.errors.invalidCriticality",
  "assets.errors.invalidDate",
  "assets.errors.invalidCategory",
  "assets.errors.invalidParent",
  "assets.errors.customerMismatch",
  "assets.errors.hierarchyCycle",
  "assets.errors.categoryCycle",
  "assets.errors.categoryInUse",
  "assets.errors.childrenInUse",
  "assets.errors.equipmentInUse",
  "assets.errors.retired",
  "assets.errors.invalidReading",
  "assets.errors.qrMissing",
  "assets.errors.forbidden",
  "assets.errors.notFound",
  "assets.errors.generic",
  "assets.errors.invalidTrigger",
  "assets.errors.invalidInterval",
  "assets.errors.invalidMeterInterval",
  "assets.errors.invalidDueDate",
  "assets.errors.productRequired",
  "assets.errors.invalidCustomer",
  "assets.errors.invalidDepartment",
  "assets.errors.invalidTemplate",
  "assets.errors.planInUse",
  "assets.errors.alreadyGenerated",
]);

export function equipmentFeedbackKey(value?: string | null): string | null {
  return value ? (EQUIPMENT_FEEDBACK_KEYS[value] ?? null) : null;
}

/** Query-verdi for feilmeldinger. Selve nøkkelen ligger i `assets.errors.*`. */
export function equipmentErrorParam(failure: ServiceFailure): string {
  return equipmentErrorKey(failure);
}
