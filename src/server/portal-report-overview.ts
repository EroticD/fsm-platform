import prisma from "@/lib/prisma";
import {
  fail,
  ok,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

export const PORTAL_REPORT_PAGE_SIZE = 20;

/**
 * Rapporthistorikk for kundeportalen.
 *
 * Hver side viser hele oppdrag med *alle* rapportene sine – ikke bare den
 * nyeste. Kunden kan dermed kvittere hver enkelt rapport, også når et oppdrag
 * har flere sjekklister. Tjenesten er lesende; selve kvitteringen ligger i
 * `portal.ts`.
 */
export async function getPortalReportOverview(
  actor: ServiceActor,
  options: { page?: number } = {},
): Promise<ServiceResult<unknown>> {
  if (!actor.isActive || actor.role !== "CUSTOMER" || !actor.customerId) {
    return fail("forbidden");
  }

  const page = Math.max(1, Math.floor(options.page ?? 1));
  const where = {
    customerId: actor.customerId,
    deletedAt: null,
    reports: { some: { deletedAt: null } },
  };

  const [items, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      orderBy: { scheduledFor: "desc" },
      skip: (page - 1) * PORTAL_REPORT_PAGE_SIZE,
      take: PORTAL_REPORT_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        orderNumber: true,
        scheduledFor: true,
        reports: {
          where: { deletedAt: null },
          orderBy: { completedAt: "asc" },
          select: {
            id: true,
            name: true,
            templateTitle: true,
            requiresUnits: true,
            completedAt: true,
            isLocked: true,
            revision: true,
            pdfUrl: true,
            customerAcknowledgedAt: true,
            customerAcknowledgedBy: true,
            customerAcknowledgedComment: true,
          },
        },
      },
    }),
    prisma.workOrder.count({ where }),
  ]);

  return ok({
    items,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PORTAL_REPORT_PAGE_SIZE)),
  });
}
