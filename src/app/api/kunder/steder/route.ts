import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { noStoreJson } from "@/lib/http";
import { internalApiError } from "@/lib/api-errors";
import {
  CUSTOMER_SITE_OPTION_MAX,
  getCustomerSiteOptions,
} from "@/server/customer-sites";

const MAX_QUERY = 120;

function canReadSites(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  return (
    hasPermission(user, "customers.view") ||
    hasPermission(user, "equipment.view") ||
    hasPermission(user, "workorders.create") ||
    hasPermission(user, "workorders.edit")
  );
}

/**
 * Steder for én kunde, brukt når kunden velges i oppdrags- og utstyrsskjemaet.
 *
 * Endepunktet er alltid avgrenset til `customerId` og slipper aldri ut steder
 * som hører til en annen kunde. Tilgangen kontrolleres på nytt her, uavhengig
 * av hva siden som viste skjemaet hadde lov til.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !user.isActive || user.role === "CUSTOMER" || !canReadSites(user)) {
    return internalApiError("forbidden", 403);
  }

  const limit = await allowRequestDb(
    `customer-sites:${user.id}`,
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
  if (!customerId) return noStoreJson({ sites: [], total: 0, query });

  const result = await getCustomerSiteOptions(user, customerId, {
    query,
    limit: CUSTOMER_SITE_OPTION_MAX,
  });
  if (!result.ok) {
    return internalApiError(
      result.reason === "forbidden" ? "forbidden" : result.reason === "not_found" ? "not_found" : "invalid_request",
      result.reason === "forbidden" ? 403 : result.reason === "not_found" ? 404 : 400,
    );
  }

  return noStoreJson(result.data);
}
