"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  addManualTime,
  deleteTimeEntry,
  startTimer,
  stopTimer,
} from "@/server/time";
import { addMaterial, deleteMaterial } from "@/server/materials";

function workOrderId(formData: FormData): string {
  const value = formData.get("workOrderId");
  return typeof value === "string" ? value.trim() : "";
}

function revalidateWorkOrder(id: string) {
  revalidatePath(`/oppdrag/${id}`);
  revalidatePath(`/mine-oppdrag/${id}`);
}

export async function startTimerAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = workOrderId(formData);
  await startTimer(user, {
    workOrderId: id,
    description: formData.get("description"),
  });
  revalidateWorkOrder(id);
}

export async function stopTimerAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = workOrderId(formData);
  await stopTimer(user, { id: formData.get("entryId") });
  revalidateWorkOrder(id);
}

export async function addTimeAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = workOrderId(formData);
  await addManualTime(user, {
    workOrderId: id,
    startedAt: formData.get("startedAt"),
    endedAt: formData.get("endedAt") || null,
    minutes: formData.get("minutes") || undefined,
    description: formData.get("description"),
    billable: formData.get("billable") === "on",
    hourlyRate: formData.get("hourlyRate") || undefined,
  });
  revalidateWorkOrder(id);
}

export async function deleteTimeAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = workOrderId(formData);
  await deleteTimeEntry(user, { id: formData.get("entryId") });
  revalidateWorkOrder(id);
}

export async function addMaterialAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = workOrderId(formData);
  await addMaterial(user, {
    workOrderId: id,
    name: formData.get("name"),
    sku: formData.get("sku") || null,
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "stk",
    unitPrice: formData.get("unitPrice"),
  });
  revalidateWorkOrder(id);
}

export async function deleteMaterialAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = workOrderId(formData);
  await deleteMaterial(user, { id: formData.get("materialId") });
  revalidateWorkOrder(id);
}
