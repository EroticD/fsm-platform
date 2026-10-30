"use server";

import { revalidatePath } from "next/cache";
import { requireWorkOrderAccess } from "@/lib/access";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  assignTechnician as assignTechnicianService,
  moveTechnician as moveTechnicianService,
} from "@/server/work-orders";

/**
 * Stabile feilkoder som UI-et oversetter. Tjenestelaget har flere interne
 * koder; alt som ikke kan forklares trygt for brukeren blir «ukjent».
 */
export type AssignmentErrorCode =
  | "ikke-tilgang"
  | "ugyldig-data"
  | "ikke-funnet"
  | "workorder-locked"
  | "legal-hold"
  | "ukjent";

export type AssignmentActionResult =
  | { ok: true }
  | { ok: false; error: AssignmentErrorCode };

const REVALIDATED_PATHS = [
  "/",
  "/kalender",
  "/kalender/dispatch",
  "/oppdrag",
] as const;

function fail(error: AssignmentErrorCode): AssignmentActionResult {
  return { ok: false, error };
}

function safeError(error: string): AssignmentErrorCode {
  switch (error) {
    case "ikke-tilgang":
    case "ugyldig-data":
    case "ikke-funnet":
    case "workorder-locked":
    case "legal-hold":
    case "ukjent":
      return error;
    case "avdeling":
      return "ikke-tilgang";
    case "ingen-endring":
      // Kortet er allerede hos montøren, eller kilden er utdatert. For brukeren
      // er dette et ugyldig slipp, ikke en ukjent feil.
      return "ugyldig-data";
    default:
      return "ukjent";
  }
}

function readId(formData: FormData, key: string): string {
  return cleanText(formData.get(key), { maxLength: LIMITS.line });
}

/**
 * Tildeler eller flytter ett oppdrag til en montør fra dashbordet eller
 * ressursoversikten. Kilden kommer fra kortets DataTransfer, men brukes bare
 * til å velge flytte-operasjonen. Avdeling, aktør og rettigheter avgjøres alltid
 * på serveren.
 */
export async function assignWorkOrderToTechnicianAction(
  formData: FormData,
): Promise<AssignmentActionResult> {
  const workOrderId = readId(formData, "workOrderId");
  const technicianId = readId(formData, "technicianId");
  const rawFromTechnicianId = readId(formData, "fromTechnicianId");
  const fromTechnicianId =
    rawFromTechnicianId === "unassigned" ? "" : rawFromTechnicianId;

  if (!workOrderId || !technicianId) return fail("ugyldig-data");

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return fail("ikke-tilgang");

  try {
    const result =
      fromTechnicianId && fromTechnicianId !== technicianId
        ? await moveTechnicianService(
            access.user,
            workOrderId,
            fromTechnicianId,
            technicianId,
          )
        : await assignTechnicianService(
            access.user,
            workOrderId,
            technicianId,
          );

    if (!result.ok) return fail(safeError(result.error));

    for (const path of REVALIDATED_PATHS) revalidatePath(path);
    return { ok: true };
  } catch (error) {
    console.error("Feil ved tildeling av montør fra kort:", error);
    return fail("ukjent");
  }
}
