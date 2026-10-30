import { apiError } from "@/lib/api-errors";
import type { ServiceFailure } from "@/server/actor";
import { equipmentFailureStatus } from "@/server/equipment";

export type EquipmentApiDomain = "equipment" | "maintenance";

/**
 * Felles feilmapping for utstyrs- og vedlikeholdsrutene i API v1.
 *
 * `messageKey` følger Phase 2-konvensjonen, slik at klienten kan oversette
 * teksten. `details.code` beholder de domenespesifikke, stabile kodene
 * (`equipment.errors.*` og `maintenance.errors.*`).
 */
export function equipmentApiError(
  failure: ServiceFailure,
  domain: EquipmentApiDomain = "equipment",
) {
  const status = equipmentFailureStatus(failure);
  const code =
    status === 403
      ? "forbidden"
      : status === 404
        ? "not_found"
        : status === 409
          ? "conflict"
          : status === 429
            ? "rate_limited"
            : status === 500
              ? "server_error"
              : "validation_error";
  const messageKey =
    status === 429
      ? "errors.api.rateLimited"
      : `errors.api.${domain}.${
          status === 403
            ? "forbidden"
            : status === 404
              ? "notFound"
              : status === 409
                ? "conflict"
                : status === 500
                  ? "serverError"
                  : "validation"
        }`;

  return apiError(code, status, {
    messageKey,
    details: failure.details,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function decimalString(
  value: { toString(): string } | null | undefined,
): string | null {
  return value ? value.toString() : null;
}
