"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  NOTIFICATION_TYPES,
  updateNotificationPreferences,
} from "@/server/notifications";

export type NotificationPreferencesState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error" };

export async function saveNotificationPreferencesAction(
  _previous: NotificationPreferencesState,
  formData: FormData,
): Promise<NotificationPreferencesState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error" };

  const preferences = NOTIFICATION_TYPES.map((type) => ({
    type,
    inApp: formData.get(`inApp_${type}`) === "on",
    email: formData.get(`email_${type}`) === "on",
  }));

  const result = await updateNotificationPreferences(user, preferences);
  if (!result.ok) return { status: "error" };

  revalidatePath("/varsler/innstillinger");
  return { status: "success" };
}
