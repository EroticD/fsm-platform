"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  markAllNotificationsRead,
  markNotificationRead,
  openNotification,
} from "@/server/notifications";

export async function markReadAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  await markNotificationRead(user, formData.get("id"));
  revalidatePath("/varsler");
}

/**
 * Åpner varselet og markerer det som lest. Skjemaet sender bare id-en; den
 * lagrede lenken slås opp på serveren og valideres som intern, slik at
 * skjemaet aldri kan brukes som en åpen viderekobling.
 */
export async function openNotificationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;

  const result = await openNotification(user, formData.get("id"));
  revalidatePath("/varsler");
  if (!result.ok || !result.data.href) return;

  redirect(result.data.href);
}

export async function markAllReadAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await markAllNotificationsRead(user);
  revalidatePath("/varsler");
}
