import { getCurrentUser } from "@/lib/session";
import { noStoreJson } from "@/lib/http";
import { internalApiError } from "@/lib/api-errors";
import { listMoveTargetSites } from "@/server/equipment-move";
import { moveApiError } from "../_shared";
import { moduleApiGuard } from "@/lib/module-guards";

/** Steder for valgt målkunde, avgrenset til den kunden. */
export async function GET(request: Request) {
  const moduleGuard = await moduleApiGuard("equipment");
  if (moduleGuard) return moduleGuard;
  const user = await getCurrentUser();
  if (!user) return internalApiError("not_authenticated", 401);

  const customerId = new URL(request.url).searchParams.get("customerId") ?? "";
  const result = await listMoveTargetSites(user, customerId);
  if (!result.ok) return moveApiError(result);
  return noStoreJson(result.data);
}
