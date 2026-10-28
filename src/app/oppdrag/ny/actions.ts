"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { createWorkOrder as createWorkOrderService } from "@/server/work-orders";

/**
 * Tynn action-wrapper for å opprette et oppdrag. Autorisasjon, validering og
 * skriving ligger i `src/server/work-orders.ts`.
 *
 * Alle tjenestefeil sendes tilbake til skjemaet som en synlig kode. Spesielt
 * duplikat ordrenummer skal ikke lenger ende som en stille «ingenting skjedde».
 */
export async function createWorkOrder(formData: FormData) {
  const user = await getCurrentUser();
  const result = await createWorkOrderService(user, {
    title: formData.get("title"),
    orderNumber: formData.get("orderNumber"),
    description: formData.get("description"),
    departmentId: formData.get("departmentId"),
    customerId: formData.get("customerId"),
    contactId: formData.get("contactId"),
    scheduledFor: formData.get("scheduledFor"),
    scheduledTo: formData.get("scheduledTo"),
    technicianIds: formData.getAll("technicianIds"),
    templateIds: formData.getAll("templateIds"),
    tagNames: formData.getAll("tags"),
  });

  if (!result.ok) {
    redirect(`/oppdrag/ny?error=${encodeURIComponent(result.error)}`);
  }

  redirect("/kalender");
}
