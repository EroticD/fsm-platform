import prisma from "@/lib/prisma";
import { workOrderScope, type AccessUser } from "@/lib/access";
import type { Coordinates } from "@/lib/geo";
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

  const [visits, enabledDepartments] = await Promise.all([
    prisma.visit.findMany({
      where: {
        status: { in: ["EN_ROUTE", "ON_SITE"] },
        workOrder: {
          AND: [scope],
          department: { trackingEnabled: true },
        },
        locationPings: { some: { recordedAt: { gte: cutoff } } },
      },
      select: {
        id: true,
        status: true,
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
      },
    ];
  });

  return { enabled: enabledDepartments > 0, markers };
}
