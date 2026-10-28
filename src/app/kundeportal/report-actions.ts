"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { acknowledgeReport, requestContactUpdate } from "@/server/portal";
import type { ServiceError } from "@/server/actor";

export type PortalFormState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; reason: ServiceError };

/**
 * Kunden ber om oppdatert kontaktinformasjon. Handlingen returnerer en typet
 * status, slik at skjemaet kan vise «sender …», feil og kvittering.
 */
export async function requestContactUpdateAction(
  _previous: PortalFormState,
  formData: FormData,
): Promise<PortalFormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", reason: "forbidden" };

  const result = await requestContactUpdate(user, {
    contactId: formData.get("contactId"),
    message: formData.get("message"),
  });
  if (!result.ok) return { status: "error", reason: result.reason };

  revalidatePath("/kundeportal");
  return { status: "success" };
}

/** Kunden kvitterer for at en signert rapport er mottatt. */
export async function acknowledgeReportAction(
  _previous: PortalFormState,
  formData: FormData,
): Promise<PortalFormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", reason: "forbidden" };

  const result = await acknowledgeReport(user, {
    workOrderId: formData.get("workOrderId"),
    reportId: formData.get("reportId"),
    comment: formData.get("comment"),
  });
  if (!result.ok) return { status: "error", reason: result.reason };

  revalidatePath("/kundeportal");
  return { status: "success" };
}
