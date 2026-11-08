import { authenticateApiRequest } from "@/lib/api-auth";
import { apiJson } from "@/lib/api-response";
import { releaseReservation } from "@/server/inventory";
import { inventoryError } from "../../../_shared";

export const runtime = "nodejs";

/** Frigjør en aktiv reservasjon uten å trekke fysisk beholdning. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await releaseReservation(auth.actor, id);
  if (!result.ok) {
    return inventoryError(
      result.reason,
      result.details,
      "errors.api.inventory.reservationForbidden",
    );
  }

  return apiJson({ id: result.data.id, status: "RELEASED" });
}
