"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  deleteTerritory,
  saveAssignmentPolicy,
  saveTerritory,
} from "@/server/dispatch";

function dispatchHref(params: Record<string, string>) {
  return `/innstillinger?${new URLSearchParams({
    tab: "dispatch",
    ...params,
  }).toString()}`;
}

function revalidateDispatch() {
  revalidatePath("/innstillinger");
  revalidatePath("/kalender/dispatch");
  revalidatePath("/kalender/kapasitet");
}

function weight(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "0");
}

export async function saveDispatchPolicyAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const departmentId = String(formData.get("departmentId") ?? "");
  const result = await saveAssignmentPolicy(actor, {
    id: formData.get("id") ? String(formData.get("id")) : null,
    departmentId,
    mode: String(formData.get("mode") ?? "SKILLS"),
    weights: {
      skills: weight(formData, "weightSkills"),
      distance: weight(formData, "weightDistance"),
      travel: weight(formData, "weightTravel"),
      free: weight(formData, "weightFree"),
      sla: weight(formData, "weightSla"),
      load: weight(formData, "weightLoad"),
    },
    isActive: formData.get("isActive") !== "off",
  });

  if (!result.ok) {
    redirect(dispatchHref({ error: result.reason, department: departmentId }));
  }
  revalidateDispatch();
  redirect(dispatchHref({ ok: "policy", department: departmentId }));
}

export async function saveTerritoryAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const departmentId = String(formData.get("departmentId") ?? "");
  const result = await saveTerritory(actor, {
    id: formData.get("id") ? String(formData.get("id")) : null,
    departmentId,
    name: String(formData.get("name") ?? ""),
    postalPrefixes: String(formData.get("postalPrefixes") ?? ""),
    municipalityCodes: String(formData.get("municipalityCodes") ?? ""),
    radiusKm: formData.get("radiusKm"),
    centerLat: formData.get("centerLat"),
    centerLng: formData.get("centerLng"),
    isActive: formData.get("isActive") !== "off",
  });

  if (!result.ok) {
    redirect(dispatchHref({ error: result.reason, department: departmentId }));
  }
  revalidateDispatch();
  redirect(dispatchHref({ ok: "territory", department: departmentId }));
}

export async function deleteTerritoryAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const departmentId = String(formData.get("departmentId") ?? "");
  const result = await deleteTerritory(
    actor,
    String(formData.get("id") ?? ""),
  );
  if (!result.ok) {
    redirect(dispatchHref({ error: result.reason, department: departmentId }));
  }
  revalidateDispatch();
  redirect(dispatchHref({ ok: "territory-deleted", department: departmentId }));
}
