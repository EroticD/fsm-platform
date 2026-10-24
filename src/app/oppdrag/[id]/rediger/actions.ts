"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { idSchema } from "@/lib/schemas/common";
import { updateWorkOrder as updateWorkOrderService } from "@/server/work-orders";

/** Tynn wrapper rundt tjenestelaget for redigering av et oppdrag. */
export async function updateWorkOrder(formData: FormData) {
  const parsedId = idSchema.safeParse(
    cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
  );
  if (!parsedId.success) return;
  const workOrderId = parsedId.data;

  const user = await getCurrentUser();
  const result = await updateWorkOrderService(user, workOrderId, {
    title: formData.get("title"),
    orderNumber: formData.get("orderNumber"),
    description: formData.get("description"),
    departmentId: formData.get("departmentId"),
    customerId: formData.get("customerId"),
    contactId: formData.get("contactId"),
    scheduledFor: formData.get("scheduledFor"),
    scheduledTo: formData.get("scheduledTo"),
    technicianIds: formData.getAll("technicianIds"),
    tagNames: formData.getAll("tags"),
  });

  if (!result.ok) {
    // Samme oppførsel som før: manglende tilgang avslutter stille, mens
    // ugyldige data gir en synlig feilmelding i skjemaet.
    if (result.error === "ugyldig-data") {
      redirect(`/oppdrag/${workOrderId}/rediger?error=ugyldig-data`);
    }
    if (result.error === "workorder-locked") {
      redirect(`/oppdrag/${workOrderId}?error=workorder-locked`);
    }
    return;
  }

  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/`);
  redirect(`/oppdrag/${workOrderId}`);
}
