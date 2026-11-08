import { authenticateApiRequest } from "@/lib/api-auth";
import { apiJson } from "@/lib/api-response";
import { consumeReservation } from "@/server/inventory";
import { inventoryError } from "../../../_shared";

export const runtime = "nodejs";

/** Forbruker en aktiv reservasjon og trekker fysisk beholdning. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await consumeReservation(auth.actor, id);
  if (!result.ok) {
    return inventoryError(
      result.reason,
      result.details,
      "errors.api.inventory.reservationForbidden",
    );
  }

  return apiJson({
    id: result.data.id,
    status: "CONSUMED",
    quantity: result.data.quantity,
  });
}
