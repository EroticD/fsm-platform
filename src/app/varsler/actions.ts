"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications";

export type NotificationActionState = { ok: boolean };

/** Merker ett varsel som lest. Idempotent og avgrenset til eieren. */
export async function markReadAction(
  formData: FormData,
): Promise<NotificationActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const result = await markNotificationRead(user, formData.get("id"));
  revalidatePath("/varsler");
  return { ok: result.ok };
}

/** Merker alle brukerens uleste varsler som lest. */
export async function markAllReadAction(): Promise<NotificationActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const result = await markAllNotificationsRead(user);
  revalidatePath("/varsler");
  return { ok: result.ok };
}

/**
 * Skjema-variantene returnerer `void`, slik at de kan brukes direkte som
 * `action` på et `<form>` i serverkomponenter. Bjelle-popoveren bruker
 * variantene over og får status tilbake.
 */
export async function markReadFormAction(formData: FormData): Promise<void> {
  await markReadAction(formData);
}

export async function markAllReadFormAction(): Promise<void> {
  await markAllReadAction();
}
