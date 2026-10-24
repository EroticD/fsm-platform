"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { idSchema } from "@/lib/schemas/common";
import * as workOrderService from "@/server/work-orders";

/** Tynne action-wrappere for feltportalens oppdragsside. */

function workOrderIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
  );
  return parsed.success ? parsed.data : "";
}

function errorRedirect(workOrderId: string, error: string): never {
  redirect(`/mine-oppdrag/${workOrderId}?error=${error}`);
}

export async function updateStatus(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.changeWorkOrderStatus(
    user,
    workOrderId,
    formData.get("status"),
    "field",
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function addComment(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addComment(
    user,
    workOrderId,
    formData.get("content"),
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function addTemplate(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addTemplate(
    user,
    workOrderId,
    formData.get("templateId"),
    "workorders.update",
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function addTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addTechnician(
    user,
    workOrderId,
    formData.get("userId"),
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function removeTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.removeTechnician(
    user,
    workOrderId,
    formData.get("userId"),
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}
