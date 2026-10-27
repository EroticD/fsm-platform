"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { linkHmsTemplateToWorkOrder } from "@/server/hms";

/**
 * Tynn action-wrapper for HMS-siden. All autorisasjon, validering og skriving
 * skjer i tjenestelaget, som igjen bruker oppdragstjenestens `addTemplate`.
 */
export async function linkHmsTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;

  const workOrderId = cleanText(formData.get("workOrderId"), {
    maxLength: LIMITS.line,
  });
  const templateId = cleanText(formData.get("templateId"), {
    maxLength: LIMITS.line,
  });

  const result = await linkHmsTemplateToWorkOrder(
    user,
    workOrderId,
    templateId,
  );

  if (!result.ok) {
    redirect(`/hms?error=${encodeURIComponent(result.reason)}`);
  }

  const id = result.data.workOrderId;
  revalidatePath("/hms");
  revalidatePath(`/oppdrag/${id}`);
  revalidatePath(`/mine-oppdrag/${id}`);

  // Kontoret fyller ut skjemaet fra oppdragssiden, montørene fra feltvisningen.
  redirect(
    user.role === "TECHNICIAN"
      ? `/mine-oppdrag/${id}?hms=1`
      : `/oppdrag/${id}?hms=1`,
  );
}
