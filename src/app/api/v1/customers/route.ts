import type { Prisma } from "@prisma/client";
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/** Maks lengde på fritekstsøket, slik at en URL ikke kan gjøre spørringen tung. */
const MAX_QUERY_LENGTH = 100;

function readQuery(url: URL): string {
  return (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
}

/**
 * Aktive kunder for API-klienter.
 *
 * Kunder er felles for alle avdelinger, så listen avgrenses bare av
 * `customers.view` og myk sletting. Feltene er de samme kundekortet viser i
 * listen; notater og andre detaljer krever detaljendepunktet.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "customers.view")) {
    return apiError("forbidden", 403, { messageKey: "errors.api.customers.forbidden" });
  }

  const url = new URL(request.url);
  const { page, limit, skip } = parseApiPagination(url);
  const query = readQuery(url);

  const where: Prisma.CustomerWhereInput = { deletedAt: null };
  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    where.OR = [
      { name: contains },
      { orgNumber: contains },
      { customerNumber: contains },
      { city: contains },
    ];
  }

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        customerNumber: true,
        orgNumber: true,
        city: true,
        phone: true,
        email: true,
        departmentId: true,
        responsibleTechnician: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
  ]);

  return apiJson(customers, paginationMeta(total, page, limit));
}
