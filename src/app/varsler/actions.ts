"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications";

export async function markReadAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  await markNotificationRead(user, formData.get("id"));
  revalidatePath("/varsler");
}

/**
 * Åpner varselet og markerer det som lest. Bare interne stier godtas, slik at
 * skjemaet ikke kan brukes som en åpen viderekobling.
 */
export async function openNotificationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;

  await markNotificationRead(user, formData.get("id"));

  const href = String(formData.get("href") ?? "");
  if (href.startsWith("/") && !href.startsWith("//")) {
    redirect(href);
  }
  revalidatePath("/varsler");
}

export async function markAllReadAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await markAllNotificationsRead(user);
  revalidatePath("/varsler");
}
