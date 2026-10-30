"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { saveSmsSettings, saveSmsTemplate } from "@/server/sms";

function smsHref(params: Record<string, string>) {
  return `/innstillinger?${new URLSearchParams({
    tab: "sms",
    ...params,
  }).toString()}`;
}

function revalidateSms() {
  revalidatePath("/innstillinger");
  revalidatePath("/meldinger");
}

export async function saveSmsSettingsAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await saveSmsSettings(actor, {
    defaultLocale: formData.get("defaultLocale"),
    optOutKeywords: formData.get("optOutKeywords"),
    optInKeywords: formData.get("optInKeywords"),
    monthlyCap: formData.get("monthlyCap"),
  });
  if (!result.ok) redirect(smsHref({ error: result.reason }));

  revalidateSms();
  redirect(smsHref({ ok: "settings" }));
}

export async function saveSmsTemplateAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await saveSmsTemplate(actor, {
    eventKey: formData.get("eventKey"),
    locale: formData.get("locale"),
    body: formData.get("body"),
    isActive: formData.get("isActive") === "on",
  });
  if (!result.ok) redirect(smsHref({ error: result.reason }));

  revalidateSms();
  redirect(smsHref({ ok: "template" }));
}
