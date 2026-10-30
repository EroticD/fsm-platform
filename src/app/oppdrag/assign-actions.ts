"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import * as workOrderService from "@/server/work-orders";

/**
 * Rask tildeling fra oppdragslisten. Handlingen er en tynn wrapper rundt
 * tjenestelaget, som selv kontrollerer `workorders.assign`, avdeling,
 * bevaringsplikt og revisjonslogg.
 */
function idFrom(formData: FormData, key: string): string {
  return cleanText(formData.get(key), { maxLength: LIMITS.line });
}

function returnPath(formData: FormData): string {
  const value = cleanText(formData.get("returnTo"), {
    maxLength: LIMITS.line * 2,
  });
  // Bare interne oppdragslenker; hindrer åpen redirect via skjemaet.
  return value.startsWith("/oppdrag") && !value.startsWith("//")
    ? value
    : "/oppdrag";
}

function withQuery(path: string, key: string, value: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(value)}`;
}

export async function quickAssignTechnician(formData: FormData) {
  const workOrderId = idFrom(formData, "workOrderId");
  const technicianId = idFrom(formData, "technicianId");
  const back = returnPath(formData);

  if (!workOrderId || !technicianId) {
    redirect(withQuery(back, "error", "ugyldig-data"));
  }

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await workOrderService.assignTechnician(
    user,
    workOrderId,
    technicianId,
  );
  if (!result.ok) {
    redirect(withQuery(back, "error", result.error));
  }

  revalidatePath("/oppdrag");
  revalidatePath("/");
  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(withQuery(back, "ok", "montor"));
}
