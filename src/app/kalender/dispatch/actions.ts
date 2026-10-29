"use server";

import { revalidatePath } from "next/cache";
import { requireWorkOrderAccess } from "@/lib/access";
import { LIMITS, cleanStatus, cleanText } from "@/lib/sanitize";
import {
  assignTechnician as assignTechnicianService,
  changeWorkOrderStatus,
  moveTechnician as moveTechnicianService,
  unassignTechnician as unassignTechnicianService,
} from "@/server/work-orders";
import type { DispatchActionResult } from "./types";

const DISPATCH_PATH = "/kalender/dispatch";

function fail(error: string): DispatchActionResult {
  return { ok: false, error };
}

function readId(formData: FormData, key: string): string {
  return cleanText(formData.get(key), { maxLength: LIMITS.line });
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
