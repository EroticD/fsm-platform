"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  NOTIFICATION_TYPES,
  updateNotificationPreferences,
} from "@/server/notifications";

export async function saveNotificationPreferencesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;

  const preferences = NOTIFICATION_TYPES.map((type) => ({
    type,
    inApp: formData.get(`inApp_${type}`) === "on",
    email: formData.get(`email_${type}`) === "on",
  }));

  await updateNotificationPreferences(user, preferences);
  revalidatePath("/varsler/innstillinger");
}
