"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  getOrCreateCalendarToken,
  revokeCalendarToken,
} from "@/server/calendar-feed";

export async function createCalendarTokenAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await getOrCreateCalendarToken(user);
  revalidatePath("/innstillinger");
}

export async function revokeCalendarTokenAction() {
  const user = await getCurrentUser();
  if (!user) return;
  await revokeCalendarToken(user);
  revalidatePath("/innstillinger");
}
