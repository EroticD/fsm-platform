"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { equipmentErrorParam } from "@/lib/equipment-feedback";
import { moveEquipmentToCustomer } from "@/server/equipment-move";

/**
 * Tynn action-wrapper. Autorisasjon, validering og transaksjon ligger i
 * tjenestelaget, slik at en direkte POST ikke kan omgå reglene.
 */
export async function moveEquipmentToCustomerAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const targetCustomerId = String(formData.get("targetCustomerId") ?? "");
  const targetSiteId = String(formData.get("targetSiteId") ?? "") || null;
  const previewHash = String(formData.get("previewHash") ?? "") || null;

  const result = await moveEquipmentToCustomer(
    actor,
    id,
    targetCustomerId,
    targetSiteId,
    { previewHash },
  );

  if (!result.ok) {
    redirect(
      `/enheter/${encodeURIComponent(id)}/flytt?feil=${encodeURIComponent(
        equipmentErrorParam(result),
      )}`,
    );
  }

  revalidatePath("/enheter");
  revalidatePath(`/enheter/${id}`);
  revalidatePath(`/oppdrag`);
  revalidatePath("/");
  revalidatePath(`/kunder/${result.data.sourceCustomerId}`);
  if (result.data.targetCustomerId) {
    revalidatePath(`/kunder/${result.data.targetCustomerId}`);
  }

  redirect(`/enheter/${encodeURIComponent(id)}?meldt=flyttet`);
}
