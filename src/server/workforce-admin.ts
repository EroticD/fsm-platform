import prisma from "@/lib/prisma";
import {
  addDaysUtc,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import {
  can,
  fail,
  ok,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import {
  listCapacityPlans,
  type CapacityPlanView,
} from "./dispatch";
import {
  listAbsences,
  listSkills,
  listUserAvailability,
  listUserSkills,
  listWorkforceStaff,
  type AbsenceSummary,
  type SkillSummary,
  type UserAvailabilityWindow,
  type UserSkillSummary,
  type WorkforceStaffSummary,
} from "./workforce";

export type WorkforceDepartment = { id: string; name: string };

export type WorkforceAdminView = {
  skills: SkillSummary[];
  staff: WorkforceStaffSummary[];
  departments: WorkforceDepartment[];
  selectedStaffId: string | null;
  userSkills: UserSkillSummary[];
  availability: UserAvailabilityWindow[];
  absences: AbsenceSummary[];
  capacityPlans: CapacityPlanView[];
  capacityDepartmentId: string;
  capacityFrom: string;
  capacityTo: string;
  canReadSkills: boolean;
  canManageUsers: boolean;
  canManageDispatch: boolean;
};

export type WorkforceAdminParams = {
  staffId?: string | null;
  departmentId?: string | null;
  from?: string | null;
  to?: string | null;
};

function dateOrDefault(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
  const parsed = parseDateOnly(text);
  return parsed && toDateOnly(parsed) === text ? text : fallback;
}

/**
 * Samler lesedataene bemanningsfanen trenger. Funksjonen avgjør selv hvilke
 * deler aktøren får se: katalogen krever `users.view`, de ansattes detaljer
 * krever `users.manage`, og kapasitetsplanene krever `dispatch.configure`.
 */
export async function getWorkforceAdminView(
  actor: ServiceActor,
  params: WorkforceAdminParams = {},
): Promise<ServiceResult<WorkforceAdminView>> {
  const canReadSkills = can(actor, "users.view");
  const canManageUsers = can(actor, "users.manage");
  const canManageDispatch =
    can(actor, "dispatch.configure") || can(actor, "settings.manage");

  if (!canReadSkills && !canManageDispatch) return fail("forbidden");

  const departments = await prisma.department.findMany({
    where:
      actor.role === "ADMIN"
        ? { isActive: true }
        : { id: actor.departmentId ?? "", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  const skillsResult = canReadSkills
    ? await listSkills(actor)
    : null;
  const staffResult = canReadSkills
    ? await listWorkforceStaff(actor)
    : null;

  const skillRows = skillsResult?.ok ? skillsResult.data : [];
  const staffRows = staffResult?.ok ? staffResult.data : [];

  const requestedStaff = params.staffId?.trim() || "";
  const selectedStaffId =
    staffRows.find((person) => person.id === requestedStaff)?.id ??
    staffRows[0]?.id ??
    null;

  let userSkills: UserSkillSummary[] = [];
  let availability: UserAvailabilityWindow[] = [];
  let absences: AbsenceSummary[] = [];
  if (canManageUsers && selectedStaffId) {
    const [skillResult, availabilityResult, absenceResult] = await Promise.all([
      listUserSkills(actor, selectedStaffId),
      listUserAvailability(actor, selectedStaffId),
      listAbsences(actor, selectedStaffId),
    ]);
    if (skillResult.ok) userSkills = skillResult.data;
    if (availabilityResult.ok) availability = availabilityResult.data;
    if (absenceResult.ok) absences = absenceResult.data;
  }

  const today = todayInOslo();
  const capacityFrom = dateOrDefault(params.from, today);
  const capacityTo = dateOrDefault(
    params.to,
    toDateOnly(addDaysUtc(parseDateOnly(capacityFrom)!, 6)),
  );
  const capacityDepartmentId =
    departments.find((department) => department.id === params.departmentId)?.id ??
    departments[0]?.id ??
    "";

  let capacityPlans: CapacityPlanView[] = [];
  if (canManageDispatch && capacityDepartmentId) {
    const result = await listCapacityPlans(actor, {
      departmentId: capacityDepartmentId,
      from: capacityFrom,
      to: capacityTo < capacityFrom ? capacityFrom : capacityTo,
    });
    if (result.ok) capacityPlans = result.data;
  }

  return ok({
    skills: skillRows,
    staff: staffRows,
    departments,
    selectedStaffId,
    userSkills,
    availability,
    absences,
    capacityPlans,
    capacityDepartmentId,
    capacityFrom,
    capacityTo: capacityTo < capacityFrom ? capacityFrom : capacityTo,
    canReadSkills,
    canManageUsers,
    canManageDispatch,
  });
}
