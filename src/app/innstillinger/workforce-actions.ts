"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createAbsence,
  createSkill,
  deleteAbsence,
  deleteSkill,
  replaceUserAvailability,
  setUserSkills,
  updateAbsence,
  updateSkill,
} from "@/server/workforce";
import {
  deleteCapacityPlan,
  upsertCapacityPlan,
} from "@/server/dispatch";

function workforceHref(params: Record<string, string | undefined>) {
  const search = new URLSearchParams({ tab: "kompetanse" });
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return `/innstillinger?${search.toString()}`;
}

function revalidateWorkforce() {
  revalidatePath("/innstillinger");
  revalidatePath("/kalender/kapasitet");
  revalidatePath("/kalender/dispatch");
  revalidatePath("/oppdrag");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function timeToMinute(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  const total = hour * 60 + minute;
  return total <= 1440 ? total : null;
}

async function currentActor() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");
  return actor;
}

export async function createSkillAction(formData: FormData) {
  const actor = await currentActor();
  const result = await createSkill(actor, {
    key: text(formData, "key"),
    label: text(formData, "label"),
    category: text(formData, "category"),
  });
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "skill" }));
}

export async function updateSkillAction(formData: FormData) {
  const actor = await currentActor();
  const result = await updateSkill(actor, {
    id: formData.get("id"),
    key: text(formData, "key"),
    label: text(formData, "label"),
    category: text(formData, "category"),
  });
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "skill" }));
}

export async function deleteSkillAction(formData: FormData) {
  const actor = await currentActor();
  const result = await deleteSkill(actor, { id: formData.get("id") });
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "skill-deleted" }));
}

export async function setUserSkillsAction(formData: FormData) {
  const actor = await currentActor();
  const userId = text(formData, "userId");
  const skillIds = formData.getAll("skillIds").map(String).filter(Boolean);
  const inputs = skillIds.map((skillId) => ({
    skillId,
    level: formData.get(`level-${skillId}`),
    validUntil: formData.get(`validUntil-${skillId}`),
  }));
  const result = await setUserSkills(actor, userId, inputs);
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason, staff: userId }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "skills", staff: userId }));
}

export async function saveAvailabilityAction(formData: FormData) {
  const actor = await currentActor();
  const userId = text(formData, "userId");
  const weekdays = formData.getAll("weekday").map(String);
  const starts = formData.getAll("start").map(String);
  const ends = formData.getAll("end").map(String);

  const windows: Array<{
    weekday: number;
    startMinute: number;
    endMinute: number;
  }> = [];
  for (let index = 0; index < weekdays.length; index += 1) {
    const start = starts[index] ?? "";
    const end = ends[index] ?? "";
    if (!start && !end) continue;
    const startMinute = timeToMinute(start);
    const endMinute = timeToMinute(end);
    const weekday = Number(weekdays[index]);
    if (
      startMinute === null ||
      endMinute === null ||
      !Number.isInteger(weekday)
    ) {
      redirect(workforceHref({ error: "invalid", staff: userId }));
    }
    windows.push({ weekday, startMinute, endMinute });
  }

  const result = await replaceUserAvailability(actor, userId, windows);
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason, staff: userId }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "availability", staff: userId }));
}

export async function createAbsenceAction(formData: FormData) {
  const actor = await currentActor();
  const userId = text(formData, "userId");
  const result = await createAbsence(actor, {
    userId,
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    kind: formData.get("kind"),
    note: formData.get("note"),
  });
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason, staff: userId }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "absence", staff: userId }));
}

export async function updateAbsenceAction(formData: FormData) {
  const actor = await currentActor();
  const staff = text(formData, "returnStaff");
  const result = await updateAbsence(actor, {
    id: formData.get("id"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    kind: formData.get("kind"),
    note: formData.get("note"),
  });
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason, staff }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "absence", staff }));
}

export async function deleteAbsenceAction(formData: FormData) {
  const actor = await currentActor();
  const staff = text(formData, "returnStaff");
  const result = await deleteAbsence(actor, { id: formData.get("id") });
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason, staff }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "absence-deleted", staff }));
}

export async function saveCapacityPlanAction(formData: FormData) {
  const actor = await currentActor();
  const departmentId = text(formData, "departmentId");
  const result = await upsertCapacityPlan(actor, {
    departmentId,
    date: formData.get("date"),
    technicianId: formData.get("technicianId"),
    capacityMinutes: formData.get("capacityMinutes"),
  });
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason, department: departmentId }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "capacity", department: departmentId }));
}

export async function deleteCapacityPlanAction(formData: FormData) {
  const actor = await currentActor();
  const department = text(formData, "department");
  const result = await deleteCapacityPlan(
    actor,
    String(formData.get("id") ?? ""),
  );
  if (!result.ok) {
    redirect(workforceHref({ error: result.reason, department }));
  }
  revalidateWorkforce();
  redirect(workforceHref({ ok: "capacity-deleted", department }));
}
