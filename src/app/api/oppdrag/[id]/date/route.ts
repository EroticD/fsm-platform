import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { updateWorkOrderDate } from "@/server/work-orders";

/**
 * Flytter et oppdrag i kalenderen. All validering, autorisasjon og logging
 * ligger i `updateWorkOrderDate`; ruten oversetter bare resultatet til HTTP.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) {
    return internalApiError("invalid_origin", 403);
  }

  const user = await getCurrentUser();
  if (!user) {
    return internalApiError("not_authenticated", 401);
  }

  if (!user.isActive || !hasPermission(user, "workorders.update")) {
    return internalApiError("forbidden", 403);
  }

  // Maks 30 datoflyttinger per minutt per konto. Grensen ligger før kroppen
  // leses, slik at en misbrukt konto ikke kan bruke parsing som DoS-vektor.
  const limit = await allowRequestDb(`workorder-date:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return internalApiError("rate_limited", 429, {
      messageKey: "errors.api.upload.rateLimited",
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const { id } = await params;

  const parsed = await readJsonWithLimit(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return parsed.status === 413
      ? internalApiError("too_large", 413, { messageKey: "errors.api.tooLarge" })
      : internalApiError("invalid_data", 400, {
          messageKey: "errors.api.invalidData",
        });
  }

  const result = await updateWorkOrderDate(user, id, parsed.data);
  if (result.ok) return NextResponse.json({ success: true });

  switch (result.error) {
    case "ikke-autentisert":
      return internalApiError("not_authenticated", 401);
    case "ingen-tilgang":
      return internalApiError("forbidden", 403);
    case "ugyldig-dato":
      return internalApiError("invalid_date", 400, {
        messageKey: "errors.api.date.invalid",
      });
    case "dato-mangler":
      return internalApiError("date_missing", 400, {
        messageKey: "errors.api.date.missing",
      });
    case "ugyldig-sluttdato":
      return internalApiError("invalid_end_date", 400, {
        messageKey: "errors.api.date.invalidEnd",
      });
    case "sluttdato-for-startdato":
      return internalApiError("end_before_start", 400, {
        messageKey: "errors.api.date.endBeforeStart",
      });
    case "ikke-funnet":
      return internalApiError("not_found", 404, {
        messageKey: "errors.api.date.notFound",
      });
    case "legal-hold":
      return internalApiError("legal_hold", 403, {
        messageKey: "errors.api.date.legalHold",
      });
    case "ukjent":
      return internalApiError("server_error", 500, {
        messageKey: "errors.api.date.saveFailed",
      });
  }
}
