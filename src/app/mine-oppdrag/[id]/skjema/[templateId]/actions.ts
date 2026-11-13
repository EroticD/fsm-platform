"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { moduleEnabled } from "@/server/modules";
import { workOrderScope } from "@/lib/access";
import prisma from "@/lib/prisma";
import { addDaysUtc, parseDateOnly, todayInOslo } from "@/lib/dates";
import { statusKeysByCategory } from "@/lib/work-order-status";
import {
  saveDraft as saveDraftService,
  submitReport as submitReportService,
} from "@/server/reports";

/**
 * Tynne action-wrappere for rapporteringsskjemaet.
 *
 * All logikk – låsing, øyeblikksbilde av malen, signaturlagring og
 * revisjonslogg – ligger i `src/server/reports.ts`. Her oversettes resultatet
 * til redirects og revalidering.
 *
 * Ved feil går brukeren tilbake til selve skjemaet med en synlig feilkode – ikke
 * til «mine oppdrag». Da beholdes kladden og montøren ser hva som må rettes.
 */

/** Lagrer kladden. Kalles også automatisk fra skjemaet mens det fylles ut. */
export async function saveDraft(
  formData: FormData,
): Promise<{ ok: boolean; savedAt?: string }> {
  if (!(await moduleEnabled("reports"))) return { ok: false };
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  // Generøs grense: autolagring og mange bilder i felt skal aldri treffe den i
  // normal bruk. Den stopper bare maskinell hamring på lagringsruten.
  const limit = await allowRequestDb(`draft-save:${user.id}`, 300, 60_000);
  if (!limit.allowed) return { ok: false };

  const result = await saveDraftService(user, formData);
  return result.ok ? { ok: true, savedAt: result.savedAt } : { ok: false };
}

type FormTarget = { path: string; params: URLSearchParams };

/** Bygger adressen tilbake til skjemaet, med et trygt returmål. */
function formTarget(formData: FormData, fallback?: string): FormTarget | null {
  const workOrderId = cleanText(formData.get("workOrderId"), {
    maxLength: LIMITS.line,
  });
  const templateId = cleanText(formData.get("templateId"), {
    maxLength: LIMITS.line,
  });

  if (!workOrderId || !templateId) {
    return fallback ? { path: fallback, params: new URLSearchParams() } : null;
  }

  const params = new URLSearchParams();
  const returnTo = formData.get("returnTo");
  if (
    typeof returnTo === "string" &&
    [`/oppdrag/${workOrderId}`, `/mine-oppdrag/${workOrderId}`].includes(returnTo)
  ) {
    params.set("returnTo", returnTo);
  }

  return {
    path: `/mine-oppdrag/${workOrderId}/skjema/${templateId}`,
    params,
  };
}

function redirectToFormError(
  formData: FormData,
  error: string,
  fallback?: string,
): never {
  const target = formTarget(formData, fallback);
  if (!target) redirect("/mine-oppdrag");
  target.params.set("error", error);
  const query = target.params.toString();
  redirect(`${target.path}${query ? `?${query}` : ""}`);
}

/**
 * Neste tildelte oppdrag for montøren, eller `null` når det ikke finnes flere.
 *
 * Samme tekniske avgrensning som listen i `/mine-oppdrag` bruker for «Senere»:
 * oppdraget er tildelt brukeren, har en status som ikke er lukket, og er
 * planlagt etter dagens dato (Oslo-døgnet). Det gjeldende oppdraget holdes
 * utenfor, slik at en innsending aldri kan sende montøren tilbake til seg selv.
 * Rekkefølgen er den samme som i listen: tidligste planlagte først.
 */
async function nextAssignedWorkOrderId(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  workOrderId: string,
): Promise<string | null> {
  const startOfToday = parseDateOnly(todayInOslo()) ?? new Date();
  const next = await prisma.workOrder.findFirst({
    where: {
      AND: [
        workOrderScope(user),
        { id: { not: workOrderId } },
        { technicians: { some: { id: user.id } } },
        { status: { notIn: statusKeysByCategory("CLOSED") } },
        { scheduledFor: { gte: addDaysUtc(startOfToday, 1) } },
      ],
    },
    orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return next?.id ?? null;
}

export async function submitReport(formData: FormData) {
  if (!(await moduleEnabled("reports"))) redirect("/");
  const user = await getCurrentUser();
  const result = await submitReportService(user, formData);

  if (result.ok) {
    const workOrderId = cleanText(formData.get("workOrderId"), {
      maxLength: LIMITS.line,
    });
    revalidatePath(`/mine-oppdrag/${workOrderId}`);
    revalidatePath(`/rapporter/${workOrderId}`);
    revalidatePath(`/oppdrag/${workOrderId}`);
    // Markøren lar retursiden rydde lokal kladd og outbox etter innsending.
    const templateId = cleanText(formData.get("templateId"), {
      maxLength: LIMITS.line,
    });

    // «Lagre og neste oppdrag» gjelder feltportalen. Kontoret har ikke det
    // samme feltløpet, og skal fortsatt lande på oppdraget sitt.
    if (user && workOrderId && result.returnTo.startsWith("/mine-oppdrag/")) {
      const nextId = await nextAssignedWorkOrderId(user, workOrderId);
      if (nextId) {
        // Neste tildelte oppdrag overtar kvitteringen: siden viser toasten og
        // fjerner `status` selv, se `CustomerToast` i oppdragssiden.
        redirect(`/mine-oppdrag/${nextId}?status=rapport-sendt`);
      }
    }

    const separator = result.returnTo.includes("?") ? "&" : "?";
    redirect(
      templateId
        ? `${result.returnTo}${separator}reportSubmitted=${encodeURIComponent(templateId)}`
        : result.returnTo,
    );
  }

  switch (result.error) {
    case "ikke-autentisert":
      redirect("/logg-inn");
    case "ikke-tilgang":
      redirect("/");
    case "ugyldig-data":
      // Prøv å lagre det montøren faktisk skrev før vi sender hen tilbake.
      await saveDraftService(user, formData);
      redirectToFormError(formData, "ugyldig-data", result.returnTo);
    case "mangler-enhet":
      // Kladden bevares, slik at montøren kan legge til enheten og sende på nytt.
      await saveDraftService(user, formData);
      redirectToFormError(formData, "mangler-enhet", result.returnTo);
    case "mangler-vurdering":
      // Kladden bevares med de valgene montøren allerede har gjort.
      await saveDraftService(user, formData);
      redirectToFormError(formData, "mangler-vurdering", result.returnTo);
    case "signatur":
      await saveDraftService(user, formData);
      redirectToFormError(formData, "signatur", result.returnTo);
    case "ugyldig-signaturnavn":
      // Behold skjemaet som kladd slik at montøren kan rette signaturnavnet.
      await saveDraftService(user, formData);
      redirectToFormError(formData, "ugyldig-signaturnavn", result.returnTo);
    case "locked":
      redirectToFormError(formData, "locked", result.returnTo);
    case "legal-hold":
      redirectToFormError(formData, "legal-hold", result.returnTo);
    case "kansellert":
      // Kansellerte oppdrag kan ikke fylles ut; vis feilen på retursiden.
      redirect(`${result.returnTo ?? "/oppdrag"}?error=kansellert`);
    case "ikke-funnet":
      // Samme som før: en mal som ikke hører til oppdraget avslutter stille.
      return;
  }
}
