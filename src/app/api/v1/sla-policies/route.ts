import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Aktive SLA-policyer for API-klienter. Administrator ser alle; andre ser
 * globale policyer og policyer i egen avdeling. Klokker og avtaler refererer
 * til id-ene, så svaret inneholder bare trygge metadata.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (
    !hasPermission(auth.actor, "contracts.view") &&
    !hasPermission(auth.actor, "contracts.manage") &&
    !hasPermission(auth.actor, "sla.manage")
  ) {
    return apiError(403, "forbidden", "Du har ikke tilgang til SLA.");
  }

  const departmentFilter =
    auth.actor.role === "ADMIN"
      ? {}
      : auth.actor.departmentId
        ? {
            OR: [
              { departmentId: null },
              { departmentId: auth.actor.departmentId },
            ],
          }
        : { departmentId: null };

  const policies = await prisma.slaPolicy.findMany({
    where: {
      isActive: true,
      ...departmentFilter,
    },
    orderBy: [{ departmentId: "asc" }, { name: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      departmentId: true,
      responseMinutes: true,
      resolutionMinutes: true,
      businessHoursOnly: true,
      department: { select: { id: true, name: true } },
    },
  });

  return apiJson(policies);
}
