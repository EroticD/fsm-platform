"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { idSchema } from "@/lib/schemas/common";
import * as workOrderService from "@/server/work-orders";
import { setReportLock as setReportLockService } from "@/server/reports";

/**
 * Tynne action-wrappere for kontorets oppdragsside.
 *
 * De leser skjemaet, kaller tjenestelaget og oversetter resultatet til
 * redirect/revalidate. All autorisasjon, validering og skriving skjer i
 * `src/server/work-orders.ts` og `src/server/reports.ts`.
 */

function workOrderIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
  );
  return parsed.success ? parsed.data : "";
}

export async function setTemplate(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addTemplate(
    user,
    workOrderId,
    formData.get("templateId"),
    "workorders.edit",
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
}

export async function setContact(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.setContact(
    user,
    workOrderId,
    formData.get("contactId"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
}

export async function addContactToCustomer(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addContactToCustomer(user, workOrderId, {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/kunder/${result.customerId}`);
}

export async function assignTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.assignTechnician(
    user,
    workOrderId,
    formData.get("technicianId"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
}

export async function unassignTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.unassignTechnician(
    user,
    workOrderId,
    formData.get("technicianId"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
}

export async function updateStatus(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.changeWorkOrderStatus(
    user,
    workOrderId,
    formData.get("status"),
    "office",
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
}

export async function setTags(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.setTags(
    user,
    workOrderId,
    formData.getAll("tags"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
}

export async function setReportLock(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await setReportLockService(
    user,
    workOrderId,
    formData.get("reportId"),
    formData.get("lock"),
    formData.get("reason"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/rapporter/${workOrderId}`);
}

/**
 * Sletter et oppdrag med rapporter, kommentarer og vedlegg.
 *
 * Krever `workorders.delete`, og tjenestelaget kontrollerer avdelingsgrensen og
 * regelen om kansellerte oppdrag. Slettingen og revisjonsloggen skrives i
 * samme transaksjon.
 */
export async function deleteWorkOrder(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.deleteWorkOrder(user, workOrderId);
  if (!result.ok) redirect(`/oppdrag?error=${result.error}`);

  revalidatePath("/");
  revalidatePath("/oppdrag");
  revalidatePath("/rapporter");
  revalidatePath("/kalender");
  redirect("/oppdrag");
}
