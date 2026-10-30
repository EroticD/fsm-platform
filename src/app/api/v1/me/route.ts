import { authenticateApiRequest } from "@/lib/api-auth";
import { apiJson } from "@/lib/api-response";
import { effectivePermissions } from "@/lib/permissions";

export const runtime = "nodejs";

/**
 * Identiteten bak API-nøkkelen.
 *
 * Nøkkelen arver brukerens rettigheter, så svaret viser de effektive
 * rettighetene etter at rollen og en eventuell tilpasset liste er slått
 * sammen. Hemmeligheter som passord, 2FA og øktversjon sendes aldri ut.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  const { actor } = auth;

  return apiJson({
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
    department: actor.department
      ? { id: actor.department.id, name: actor.department.name }
      : null,
    permissions: Array.from(effectivePermissions(actor)),
    customerId: actor.customerId ?? null,
  });
}
