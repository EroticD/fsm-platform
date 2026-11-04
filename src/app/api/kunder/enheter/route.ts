import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { noStoreJson } from "@/lib/http";
import { internalApiError } from "@/lib/api-errors";
import { getCustomerEquipmentOptions } from "@/server/equipment";

const MAX_QUERY = 120;

/**
 * Enheter for én kunde, brukt av overordnet-enhet-velgeren når kunden er valgt.
 *
 * Samme avgrensning som utstyrstjenesten: bare rader som hører til `customerId`
 * og som aktøren faktisk har `equipment.view` for. Ingen hele-register-lister.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !user.isActive || user.role === "CUSTOMER" || !hasPermission(user, "equipment.view")) {
    return internalApiError("forbidden", 403);
  }

  const limit = await allowRequestDb(
    `customer-equipment:${user.id}`,
    120,
    60_000,
  );
  if (!limit.allowed) {
    return internalApiError("rate_limited", 429, {
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const params = new URL(request.url).searchParams;
  const customerId = params.get("customerId")?.trim().slice(0, 64) ?? "";
  const query = params.get("q")?.trim().slice(0, MAX_QUERY) ?? "";
  const excludeId = params.get("excludeId")?.trim().slice(0, 64) ?? "";
  if (!customerId) return noStoreJson({ equipment: [], total: 0, query });

  const result = await getCustomerEquipmentOptions(user, customerId, {
    query,
    excludeId: excludeId || null,
  });
  if (!result.ok) {
    return internalApiError(
      result.reason === "forbidden" ? "forbidden" : result.reason === "not_found" ? "not_found" : "invalid_request",
      result.reason === "forbidden" ? 403 : result.reason === "not_found" ? 404 : 400,
    );
  }

  return noStoreJson(result.data);
}
