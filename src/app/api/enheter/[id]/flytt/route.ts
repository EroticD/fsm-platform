import { getCurrentUser } from "@/lib/session";
import { noStoreJson } from "@/lib/http";
import { internalApiError } from "@/lib/api-errors";
import { getEquipmentMovePreview } from "@/server/equipment-move";
import { moveApiError } from "./_shared";
import { moduleApiGuard } from "@/lib/module-guards";

/**
 * Forhåndsvisning for flytte-skjemaet. Klienten kaller denne når målkunde
 * eller målsted endres, slik at bekreftelsen alltid bygger på ferske tall.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const moduleGuard = await moduleApiGuard("equipment");
  if (moduleGuard) return moduleGuard;
  const user = await getCurrentUser();
  if (!user) return internalApiError("not_authenticated", 401);

  const { id } = await params;
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const siteId = url.searchParams.get("siteId");

  const result = await getEquipmentMovePreview(user, id, customerId, siteId);
  if (!result.ok) return moveApiError(result);
  return noStoreJson(result.data);
}
