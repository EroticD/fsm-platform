"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { idSchema } from "@/lib/schemas/common";
import { restoreWorkOrder as restoreWorkOrderService } from "@/server/work-orders";

/**
 * Tynn action-wrapper for gjenoppretting av mykt slettede oppdrag.
 * Autorisasjonen (ADMIN) og skrivingen ligger i tjenestelaget.
 */
export async function restoreWorkOrder(formData: FormData) {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
  );
  if (!parsed.success) redirect("/oppdrag/slettede?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await restoreWorkOrderService(user, parsed.data);
  if (!result.ok) redirect(`/oppdrag/slettede?error=${result.error}`);

  revalidatePath("/oppdrag");
  revalidatePath("/oppdrag/slettede");
  redirect("/oppdrag/slettede");
}
