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
import { customerErrorParam } from "../feedback";

function unitHref(customerId: string, status?: string, error?: string) {
  if (!customerId) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (error) params.set("error", error);
    const query = params.toString();
    return `/kunder${query ? `?${query}` : ""}`;
  }
  const params = new URLSearchParams({ tab: "utstyr" });
  if (status) params.set("status", status);
  if (error) params.set("error", error);
  return `/kunder/${customerId}?${params.toString()}`;
}

/** Registrerer en ny enhet (maskin/utstyr) på kunden. */
export async function createUnit(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

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
    redirect(unitHref(rawCustomerId, undefined, customerErrorParam(result.reason)));
  }

  revalidatePath(`/kunder/${rawCustomerId}`);
  redirect(unitHref(rawCustomerId, "enhet-lagt-til"));
}

/** Oppdaterer navn, serienummer og plassering på en enhet. */
export async function updateUnit(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

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
    redirect(unitHref(rawCustomerId, undefined, customerErrorParam(result.reason)));
  }

  revalidatePath(`/kunder/${rawCustomerId}`);
  redirect(unitHref(rawCustomerId, "enhet-oppdatert"));
}

/**
 * Sletter en enhet. Rapporter som allerede er skrevet beholder sitt eget
 * øyeblikksbilde av enheten, så servicehistorikken blir stående.
 */
export async function deleteUnit(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const customerId = cleanText(formData.get("customerId"), {
    maxLength: LIMITS.line,
  });
  const result = await deleteUnitService(actor, {
    customerId,
    id: formData.get("id"),
  });

  if (!result.ok) {
    redirect(unitHref(customerId, undefined, customerErrorParam(result.reason)));
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(unitHref(customerId, "enhet-slettet"));
}
