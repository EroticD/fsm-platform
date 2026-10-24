"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { acknowledgeReport, requestContactUpdate } from "@/server/portal";

export async function requestContactUpdateAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  await requestContactUpdate(user, {
    contactId: formData.get("contactId"),
    message: formData.get("message"),
  });
  revalidatePath("/kundeportal");
}

export async function acknowledgeReportAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  await acknowledgeReport(user, {
    workOrderId: formData.get("workOrderId"),
    reportId: formData.get("reportId"),
    comment: formData.get("comment"),
  });
  revalidatePath("/kundeportal");
}
