"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { VisitStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { idSchema } from "@/lib/schemas/common";
import * as workOrderService from "@/server/work-orders";
import * as visitService from "@/server/visits";

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

function visitIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("visitId"), { maxLength: LIMITS.line }),
  );
  return parsed.success ? parsed.data : "";
}

function visitFailureSlug(failure: {
  reason: string;
  details?: unknown;
}): string {
  const details = failure.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") {
      const segment = code.split(".").pop();
      if (segment) return segment;
    }
  }
  if (failure.reason === "not_found") return "notFound";
  if (failure.reason === "forbidden") return "forbidden";
  return failure.reason || "generic";
}

/**
 * Montørens statusflyt for én visitt. Bare tjenestelaget avgjør om overgangen
 * er lovlig; denne handlingen videresender valget og en tydelig kvittering.
 */
export async function setVisitStatus(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  const status = cleanText(formData.get("status"), { maxLength: LIMITS.line });
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");
  if (!visitId || !status) {
    redirect(`/mine-oppdrag/${workOrderId}?visitError=invalidInput`);
  }

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.setVisitStatus(
    user,
    visitId,
    status as VisitStatus,
  );
  if (!result.ok) {
    redirect(
      `/mine-oppdrag/${workOrderId}?visitError=${encodeURIComponent(visitFailureSlug(result))}`,
    );
  }

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
  revalidatePath("/mine-oppdrag");
  revalidatePath("/kart");
  redirect(`/mine-oppdrag/${workOrderId}?visitOk=1`);
}
