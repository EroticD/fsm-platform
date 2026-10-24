"use server";

import { revalidatePath } from "next/cache";
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

export async function markAllReadAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await markAllNotificationsRead(user);
  revalidatePath("/varsler");
}
