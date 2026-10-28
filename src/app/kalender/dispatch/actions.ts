"use server";

import type { WorkStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireWorkOrderAccess } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";
import { LIMITS, cleanStatus, cleanText } from "@/lib/sanitize";
import { workOrderStatusSchema } from "@/lib/schemas/workOrder";
import { isOpenStatus } from "@/lib/work-order-status";
import { transitionWorkOrderStatus } from "@/lib/work-order-status-action";
import {
  assignTechnician as assignTechnicianService,
  auditActor,
  unassignTechnician as unassignTechnicianService,
} from "@/server/work-orders";
import { notifyWorkOrderEvent } from "@/server/notifications";
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

export async function updateStatusAction(
  formData: FormData,
): Promise<DispatchActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const parsed = workOrderStatusSchema.safeParse({
    status: cleanStatus(formData.get("status")),
  });
  if (!workOrderId || !parsed.success) return fail("ugyldig-data");

  const access = await requireWorkOrderAccess("workorders.update", workOrderId);
  if (!access) return fail("ikke-tilgang");

  // Dispatch-tavla viser bare åpne oppdrag. Om et oppdrag ble lukket i en
  // annen fane, skal ikke denne handlingen gjenåpne det uten grunn.
  if (!isOpenStatus(access.workOrder.status as WorkStatus)) {
    return fail("ugyldig-status");
  }

  const nextStatus = parsed.data.status as WorkStatus;
  // Kansellering er en kontorhandling. Dispatch skal ikke kunne omgå
  // workorders.edit ved å velge CANCELLED i statusfeltet.
  if (
    nextStatus === "CANCELLED" &&
    !hasPermission(access.user, "workorders.edit")
  ) {
    return fail("ikke-tilgang");
  }

  try {
    const result = await transitionWorkOrderStatus({
      workOrderId,
      from: access.workOrder.status as WorkStatus,
      to: nextStatus,
      isAdmin: access.user.role === "ADMIN",
      actor: auditActor(access.user),
      action: `Kontoret endret status til: ${nextStatus}`,
    });
    if (!result.ok) return fail(result.error);

    // Samme varsel som den vanlige statusflyten sender ved kansellering.
    if (nextStatus === "CANCELLED") {
      try {
        await notifyWorkOrderEvent(
          workOrderId,
          "CANCELLED",
          "Oppdraget er kansellert",
          "Oppdraget er kansellert.",
          `/oppdrag/${workOrderId}`,
          `cancelled:${workOrderId}`,
        );
      } catch (error) {
        console.error("Kunne ikke sende kanselleringsvarsel:", error);
      }
    }

    revalidatePath(DISPATCH_PATH);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved oppdatering av status:", error);
    return fail("ukjent");
  }
}
