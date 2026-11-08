import { authenticateApiRequest } from "@/lib/api-auth";
import { apiJson } from "@/lib/api-response";
import { listInventory } from "@/server/inventory";
import { inventoryError } from "../_shared";

export const runtime = "nodejs";

/** Lagerlokasjoner i aktørens avdelingsomfang, med antall varer og lavbeholdning. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const result = await listInventory(auth.actor);
  if (!result.ok) {
    return inventoryError(result.reason, result.details);
  }

  return apiJson(result.data.locations, {
    total: result.data.locations.length,
  });
}
