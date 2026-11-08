"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { EMAIL_EVENT_KEYS, type EmailEventKey } from "@/lib/email-events";
import { saveEmailSettings, sendTestEmail } from "@/server/email-outbox";

function emailHref(params: Record<string, string>) {
  return `/innstillinger?${new URLSearchParams({
    tab: "email",
    ...params,
  }).toString()}`;
}

function resultCode(result: { ok: false; reason: string; details?: unknown }) {
  const details = result.details as { code?: string } | undefined;
  return details?.code ?? result.reason;
}

export async function saveEmailSettingsAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const events = {} as Partial<Record<EmailEventKey, boolean>>;
  for (const key of EMAIL_EVENT_KEYS) {
    events[key] = formData.get(`event_${key}`) === "on";
  }

  const result = await saveEmailSettings(actor, {
    fromName: formData.get("fromName"),
    fromAddress: formData.get("fromAddress"),
    replyTo: formData.get("replyTo"),
    events,
  });
  if (!result.ok) {
    redirect(emailHref({ error: resultCode(result) }));
  }

  revalidatePath("/innstillinger");
  redirect(emailHref({ ok: "settings" }));
}

export async function sendTestEmailAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await sendTestEmail(actor, formData.get("to"));
  if (!result.ok) {
    redirect(emailHref({ error: resultCode(result) }));
  }

  redirect(emailHref({ ok: "test" }));
}
