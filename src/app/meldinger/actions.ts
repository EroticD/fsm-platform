"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { setSmsConsent } from "@/server/sms";
import {
  ensureThreadForWorkOrder,
  sendThreadMessage,
} from "@/server/messaging";
import { sendWorkOrderEventSms } from "@/server/sms-events";
import { isSmsEventKey } from "@/lib/sms/templates";

function threadHref(threadId: string, params: Record<string, string>) {
  return `/meldinger/${threadId}?${new URLSearchParams(params).toString()}`;
}

function feedback(
  threadId: string,
  result: { ok: boolean; reason?: string },
) {
  return threadId && result.ok
    ? threadHref(threadId, { ok: "sent" })
    : threadHref(threadId, { error: result.reason ?? "error" });
}

export async function sendMessageAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const threadId = String(formData.get("threadId") ?? "");
  const result = await sendThreadMessage(
    actor,
    threadId,
    formData.get("body"),
  );
  revalidatePath("/meldinger");
  revalidatePath(`/meldinger/${threadId}`);
  redirect(feedback(threadId, result));
}

export async function setConsentAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const threadId = String(formData.get("threadId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const optedIn = String(formData.get("optedIn") ?? "") === "true";
  const result = await setSmsConsent(actor, {
    contactId,
    optedIn,
    source: "office",
  });

  revalidatePath(`/meldinger/${threadId}`);
  if (!result.ok) {
    redirect(threadHref(threadId, { error: result.reason }));
  }
  redirect(threadHref(threadId, { ok: optedIn ? "consent" : "revoked" }));
}

export async function sendQuickMessageAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const threadId = String(formData.get("threadId") ?? "");
  const workOrderId = String(formData.get("workOrderId") ?? "");
  const eventKey = formData.get("eventKey");
  if (!isSmsEventKey(eventKey)) {
    redirect(threadHref(threadId, { error: "invalid" }));
  }

  const result = await sendWorkOrderEventSms(actor, {
    workOrderId,
    eventKey,
  });
  revalidatePath("/meldinger");
  revalidatePath(`/meldinger/${threadId}`);
  if (!result.ok) {
    redirect(threadHref(threadId, { error: result.reason }));
  }
  redirect(threadHref(threadId, { ok: "sent" }));
}

export async function startWorkOrderThreadAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const workOrderId = String(formData.get("workOrderId") ?? "");
  const result = await ensureThreadForWorkOrder(actor, workOrderId);
  if (!result.ok) {
    redirect(`/meldinger?oppdrag=${encodeURIComponent(workOrderId)}&error=${result.reason}`);
  }
  redirect(`/meldinger/${result.data.id}`);
}
