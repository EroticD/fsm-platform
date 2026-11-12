"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Visit, VisitStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { idSchema } from "@/lib/schemas/common";
import {
  isOfflineVisitStatus,
  visitStatusTimestampProblem,
  type VisitStatusSendResult,
} from "@/lib/offline/visit-status-rules";
import * as workOrderService from "@/server/work-orders";
import * as visitService from "@/server/visits";
import { moduleEnabled } from "@/server/modules";

/** Tynne action-wrappere for feltportalens oppdragsside. */

function workOrderIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
  );
  return parsed.success ? parsed.data : "";
}

function errorRedirect(workOrderId: string, error: string): never {
  redirect(`/mine-oppdrag/${workOrderId}?error=${error}`);
}

export async function updateStatus(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.changeWorkOrderStatus(
    user,
    workOrderId,
    formData.get("status"),
    "field",
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function addComment(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addComment(
    user,
    workOrderId,
    formData.get("content"),
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function addTemplate(formData: FormData) {
  if (!(await moduleEnabled("reports"))) redirect("/");
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addTemplate(
    user,
    workOrderId,
    formData.get("templateId"),
    "workorders.update",
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function addTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addTechnician(
    user,
    workOrderId,
    formData.get("userId"),
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

export async function removeTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.removeTechnician(
    user,
    workOrderId,
    formData.get("userId"),
  );
  if (!result.ok) errorRedirect(workOrderId, result.error);

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
}

function visitIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("visitId"), { maxLength: LIMITS.line }),
  );
  return parsed.success ? parsed.data : "";
}

function visitFailureSlug(failure: {
  reason: string;
  details?: unknown;
}): string {
  const details = failure.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") {
      const segment = code.split(".").pop();
      if (segment) return segment;
    }
  }
  if (failure.reason === "not_found") return "notFound";
  if (failure.reason === "forbidden") return "forbidden";
  return failure.reason || "generic";
}

/**
 * Tidsstempelet klienten sendte med, hvis det kan brukes.
 *
 * En skrudd klokke skal ikke blokkere en helt vanlig statusendring med nett;
 * da brukes servertidspunktet i stedet, som før. Køen (uten nett) avviser
 * derimot et ugyldig tidspunkt, fordi det ikke finnes noe bedre alternativ.
 */
function visitStatusTimestampFrom(value: FormDataEntryValue | null): Date | null {
  const raw = cleanText(value, { maxLength: LIMITS.line });
  if (!raw) return null;
  const at = Number(raw);
  return visitStatusTimestampProblem(at) ? null : new Date(at);
}

/**
 * Montørens statusflyt for én visitt. Bare tjenestelaget avgjør om overgangen
 * er lovlig; denne handlingen videresender valget og en tydelig kvittering.
 *
 * Klienten kan sende med trykketidspunktet i `at`. Det valideres som i
 * offline-køen og brukes som `enRouteAt`/`onSiteAt`, slik at en registrering
 * som ble gjort uten nett får samme tid som om den var sendt med en gang.
 */
export async function setVisitStatus(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  const status = cleanText(formData.get("status"), { maxLength: LIMITS.line });
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");
  if (!visitId || !status) {
    redirect(`/mine-oppdrag/${workOrderId}?visitError=invalidInput`);
  }
  const at = visitStatusTimestampFrom(formData.get("at"));

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.setVisitStatus(
    user,
    visitId,
    status as VisitStatus,
  );
  if (!result.ok) {
    redirect(
      `/mine-oppdrag/${workOrderId}?visitError=${encodeURIComponent(visitFailureSlug(result))}`,
    );
  }

  if (at) {
    await applyVisitStatusTimestamp(
      visitId,
      status as VisitStatus,
      at,
      result.data,
    );
  }

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
  revalidatePath("/mine-oppdrag");
  revalidatePath("/kart");
  redirect(`/mine-oppdrag/${workOrderId}?visitOk=1`);
}

/**
 * Flytter tjenestelagets `now()`-tidspunkt til montørens faktiske tidspunkt.
 *
 * Tjenestelaget eier statusovergangen, autorisasjonen og revisjonsloggen, men
 * tar ikke imot et klienttidsstempel. Tidspunktet justeres derfor i en egen
 * UPDATE som bare treffer når feltet fortsatt har nøyaktig den verdien
 * tjenesten skrev. En sen duplikat kan dermed aldri flytte et tidspunkt som
 * allerede er korrigert, og en samtidig registrering fra en annen enhet vinner.
 */
async function applyVisitStatusTimestamp(
  visitId: string,
  status: VisitStatus,
  at: Date,
  written: Visit,
): Promise<void> {
  if (status !== "EN_ROUTE" && status !== "ON_SITE") return;
  const writtenAt =
    status === "EN_ROUTE" ? written.enRouteAt : written.onSiteAt;
  if (!(writtenAt instanceof Date)) return;
  // Under ett sekund er forskjellen transaksjonstid, ikke en korreksjon.
  if (Math.abs(writtenAt.getTime() - at.getTime()) < 1000) return;

  try {
    if (status === "EN_ROUTE") {
      await prisma.visit.updateMany({
        where: { id: visitId, enRouteAt: writtenAt },
        data: { enRouteAt: at },
      });
    } else {
      await prisma.visit.updateMany({
        where: { id: visitId, onSiteAt: writtenAt },
        data: { onSiteAt: at },
      });
    }
  } catch {
    // Statusendringen er lagret med servertidspunktet. En mislykket
    // korreksjon skal ikke gjøre hele registreringen feilet.
  }
}

/**
 * Statusregistrering fra offline-køen: avreise eller ankomst tidfestet av
 * montøren, sendt når nettet kommer tilbake.
 *
 * Actionen redirecter aldri. Den svarer med om sendingen skal prøves igjen,
 * slik at køen kan sende flere registreringer etter hverandre og beholde dem
 * som feilet av nettårsaker.
 *
 * Tidsstempelet valideres mot serverens klokke: maks fem minutter fram og maks
 * ett døgn tilbake. Er det gyldig, brukes det i stedet for `now()` som
 * `enRouteAt`/`onSiteAt`. Bare avreise og ankomst støttes – fullføring krever
 * rapport og PDF og går alltid gjennom den vanlige statusflyten.
 *
 * Idempotent: samme visitt, status og tidspunkt legges bare i køen én gang
 * (idempotensnøkkelen), og en duplikat som likevel når serveren stoppes av
 * tilstandsmaskinen – overgangen til samme status er ikke lovlig, så verken
 * raden eller revisjonsloggen skrives på nytt.
 */
export async function recordVisitStatusOfflineSafe(input: {
  visitId: string;
  status: string;
  at: number;
}): Promise<VisitStatusSendResult> {
  const visitId = idSchema.safeParse(
    cleanText(input?.visitId, { maxLength: LIMITS.line }),
  );
  const status = cleanText(input?.status, { maxLength: LIMITS.line });
  const at = Number(input?.at);

  if (!visitId.success || !isOfflineVisitStatus(status)) {
    return { ok: false, retryable: false, error: "invalidInput" };
  }

  const timestampProblem = visitStatusTimestampProblem(at);
  if (timestampProblem) {
    return {
      ok: false,
      // Et tidspunkt litt fram i tid blir gyldig når klokken har rettet seg.
      retryable: timestampProblem === "in-future",
      error: `timestamp-${timestampProblem}`,
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    // Økten kan komme tilbake; posten skal ikke kastes av den grunn.
    return { ok: false, retryable: true, error: "unauthorized" };
  }

  const result = await visitService.setVisitStatus(user, visitId.data, status);
  if (!result.ok) {
    return { ok: false, retryable: false, error: visitFailureSlug(result) };
  }

  await applyVisitStatusTimestamp(
    visitId.data,
    status,
    new Date(at),
    result.data,
  );

  revalidatePath(`/mine-oppdrag/${result.data.workOrderId}`);
  revalidatePath("/mine-oppdrag");
  revalidatePath("/kart");
  return { ok: true };
}

/**
 * Sekundær felt handling etter DONE: avslutter retur-/viderekjøringen.
 * De tre primære statusknappene er uendret.
 */
export async function finishVisitTravelFrom(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  if (!workOrderId) redirect("/mine-oppdrag?error=ugyldig-data");
  if (!visitId) {
    redirect(`/mine-oppdrag/${workOrderId}?visitError=invalidInput`);
  }

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.finishTravelFrom(user, visitId);
  if (!result.ok) {
    redirect(
      `/mine-oppdrag/${workOrderId}?visitError=${encodeURIComponent(visitFailureSlug(result))}`,
    );
  }

  revalidatePath(`/mine-oppdrag/${workOrderId}`);
  revalidatePath("/mine-oppdrag");
  redirect(`/mine-oppdrag/${workOrderId}?visitOk=1`);
}
