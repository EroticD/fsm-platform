"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  saveDraft as saveDraftService,
  submitReport as submitReportService,
} from "@/server/reports";

/**
 * Tynne action-wrappere for rapporteringsskjemaet.
 *
 * All logikk – låsing, øyeblikksbilde av malen, signaturlagring og
 * revisjonslogg – ligger i `src/server/reports.ts`. Her oversettes resultatet
 * til de samme redirectene og revalideringene som før.
 */

/** Lagrer kladden. Kalles også automatisk fra skjemaet mens det fylles ut. */
export async function saveDraft(
  formData: FormData,
): Promise<{ ok: boolean; savedAt?: string }> {
  const user = await getCurrentUser();
  const result = await saveDraftService(user, formData);
  return result.ok ? { ok: true, savedAt: result.savedAt } : { ok: false };
}

export async function submitReport(formData: FormData) {
  const user = await getCurrentUser();
  const result = await submitReportService(user, formData);

  if (result.ok) {
    const workOrderId = cleanText(formData.get("workOrderId"), {
      maxLength: LIMITS.line,
    });
    revalidatePath(`/mine-oppdrag/${workOrderId}`);
    revalidatePath(`/rapporter/${workOrderId}`);
    revalidatePath(`/oppdrag/${workOrderId}`);
    redirect(result.returnTo);
  }

  switch (result.error) {
    case "ikke-autentisert":
      redirect("/logg-inn");
    case "ikke-tilgang":
      redirect("/");
    case "ugyldig-data":
      redirect("/mine-oppdrag?error=ugyldig-data");
    case "kansellert":
      redirect("/oppdrag");
    case "locked":
      redirect(`${result.returnTo}?error=locked`);
    case "signatur":
      redirect(`${result.returnTo}?error=signatur`);
    case "ikke-funnet":
      // Samme som før: en mal som ikke hører til oppdraget avslutter stille.
      return;
  }
}
