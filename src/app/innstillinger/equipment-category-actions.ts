"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { equipmentErrorParam } from "@/lib/equipment-feedback";
import { moduleEnabled } from "@/server/modules";
import {
  createEquipmentCategory,
  deleteEquipmentCategory,
  updateEquipmentCategory,
} from "@/server/equipment";

function revalidateEquipmentCategories() {
  revalidatePath("/innstillinger");
  revalidatePath("/enheter");
}

function failureRedirect(error: string): never {
  redirect(`/innstillinger?tab=utstyr&error=${encodeURIComponent(error)}`);
}

export async function createEquipmentCategoryAction(formData: FormData) {
  if (!(await moduleEnabled("equipment"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/");

  const result = await createEquipmentCategory(actor, {
    name: formData.get("name"),
    parentId: formData.get("parentId"),
  });
  if (!result.ok) failureRedirect(equipmentErrorParam(result));

  revalidateEquipmentCategories();
  redirect("/innstillinger?tab=utstyr&ok=category-created");
}

export async function updateEquipmentCategoryAction(formData: FormData) {
  if (!(await moduleEnabled("equipment"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/");

  const result = await updateEquipmentCategory(actor, {
    id: formData.get("id"),
    name: formData.get("name"),
    parentId: formData.get("parentId"),
  });
  if (!result.ok) failureRedirect(equipmentErrorParam(result));

  revalidateEquipmentCategories();
  redirect("/innstillinger?tab=utstyr&ok=category-updated");
}

export async function deleteEquipmentCategoryAction(formData: FormData) {
  if (!(await moduleEnabled("equipment"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/");

  const result = await deleteEquipmentCategory(actor, String(formData.get("id") ?? ""));
  if (!result.ok) failureRedirect(equipmentErrorParam(result));

  revalidateEquipmentCategories();
  redirect("/innstillinger?tab=utstyr&ok=category-deleted");
}
