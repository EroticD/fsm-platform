// i18n-ignore-file: autorisasjonsregler er kode, ikke UI-tekst.
import { hasPermission } from "@/lib/permissions";
import type { ServiceActor } from "@/server/actor";

/**
 * Eneste gyldige vakt for kundeoverføring:
 * aktiv bruker + rolle ADMIN + rettigheten settings.manage.
 *
 * Rollen alene er ikke nok (fremtidige begrensede adminroller), og
 * `settings.manage` alene er ikke nok (kontor har den). Begge kreves.
 */
export function canUseCustomerTransfer(
  user:
    | {
        role?: string | null;
        isActive?: boolean | null;
        permissions?: string[] | null;
        permissionsCustomized?: boolean | null;
        roleDefinition?: { permissions?: string[] | null } | null;
      }
    | null
    | undefined,
): boolean {
  if (!user?.isActive) return false;
  if (user.role !== "ADMIN") return false;
  return hasPermission(user, "settings.manage");
}

export type TransferActorSource = {
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

export function toTransferActor(user: TransferActorSource): ServiceActor {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    departmentId: user.departmentId,
    customerId: user.customerId ?? null,
    contactId: user.contactId ?? null,
    permissions: user.permissions ?? null,
    permissionsCustomized: user.permissionsCustomized ?? null,
    roleDefinition: user.roleDefinition ?? null,
  };
}
