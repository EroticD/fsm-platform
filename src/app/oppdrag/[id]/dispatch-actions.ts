"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { requireWorkOrderAccess } from "@/lib/access";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { assignVisit } from "@/server/visits";
import { scoreCandidates } from "@/server/dispatch";

export type SuggestedTechnician = {
  id: string;
  name: string;
  score: number;
  eligible: boolean;
  excludedReason: string | null;
  scoreSkills: number;
  scoreDistance: number;
  scoreTravel: number;
  freeMinutes: number;
  slaUrgency: number;
  currentLoad: number;
};

export type SuggestResult =
  | { ok: true; candidates: SuggestedTechnician[] }
  | { ok: false; error: string };

function readId(formData: FormData, key: string): string {
  return cleanText(formData.get(key), { maxLength: LIMITS.line });
}

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

/** Rangerte montører for én visitt. Endrer ingenting. */
export async function suggestTechniciansAction(
  formData: FormData,
): Promise<SuggestResult> {
  const workOrderId = readId(formData, "workOrderId");
  const visitId = readId(formData, "visitId");
  if (!workOrderId || !visitId) return { ok: false, error: "ugyldig-data" };

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return { ok: false, error: "ikke-tilgang" };
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, workOrderId },
    select: { id: true },
  });
  if (!visit) return { ok: false, error: "ikke-funnet" };

  try {
    const result = await scoreCandidates(access.user, visitId);
    if (!result.ok) return { ok: false, error: serviceError(result) };
    return {
      ok: true,
      candidates: result.data.candidates.slice(0, 10).map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        score: candidate.score,
        eligible: candidate.eligible,
        excludedReason: candidate.excludedReason,
        scoreSkills: candidate.breakdown.skills,
        scoreDistance: candidate.breakdown.distance,
        scoreTravel: candidate.breakdown.travel,
        freeMinutes: candidate.freeMinutes,
        slaUrgency: candidate.slaUrgency,
        currentLoad: candidate.currentLoad,
      })),
    };
  } catch (error) {
    console.error("Feil ved rangering av montører:", error);
    return { ok: false, error: "ukjent" };
  }
}

/** Tildeler den valgte montøren etter en ny rettighetskontroll. */
export async function assignSuggestedTechnicianAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const workOrderId = readId(formData, "workOrderId");
  const visitId = readId(formData, "visitId");
  const technicianId = readId(formData, "technicianId");
  if (!workOrderId || !visitId || !technicianId) {
    return { ok: false, error: "ugyldig-data" };
  }

  const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
  if (!access) return { ok: false, error: "ikke-tilgang" };
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, workOrderId },
    select: { id: true },
  });
  if (!visit) return { ok: false, error: "ikke-funnet" };

  try {
    const result = await assignVisit(access.user, visitId, [technicianId]);
    if (!result.ok) return { ok: false, error: serviceError(result) };
    revalidatePath(`/oppdrag/${workOrderId}`);
    revalidatePath("/kalender/dispatch");
    return { ok: true };
  } catch (error) {
    console.error("Feil ved tildeling fra forslag:", error);
    return { ok: false, error: "ukjent" };
  }
}
