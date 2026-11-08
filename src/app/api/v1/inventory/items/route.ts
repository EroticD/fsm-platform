import { authenticateApiRequest } from "@/lib/api-auth";
import { apiJson } from "@/lib/api-response";
import { listInventory } from "@/server/inventory";
import { inventoryError } from "../_shared";

export const runtime = "nodejs";

/** Alle aktive varer med beholdning i aktørens lokasjoner. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const result = await listInventory(auth.actor, { q });
  if (!result.ok) {
    return inventoryError(result.reason, result.details);
  }

  return apiJson(result.data.items, { total: result.data.items.length });
}
