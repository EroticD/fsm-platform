import type { Prisma } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";

/**
 * Tilgangsregler for rapporter på tvers av avdelinger.
 *
 * Rapporter er egne dokumenter med egne rettigheter. Som standard ser ansatte
 * bare rapporter som hører til egen avdeling; `reports.viewAllDepartments`
 * utvider dette eksplisitt. Administrator ser alltid alle avdelinger, uavhengig
 * av om rettigheten er lagret på rollen.
 *
 * Kundeportalen har sin egen kundetilkobling og skal ikke bruke disse
 * hjelpefunksjonene. Kunder får derfor alltid tomt omfang her.
 */

type ReportScopeActor = {
  role?: string | null;
  isActive?: boolean | null;
  departmentId?: string | null;
  department?: { isActive?: boolean | null } | null;
  permissions?: string[] | null;
  permissionsCustomized?: boolean | null;
  roleDefinition?: { permissions?: string[] | null } | null;
};

const NO_REPORTS: Prisma.WorkOrderWhereInput = { id: { in: [] } };

/** Ser aktøren rapporter fra alle avdelinger? */
export function canViewAllDepartmentReports(
  actor?: ReportScopeActor | null,
): boolean {
  if (!actor?.isActive) return false;
  if (actor.role === "ADMIN") return true;
  return hasPermission(actor, "reports.viewAllDepartments");
}

/**
 * Oppdragsomfang for rapportspørringer.
 *
 * All-department viewere får et tomt omfang fordi rapportspørringene selv
 * filtrerer slettede rapporter/oppdrag. Andre ansatte avgrenses til egen,
 * aktive avdeling. Inaktive kontoer, kunder og brukere uten avdeling får et
 * omfang som aldri matcher.
 */
export function reportWorkOrderScope(
  actor?: ReportScopeActor | null,
): Prisma.WorkOrderWhereInput {
  if (!actor?.isActive) return NO_REPORTS;
  if (actor.role === "CUSTOMER") return NO_REPORTS;
  if (canViewAllDepartmentReports(actor)) {
    // Også administrator og globale rapportlesere skal bare se rapporter fra
    // aktive avdelinger. Inaktive avdelinger er stengt i PDF- og revisjons-
    // kontrollen, og listen må følge samme regel.
    return { department: { isActive: true } };
  }

  if (!actor.departmentId) return NO_REPORTS;
  if (actor.department?.isActive === false) return NO_REPORTS;

  return {
    departmentId: actor.departmentId,
    department: { isActive: true },
    deletedAt: null,
  };
}

export type ReportWorkOrderIdentity = {
  departmentId?: string | null;
  departmentIsActive?: boolean | null;
};

/**
 * Kan aktøren lese rapporter på dette oppdraget?
 *
 * En deaktivert avdeling stenger rapportene også for dem som normalt ser hele
 * organisasjonen. Kunder håndteres av kundeportalens egen kundetilkobling.
 */
export function canAccessReportWorkOrder(
  actor: ReportScopeActor | null | undefined,
  workOrder: ReportWorkOrderIdentity,
): boolean {
  if (!actor?.isActive) return false;
  if (actor.role === "CUSTOMER") return false;
  if (workOrder.departmentIsActive === false) return false;
  if (canViewAllDepartmentReports(actor)) return true;

  return Boolean(
    actor.departmentId &&
      workOrder.departmentId &&
      workOrder.departmentId === actor.departmentId,
  );
}
