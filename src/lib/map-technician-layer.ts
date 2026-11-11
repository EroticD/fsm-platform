import prisma from "@/lib/prisma";
import { workOrderScope, type AccessUser } from "@/lib/access";
import type { Coordinates } from "@/lib/geo";
import {
  isClosedStatus,
  statusKeysByCategory,
} from "@/lib/work-order-status";
import { LOCATION_PING_RETENTION_MS } from "@/server/tracking";

/**
 * Teknikerlaget på kartet.
 *
 * Kilden er `VisitLocationPing`: bare ferske pinger (24 timer), bare visiter
 * som faktisk er `EN_ROUTE` eller `ON_SITE`, og bare avdelinger der sporing er
 * slått på. Vi returnerer én siste posisjon per visitt – aldri historikk – og
 * respekterer samme avdelingssperre som resten av kartet.
 */
export type TechnicianMapMarker = {
  visitId: string;
  userId: string;
  name: string;
  status: string;
  updatedAt: Date;
  point: Coordinates;
  workOrderId: string;
  workOrderTitle: string;
  customerName: string | null;
};

export type TechnicianMapLayer = {
  enabled: boolean;
  markers: TechnicianMapMarker[];
};

export const TECHNICIAN_MAP_PING_MAX_AGE_MS = LOCATION_PING_RETENTION_MS;
const MAX_MARKERS = 200;

export async function loadTechnicianMapLayer(
  user?: AccessUser | null,
): Promise<TechnicianMapLayer> {
  const cutoff = new Date(Date.now() - TECHNICIAN_MAP_PING_MAX_AGE_MS);
  const scope = workOrderScope(user);
  const closedStatuses = statusKeysByCategory("CLOSED");

  const [visits, enabledDepartments] = await Promise.all([
    prisma.visit.findMany({
      where: {
        status: { in: ["EN_ROUTE", "ON_SITE"] },
        workOrder: {
          AND: [scope, { status: { notIn: closedStatuses } }],
          department: { trackingEnabled: true },
        },
        locationPings: { some: { recordedAt: { gte: cutoff } } },
      },
      select: {
        id: true,
        status: true,
        workOrder: {
          select: {
            id: true,
            title: true,
            status: true,
            customer: { select: { name: true } },
          },
        },
        technicians: {
          select: {
            userId: true,
            user: { select: { name: true } },
          },
          take: 10,
        },
        locationPings: {
          where: { recordedAt: { gte: cutoff } },
          orderBy: { recordedAt: "desc" },
          take: 1,
          select: {
            userId: true,
            latitude: true,
            longitude: true,
            recordedAt: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_MARKERS,
    }),
    prisma.department.count({
      where:
        user?.role === "ADMIN"
          ? { trackingEnabled: true, isActive: true }
          : user?.departmentId
            ? {
                id: user.departmentId,
                trackingEnabled: true,
                isActive: true,
              }
            : { id: { in: [] } },
    }),
  ]);

  const markers = visits.flatMap((visit) => {
    // Forsvar i dybden: spørringen filtrerer bort lukkede oppdrag, men en
    // gammel/konfigurert status skal aldri gi et «på vei»-markør på kartet.
    if (isClosedStatus(visit.workOrder.status)) return [];
    const ping = visit.locationPings[0];
    if (!ping) return [];
    const technician =
      visit.technicians.find((row) => row.userId === ping.userId) ??
      visit.technicians[0];
    return [
      {
        visitId: visit.id,
        userId: ping.userId,
        name: technician?.user.name ?? technician?.userId ?? "",
        status: visit.status,
        updatedAt: ping.recordedAt,
        point: { latitude: ping.latitude, longitude: ping.longitude },
        workOrderId: visit.workOrder.id,
        workOrderTitle: visit.workOrder.title,
        customerName: visit.workOrder.customer?.name ?? null,
      },
    ];
  });

  return { enabled: enabledDepartments > 0, markers };
}
