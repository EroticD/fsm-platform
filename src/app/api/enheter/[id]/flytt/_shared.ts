import { noStoreJson } from "@/lib/http";
import type { ServiceFailure } from "@/server/actor";

/** HTTP-status for tjenestefeilene flytteflyten kan returnere. */
function statusFor(failure: ServiceFailure): number {
  switch (failure.reason) {
    case "forbidden":
      return 403;
    case "not_found":
    case "customer_not_found":
      return 404;
    case "invalid":
    case "missing_fields":
      return 400;
    case "conflict":
    case "in_use":
      return 409;
    default:
      return 500;
  }
}

/**
 * Intern JSON-feil for flytte-API-et. `code` er den stabile, oversettbare
 * nøkkelen fra tjenestelaget; detaljene inneholder aldri kundenavn eller
 * filinnhold.
 */
export function moveApiError(failure: ServiceFailure) {
  const details =
    failure.details && typeof failure.details === "object"
      ? (failure.details as { code?: unknown })
      : null;
  const code =
    typeof details?.code === "string" ? details.code : failure.reason;
  return noStoreJson(
    { error: { code, reason: failure.reason } },
    { status: statusFor(failure) },
  );
}
