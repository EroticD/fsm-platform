"use server";

import { WorkStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  resetWorkOrderStatusSettings,
  saveWorkOrderStatusSettings,
} from "@/server/work-order-status-settings";

const TAB = "/innstillinger?tab=oppdragsstatus";

export async function saveWorkOrderStatusAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const statuses = (Object.values(WorkStatus) as WorkStatus[]).map((status) => ({
    status,
    category: formData.get(`category_${status}`),
    sortOrder: formData.get(`sortOrder_${status}`),
    isActive: formData.get(`active_${status}`) === "on",
  }));

  const result = await saveWorkOrderStatusSettings(actor, {
    defaultStatus: formData.get("defaultStatus"),
    statuses,
  });
  if (!result.ok) redirect(`${TAB}&error=${result.reason}`);

  revalidatePath("/innstillinger");
  revalidatePath("/oppdrag");
  redirect(`${TAB}&ok=lagret`);
}

export async function resetWorkOrderStatusAction() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");
  const result = await resetWorkOrderStatusSettings(actor);
  if (!result.ok) redirect(`${TAB}&error=${result.reason}`);

  revalidatePath("/innstillinger");
  revalidatePath("/oppdrag");
  redirect(`${TAB}&ok=nullstilt`);
}
