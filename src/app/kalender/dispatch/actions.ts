"use server";

import { revalidatePath } from "next/cache";
import { requireWorkOrderAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { LIMITS, cleanStatus, cleanText } from "@/lib/sanitize";
import {
  assignTechnician as assignTechnicianService,
  changeWorkOrderStatus,
  moveTechnician as moveTechnicianService,
  unassignTechnician as unassignTechnicianService,
} from "@/server/work-orders";
import {
  assignVisit,
  setVisitStatus,
  unassignVisit,
} from "@/server/visits";
import { autoAssign } from "@/server/dispatch";
import type { VisitStatus } from "@prisma/client";
import type { DispatchActionResult } from "./types";

const DISPATCH_PATH = "/kalender/dispatch";

function fail(error: string): DispatchActionResult {
  return { ok: false, error };
}

function readId(formData: FormData, key: string): string {
  return cleanText(formData.get(key), { maxLength: LIMITS.line });
}

/** Beholder tjenestens stabile feilkode (f.eks. visits.errors.overlap). */
function serviceError(result: {
  reason: string;
  details?: unknown;
}): string {
  const details = result.details;
  if (details && typeof details === "object") {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return result.reason;
}

function readTechnicianIds(formData: FormData): string[] {
  return Array.from(
    new Set(
      formData
        .getAll("technicianId")
        .map((value) => cleanText(value, { maxLength: LIMITS.line }))
        .filter((value) => value.length > 0),
    ),
  ).slice(0, 100);
}

export async function assignTechnicianAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const technicianId = readId(formData, "technicianId");
  if (!workOrderId || !technicianId) return fail("ugyldig-data");

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result = await assignTechnicianService(
      access.user,
      workOrderId,
      technicianId,
    );
    if (!result.ok) return fail(result.error);
    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved tildeling av montør:", error);
    return fail("ukjent");
  }
}

/**
 * Flytter ett kort mellom to kolonner. Kilden sendes med fra DataTransfer, slik
 * at et slipp fjerner den gamle tildelingen i stedet for å legge til en ny.
 * Tom `technicianId` betyr at kortet slippes på «Uten montør».
 */
export async function moveTechnicianAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const rawFromTechnicianId = readId(formData, "fromTechnicianId");
  const fromTechnicianId =
    rawFromTechnicianId === "unassigned" ? "" : rawFromTechnicianId;
  const toTechnicianId = readId(formData, "technicianId");
  if (!workOrderId || (!fromTechnicianId && !toTechnicianId)) {
    return fail("ugyldig-data");
  }

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result = await moveTechnicianService(
      access.user,
      workOrderId,
      fromTechnicianId,
      toTechnicianId,
    );
    if (!result.ok) return fail(result.error);
    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved flytting av montør:", error);
    return fail("ukjent");
  }
}

export async function unassignTechnicianAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const technicianId = readId(formData, "technicianId");
  if (!workOrderId || !technicianId) return fail("ugyldig-data");

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result = await unassignTechnicianService(
      access.user,
      workOrderId,
      technicianId,
    );
    if (!result.ok) return fail(result.error);
    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved fjerning av montør:", error);
    return fail("ukjent");
  }
}

/**
 * Statusendring fra dispatch bruker samme tjeneste og regler som
 * oppdragsdetaljen. Fullføring og kansellering krever egen bekreftelse i UI-et;
 * kansellering krever i tillegg workorders.edit.
 */
export async function updateStatusAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const status = cleanStatus(formData.get("status"));
  if (!workOrderId || !status) return fail("ugyldig-data");

  const access = await requireWorkOrderAccess("workorders.update", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result = await changeWorkOrderStatus(
      access.user,
      workOrderId,
      status,
      "office",
      formData.get("reason"),
    );
    if (!result.ok) return fail(result.error);
    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved oppdatering av status:", error);
    return fail("ukjent");
  }
}

/**
 * Erstatter montørlisten på en visitt. Dispatch sender hele den ønskede
 * listen, slik at drag mellom to kolonner både fjerner kilden og legger til
 * målet i én operasjon. Tjenesten kontrollerer overlapp og avdeling på nytt.
 */
export async function assignVisitTechniciansAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const visitId = readId(formData, "visitId");
  const technicianIds = readTechnicianIds(formData);
  if (!workOrderId || !visitId || technicianIds.length === 0) {
    return fail("ugyldig-data");
  }

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result = await assignVisit(access.user, visitId, technicianIds);
    if (!result.ok) return fail(serviceError(result));
    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved tildeling av montør til visitt:", error);
    return fail("ukjent");
  }
}

/** Fjerner én montør fra visitten; de øvrige beholder tildelingen. */
export async function unassignVisitTechnicianAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const visitId = readId(formData, "visitId");
  const technicianId = readId(formData, "technicianId");
  if (!workOrderId || !visitId || !technicianId) {
    return fail("ugyldig-data");
  }

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result = await unassignVisit(access.user, visitId, technicianId);
    if (!result.ok) return fail(serviceError(result));
    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved fjerning av montør fra visitt:", error);
    return fail("ukjent");
  }
}

/** Statusendring på visitten, med samme tilstandsmaskin som resten av appen. */
export async function updateVisitStatusAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const visitId = readId(formData, "visitId");
  const status = cleanText(formData.get("status"), {
    maxLength: LIMITS.line,
  }).toUpperCase() as VisitStatus;
  if (!workOrderId || !visitId || !status) return fail("ugyldig-data");

  const access = await requireWorkOrderAccess("workorders.update", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result = await setVisitStatus(access.user, visitId, status);
    if (!result.ok) return fail(serviceError(result));
    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved oppdatering av visittstatus:", error);
    return fail("ukjent");
  }
}

/**
 * Tørrkjøring eller anvendelse av auto-tildeling for de synlige visitene.
 * Tjenesten kontrollerer `workorders.assign` på nytt; handlingen krever
 * samme rettighet for å gi en rask og tydelig feil uten databasespørringer.
 */
export async function autoAssignAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const visitIds = Array.from(
    new Set(
      formData
        .getAll("visitId")
        .map((value) => cleanText(value, { maxLength: LIMITS.line }))
        .filter(Boolean),
    ),
  ).slice(0, 100);
  const dryRun = formData.get("dryRun") !== "false";
  if (visitIds.length === 0) return fail("ugyldig-data");

  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "workorders.assign")) {
    return fail("ikke-tilgang");
  }

  try {
    const result = await autoAssign(user, visitIds, { dryRun });
    if (!result.ok) return fail(serviceError(result));
    if (!dryRun) revalidatePath(DISPATCH_PATH);
    return { ok: true, autoAssign: result.data };
  } catch (error) {
    console.error("Feil ved automatisk dispatch:", error);
    return fail("ukjent");
  }
}
