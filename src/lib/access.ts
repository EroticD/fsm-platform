import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, type Permission } from "@/lib/permissions";

/** Rollene som regnes som interne ansatte. */
export const STAFF_ROLES = ["ADMIN", "OFFICE", "TECHNICIAN"] as const;

export type AccessUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export function isAdminUser(user?: { role?: string | null } | null): boolean {
  return user?.role === "ADMIN";
}

export function isStaffUser(user?: { role?: string | null } | null): boolean {
  return Boolean(user && (STAFF_ROLES as readonly string[]).includes(user.role ?? ""));
}

/**
 * Rettigheter som gir tilgang til oppdrag. Vanlige ansattroller har dette via
 * rollen, men en bruker med rollen USER kan få det som ekstra rettighet.
 */
const WORK_ORDER_PERMISSIONS: Permission[] = [
  "workorders.view",
  "workorders.create",
  "workorders.update",
  "workorders.edit",
  "workorders.assign",
  "reports.write",
];

function canUseWorkOrders(user: AccessUser): boolean {
  return (
    isStaffUser(user) ||
    WORK_ORDER_PERMISSIONS.some((permission) => hasPermission(user, permission))
  );
}

/**
 * Hvilke oppdrag brukeren kan se.
 *
 * - Administrator ser alt.
 * - Kundeportalbrukere ser bare oppdrag for sin egen kunde.
 * - Kontor og montører ser bare oppdrag i sin egen avdeling.
 * - Brukere uten avdeling ser ingen oppdrag.
 */
export function workOrderScope(user?: AccessUser | null): Prisma.WorkOrderWhereInput {
  if (!user?.isActive) return { id: { in: [] } };
  if (user.role === "ADMIN") return {};
  if (user.role === "CUSTOMER") {
    return user.customerId ? { customerId: user.customerId } : { id: { in: [] } };
  }
  if (!canUseWorkOrders(user) || !user.departmentId) return { id: { in: [] } };
  return { departmentId: user.departmentId };
}

/** Sjekker et oppdragsobjekt mot brukerens avdeling/kundetilhørighet. */
export function canAccessWorkOrder(
  user: AccessUser | null | undefined,
  workOrder: { departmentId?: string | null; customerId?: string | null },
): boolean {
  if (!user?.isActive) return false;
  if (user.role === "ADMIN") return true;
  if (user.role === "CUSTOMER") {
    return Boolean(user.customerId && workOrder.customerId === user.customerId);
  }
  return Boolean(
    canUseWorkOrders(user) &&
      user.departmentId &&
      workOrder.departmentId === user.departmentId,
  );
}

/**
 * Vakt for server actions og ruter som gjelder ett bestemt oppdrag. Slår
 * sammen rettighetskontroll og avdelingskontroll, slik at en skjult knapp
 * ikke er eneste hinder.
 */
export async function requireWorkOrderAccess(
  permission: Permission,
  workOrderId: string,
): Promise<{
  user: AccessUser;
  workOrder: {
    id: string;
    departmentId: string;
    customerId: string | null;
    status: string;
  };
} | null> {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, permission)) return null;

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    select: { id: true, departmentId: true, customerId: true, status: true },
  });
  if (!workOrder) return null;

  // Kansellerte oppdrag er lukket for montørene. Kontor og administrator
  // trenger dem fortsatt for oppfølging og kunderelatert historikk.
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    return null;
  }

  return { user, workOrder };
}

/** Ansatte brukeren kan se i lister (egen avdeling, eller alle for admin). */
export function staffScope(user?: AccessUser | null): Prisma.UserWhereInput {
  if (!user?.isActive) return { id: { in: [] } };
  if (user.role === "ADMIN") {
    return { role: { in: [...STAFF_ROLES] } };
  }
  if (!user.departmentId) return { id: { in: [] } };
  return { role: { in: [...STAFF_ROLES] }, departmentId: user.departmentId };
}

/** Ansatte i en bestemt avdeling – brukes ved tildeling av montører. */
export function staffForDepartment(departmentId?: string | null): Prisma.UserWhereInput {
  if (!departmentId) return { id: { in: [] } };
  return { role: { in: [...STAFF_ROLES] }, departmentId };
}

/** Ansatte i samme avdeling som brukeren, for søk og oversikter. */
export function departmentUsersScope(user?: AccessUser | null): Prisma.UserWhereInput {
  if (!user?.isActive) return { id: { in: [] } };
  if (user.role === "ADMIN") return {};
  if (!user.departmentId) return { id: { in: [] } };
  return { departmentId: user.departmentId };
}
