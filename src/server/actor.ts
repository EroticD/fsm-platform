import type { Prisma } from "@prisma/client";
import type { AuditActor } from "@/lib/audit";
import { hasPermission, type Permission } from "@/lib/permissions";

/**
 * Aktøren en tjenestefunksjon handler på vegne av.
 *
 * Tjenestene tar aktøren som eksplisitt argument i stedet for å lese økten
 * selv. Da kan autorisasjonen testes uten en innlogget nettleser, og det er
 * tydelig at hver mutasjon sjekker rettighetene på nytt – også når kallet
 * kommer fra en skjult knapp eller en direkte POST.
 */
export type ServiceActor = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
  departmentId: string | null;
  customerId?: string | null;
  contactId?: string | null;
  permissions?: string[] | null;
  permissionsCustomized?: boolean | null;
  roleDefinition?: { permissions?: string[] | null } | null;
};

/** Feilårsaker tjenestene kan returnere til den tynne action-wrapperen. */
export type ServiceError =
  | "forbidden"
  | "invalid"
  | "not_found"
  | "conflict"
  | "in_use"
  | "rate_limited"
  | "error"
  | "missing_fields"
  | "missing_contact"
  | "invalid_contact"
  | "duplicate_email"
  | "invalid_logo"
  | "file_not_found"
  | "customer_not_found";

export type ServiceFailure = {
  ok: false;
  reason: ServiceError;
  /** Valgfri tilleggsinformasjon, f.eks. hva en mal er i bruk til. */
  details?: unknown;
};

export type ServiceResult<T = undefined> =
  | { ok: true; data: T }
  | ServiceFailure;

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail(reason: ServiceError, details?: unknown): ServiceFailure {
  return details === undefined ? { ok: false, reason } : { ok: false, reason, details };
}

/** Aktørformatet revisjonsloggen lagrer. */
export function toAuditActor(actor: ServiceActor): AuditActor {
  return { id: actor.id, name: actor.name, email: actor.email };
}

export function can(actor: ServiceActor, permission: Permission): boolean {
  return hasPermission(actor, permission);
}

export function isAdminActor(actor: ServiceActor): boolean {
  return actor.role === "ADMIN";
}

export function isOfficeActor(actor: ServiceActor): boolean {
  return actor.role === "ADMIN" || actor.role === "OFFICE";
}

const WORK_ORDER_PERMISSIONS: Permission[] = [
  "workorders.view",
  "workorders.create",
  "workorders.update",
  "workorders.edit",
  "workorders.assign",
  "reports.write",
];

/**
 * Samme avdelingssperre som `workOrderScope` i src/lib/access.ts.
 * Tjenestene holder sin egen kopi fordi de ikke skal være avhengige av
 * øktmodulen, som trekker inn NextAuth.
 */
export function workOrderScopeFor(
  actor: ServiceActor,
): Prisma.WorkOrderWhereInput {
  if (!actor.isActive) return { id: { in: [] } };
  if (actor.role === "ADMIN") return { deletedAt: null };
  if (actor.role === "CUSTOMER") {
    return actor.customerId
      ? { customerId: actor.customerId, deletedAt: null }
      : { id: { in: [] } };
  }
  const canUseWorkOrders = WORK_ORDER_PERMISSIONS.some((permission) =>
    hasPermission(actor, permission),
  );
  if (!canUseWorkOrders || !actor.departmentId) return { id: { in: [] } };
  return {
    departmentId: actor.departmentId,
    department: { isActive: true },
    deletedAt: null,
  };
}

/** Samme avdelingssperre som `staffScope` i src/lib/access.ts. */
export function staffScopeFor(actor: ServiceActor): Prisma.UserWhereInput {
  if (!actor.isActive) return { id: { in: [] } };
  const permissionFilter: Prisma.UserWhereInput = {
    isActive: true,
    role: { not: "CUSTOMER" },
    department: { isActive: true },
    OR: [
      {
        permissionsCustomized: false,
        roleDefinition: {
          permissions: { hasSome: [...WORK_ORDER_PERMISSIONS] },
        },
      },
      {
        permissionsCustomized: true,
        permissions: { hasSome: [...WORK_ORDER_PERMISSIONS] },
      },
    ],
  };
  if (actor.role === "ADMIN") return permissionFilter;
  if (!actor.departmentId) return { id: { in: [] } };
  return { AND: [permissionFilter, { departmentId: actor.departmentId }] };
}
