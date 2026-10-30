"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { VisitStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { idSchema } from "@/lib/schemas/common";
import * as workOrderService from "@/server/work-orders";
import * as visitService from "@/server/visits";
import { setReportLock as setReportLockService } from "@/server/reports";
import {
  visitFailureSlug,
  visitPeriodFromForm,
} from "./visit-planning";

/**
 * Tynne action-wrappere for kontorets oppdragsside.
 *
 * De leser skjemaet, kaller tjenestelaget og oversetter resultatet til
 * redirect/revalidate. All autorisasjon, validering og skriving skjer i
 * `src/server/work-orders.ts` og `src/server/reports.ts`.
 */

function workOrderIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
  );
  return parsed.success ? parsed.data : "";
}

export async function setTemplate(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addTemplate(
    user,
    workOrderId,
    formData.get("templateId"),
    "workorders.edit",
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(`/oppdrag/${workOrderId}?ok=sjekkliste`);
}

export async function setContact(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.setContact(
    user,
    workOrderId,
    formData.get("contactId"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(`/oppdrag/${workOrderId}?ok=kontakt`);
}

export async function addContactToCustomer(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.addContactToCustomer(user, workOrderId, {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/kunder/${result.customerId}`);
  redirect(`/oppdrag/${workOrderId}?ok=kontakt-lagt-til`);
}

export async function assignTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.assignTechnician(
    user,
    workOrderId,
    formData.get("technicianId"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(`/oppdrag/${workOrderId}?ok=montor`);
}

export async function unassignTechnician(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.unassignTechnician(
    user,
    workOrderId,
    formData.get("technicianId"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(`/oppdrag/${workOrderId}?ok=montor-fjernet`);
}

export async function updateStatus(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.changeWorkOrderStatus(
    user,
    workOrderId,
    formData.get("status"),
    "office",
    formData.get("reason"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(`/oppdrag/${workOrderId}?ok=status`);
}

export async function setTags(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.setTags(
    user,
    workOrderId,
    formData.getAll("tags"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  redirect(`/oppdrag/${workOrderId}?ok=tags`);
}

export async function setReportLock(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await setReportLockService(
    user,
    workOrderId,
    formData.get("reportId"),
    formData.get("lock"),
    formData.get("reason"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/rapporter/${workOrderId}`);
  redirect(`/oppdrag/${workOrderId}?ok=rapport-las`);
}

/** Kloner et oppdrag til et nytt, redigerbart oppdrag. */
export async function cloneWorkOrder(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.cloneWorkOrder(user, workOrderId);
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath("/oppdrag");
  revalidatePath("/");
  redirect(`/oppdrag/${result.id}?ok=klonet`);
}

/**
 * Slår bevaringsplikt på eller av. Bare administrator slipper gjennom; regelen
 * håndheves i tjenestelaget, ikke bare ved å skjule knappen.
 */
export async function setWorkOrderLegalHold(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.setWorkOrderLegalHold(
    user,
    workOrderId,
    formData.get("hold"),
    formData.get("reason"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath("/oppdrag");
  redirect(`/oppdrag/${workOrderId}?ok=bevaring`);
}

/** Bevaringsplikt på en enkelt rapport. Bare administrator. */
export async function setReportLegalHold(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const reportId = cleanText(formData.get("reportId"), { maxLength: LIMITS.line });
  if (!workOrderId || !reportId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.setReportLegalHold(
    user,
    workOrderId,
    reportId,
    formData.get("hold"),
    formData.get("reason"),
  );
  if (!result.ok) redirect(`/oppdrag/${workOrderId}?error=${result.error}`);

  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath("/rapporter");
  redirect(`/oppdrag/${workOrderId}?ok=rapport-bevaring`);
}

/**
 * Flytter et oppdrag til papirkurven sammen med rapporter, kommentarer og
 * vedlegg. Selve slettingen er myk og kan gjenopprettes av administrator.
 *
 * Krever `workorders.delete`, og tjenestelaget kontrollerer avdelingsgrensen,
 * bevaringsplikt og regelen om lukkede oppdrag. Slettingen og revisjonsloggen
 * skrives i samme transaksjon.
 */
export async function deleteWorkOrder(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const user = await getCurrentUser();
  const result = await workOrderService.deleteWorkOrder(user, workOrderId);
  if (!result.ok) redirect(`/oppdrag?error=${result.error}`);

  revalidatePath("/");
  revalidatePath("/oppdrag");
  revalidatePath("/rapporter");
  revalidatePath("/kalender");
  redirect("/oppdrag?ok=slettet");
}

/* ------------------------------------------------------------------ visitter */

function visitIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(
    cleanText(formData.get("visitId"), { maxLength: LIMITS.line }),
  );
  return parsed.success ? parsed.data : "";
}

function formString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function formStrings(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

function planningErrorRedirect(workOrderId: string, error: string): never {
  redirect(
    `/oppdrag/${workOrderId}?planningError=${encodeURIComponent(error)}#planlegging`,
  );
}

function revalidateVisitPaths(workOrderId: string) {
  revalidatePath(`/oppdrag/${workOrderId}`);
  revalidatePath(`/mine-oppdrag/${workOrderId}`);
  revalidatePath("/mine-oppdrag");
  revalidatePath("/kart");
  revalidatePath("/kalender");
}

/**
 * Oppretter en visitt. Tid og dato kommer fra skjemaet og tolkes i Oslo av
 * `visitPeriodFromForm`; oppdragets datoperiode oppdateres av tjenestelaget.
 */
export async function createVisit(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");

  const period = visitPeriodFromForm(formData);
  if (!period) planningErrorRedirect(workOrderId, "invalidTimeRange");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.createVisit(user, {
    workOrderId,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    allDay: formData.get("allDay") === "on",
    technicianIds: formStrings(formData, "technicianIds"),
    notes: formString(formData, "notes"),
  });
  if (!result.ok) {
    planningErrorRedirect(workOrderId, visitFailureSlug(result));
  }

  revalidateVisitPaths(workOrderId);
  redirect(`/oppdrag/${workOrderId}?ok=visitt-opprettet#planlegging`);
}

/** Flytter en visitt. Selve datoperioden på oppdraget røres ikke direkte. */
export async function moveVisit(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");
  if (!visitId) planningErrorRedirect(workOrderId, "invalidInput");

  const period = visitPeriodFromForm(formData);
  if (!period) planningErrorRedirect(workOrderId, "invalidTimeRange");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.moveVisit(user, visitId, {
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  });
  if (!result.ok) {
    planningErrorRedirect(workOrderId, visitFailureSlug(result));
  }

  revalidateVisitPaths(workOrderId);
  redirect(`/oppdrag/${workOrderId}?ok=visitt-flyttet#planlegging`);
}

/** Erstatter montørlisten på visitten. */
export async function assignVisit(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");
  if (!visitId) planningErrorRedirect(workOrderId, "invalidInput");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.assignVisit(
    user,
    visitId,
    formStrings(formData, "technicianIds"),
  );
  if (!result.ok) {
    planningErrorRedirect(workOrderId, visitFailureSlug(result));
  }

  revalidateVisitPaths(workOrderId);
  redirect(`/oppdrag/${workOrderId}?ok=visitt-tildelt#planlegging`);
}

/** Oppdaterer notat, rekkefølge og heldagsflagg uten å flytte visitten. */
export async function updateVisit(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");
  if (!visitId) planningErrorRedirect(workOrderId, "invalidInput");

  const sequenceText = cleanText(formData.get("sequence"), {
    maxLength: LIMITS.line,
  });
  const sequence = sequenceText ? Number(sequenceText) : undefined;

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.updateVisit(user, visitId, {
    notes: formString(formData, "notes"),
    allDay: formData.get("allDay") === "on",
    sequence,
  });
  if (!result.ok) {
    planningErrorRedirect(workOrderId, visitFailureSlug(result));
  }

  revalidateVisitPaths(workOrderId);
  redirect(`/oppdrag/${workOrderId}?ok=visitt-oppdatert#planlegging`);
}

/** Sletter visitten. Oppdraget og rapportene består. */
export async function deleteVisit(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");
  if (!visitId) planningErrorRedirect(workOrderId, "invalidInput");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.deleteVisit(user, visitId);
  if (!result.ok) {
    planningErrorRedirect(workOrderId, visitFailureSlug(result));
  }

  revalidateVisitPaths(workOrderId);
  redirect(`/oppdrag/${workOrderId}?ok=visitt-slettet#planlegging`);
}

/** Setter visittstatus etter tilstandsmaskinen i `src/lib/visit-status.ts`. */
export async function setVisitStatus(formData: FormData) {
  const workOrderId = workOrderIdFrom(formData);
  const visitId = visitIdFrom(formData);
  const status = cleanText(formData.get("status"), {
    maxLength: LIMITS.line,
  });
  if (!workOrderId) redirect("/oppdrag?error=ugyldig-data");
  if (!visitId || !status) planningErrorRedirect(workOrderId, "invalidInput");

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const result = await visitService.setVisitStatus(
    user,
    visitId,
    status as VisitStatus,
  );
  if (!result.ok) {
    planningErrorRedirect(workOrderId, visitFailureSlug(result));
  }

  revalidateVisitPaths(workOrderId);
  redirect(`/oppdrag/${workOrderId}?ok=visitt-status#planlegging`);
}
