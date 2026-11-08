import { authenticateApiRequest } from "@/lib/api-auth";
import { apiJson } from "@/lib/api-response";
import { listStockLevels } from "@/server/inventory";
import { inventoryError } from "../_shared";

export const runtime = "nodejs";

/** Beholdning per vare og lokasjon, valgfritt filtrert. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const result = await listStockLevels(auth.actor, {
    itemId: (url.searchParams.get("itemId") ?? "").trim() || undefined,
    locationId: (url.searchParams.get("locationId") ?? "").trim() || undefined,
  });
  if (!result.ok) {
    return inventoryError(result.reason, result.details);
  }

  return apiJson(result.data, { total: result.data.length });
}
