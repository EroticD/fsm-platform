import { authenticateApiRequest } from "@/lib/api-auth";
import { apiJson } from "@/lib/api-response";
import { getInventoryItem } from "@/server/inventory";
import { inventoryError } from "../../_shared";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await getInventoryItem(auth.actor, id);
  if (!result.ok) {
    return inventoryError(result.reason, result.details);
  }
  return apiJson(result.data);
}
