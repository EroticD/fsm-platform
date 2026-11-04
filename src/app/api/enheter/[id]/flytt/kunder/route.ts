import { getCurrentUser } from "@/lib/session";
import { noStoreJson } from "@/lib/http";
import { internalApiError } from "@/lib/api-errors";
import { searchMoveCustomers } from "@/server/equipment-move";
import { moveApiError } from "../_shared";

/** Serversøk etter målkunde. Tomt søk gir tom liste, aldri hele registeret. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return internalApiError("not_authenticated", 401);

  const query = new URL(request.url).searchParams.get("q") ?? "";
  const result = await searchMoveCustomers(user, query);
  if (!result.ok) return moveApiError(result);
  return noStoreJson(result.data);
}
