// i18n-ignore-file: API v1 beholder den eksisterende kontrakten med korte
// norske meldinger ved siden av stabile maskinlesbare koder i error.details.code.
import { apiError } from "@/lib/api-response";
import type { ServiceFailure } from "@/server/actor";
import {
  equipmentFailureStatus,
} from "@/server/equipment";

/** Felles feilmapping for utstyrs- og vedlikeholdsrutene i API v1. */
export function equipmentApiError(
  failure: ServiceFailure,
  messages: Partial<Record<ServiceFailure["reason"], string>> = {},
) {
  const status = equipmentFailureStatus(failure);
  const fallback =
    status === 403
      ? "Du har ikke tilgang."
      : status === 404
        ? "Fant ikke ressursen."
        : status === 409
          ? "Ressursen kan ikke endres."
          : status === 429
            ? "For mange API-kall. Prøv igjen senere."
            : status === 500
              ? "Kunne ikke fullføre forespørselen."
              : "Feltene er ikke gyldige.";
  return apiError(
    status,
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
              : "validation_error",
    messages[failure.reason] ?? fallback,
    failure.details,
  );
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
