"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import {
  createUnit as createUnitService,
  deleteUnit as deleteUnitService,
  updateUnit as updateUnitService,
} from "@/server/customers";

/** Registrerer en ny enhet (maskin/utstyr) på kunden. */
export async function createUnit(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const rawCustomerId = cleanText(formData.get("customerId"), {
    maxLength: LIMITS.line,
  });
  const result = await createUnitService(actor, {
    customerId: rawCustomerId,
    model: formData.get("model"),
    serialNumber: formData.get("serialNumber"),
    location: formData.get("location"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(
        rawCustomerId
          ? `/kunder/${rawCustomerId}?tab=enheter&error=ugyldig-data`
          : "/kunder?error=ugyldig-data",
      );
    }
    return;
  }

  revalidatePath(`/kunder/${rawCustomerId}`);
}

/** Oppdaterer navn, serienummer og plassering på en enhet. */
export async function updateUnit(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const rawCustomerId = cleanText(formData.get("customerId"), {
    maxLength: LIMITS.line,
  });
  const result = await updateUnitService(actor, {
    customerId: rawCustomerId,
    id: formData.get("id"),
    model: formData.get("model"),
    serialNumber: formData.get("serialNumber"),
    location: formData.get("location"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(
        rawCustomerId
          ? `/kunder/${rawCustomerId}?tab=enheter&error=ugyldig-data`
          : "/kunder?error=ugyldig-data",
      );
    }
    return;
  }

  revalidatePath(`/kunder/${rawCustomerId}`);
}

/**
 * Sletter en enhet. Rapporter som allerede er skrevet beholder sitt eget
 * øyeblikksbilde av enheten, så servicehistorikken blir stående.
 */
export async function deleteUnit(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const customerId = cleanText(formData.get("customerId"), {
    maxLength: LIMITS.line,
  });
  const result = await deleteUnitService(actor, {
    customerId,
    id: formData.get("id"),
  });

  if (!result.ok) return;

  revalidatePath(`/kunder/${customerId}`);
}
