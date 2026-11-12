"use server";

// i18n-ignore-file: revisjonshandlinger er stabile driftsdata, ikke UI-tekst.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createCustomer,
  deleteCustomer,
  restoreCustomer,
  updateCustomer,
} from "@/server/customers";
import { auditStandalone } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { allowRequestMemory } from "@/lib/rate-limit-memory";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { toAuditActor } from "@/server/actor";
import {
  lookupCompany,
  normalizeOrgNumber,
  type CompanyRecord,
} from "@/lib/brreg";
import { customerErrorParam } from "./feedback";

/** Registrerer en ny kunde. Tynn wrapper rundt kundetjenesten. */
export async function addCustomer(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createCustomer(actor, {
    name: formData.get("name"),
    orgNumber: formData.get("orgNumber"),
    address: formData.get("address"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
    phone: formData.get("phone"),
  });

  if (!result.ok) {
    redirect(`/kunder?error=${customerErrorParam(result.reason)}`);
  }

  revalidatePath("/kunder");
  redirect(`/kunder/${result.data.id}?status=kunde-opprettet`);
}

/** Lagrer endringene på kundekortet. */
export async function updateCustomerAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await updateCustomer(actor, customerId, {
    name: formData.get("name"),
    customerNumber: formData.get("customerNumber"),
    orgNumber: formData.get("orgNumber"),
    brandColor: formData.get("brandColor"),
    logoUrl: formData.get("logoUrl"),
    address: formData.get("address"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
    departmentId: formData.get("departmentId"),
    responsibleTechnicianId: formData.get("responsibleTechnicianId"),
  });

  if (!result.ok) {
    redirect(
      `/kunder/${customerId}/rediger?error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kunder");
  redirect(`/kunder/${customerId}?status=kunde-oppdatert`);
}

/** Myksletter en kunde. Bare administrator kommer gjennom i tjenesten. */
export async function deleteCustomerAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const result = await deleteCustomer(actor, id);
  if (!result.ok) {
    redirect(`/kunder?error=${customerErrorParam(result.reason)}`);
  }

  revalidatePath("/kunder");
  revalidatePath("/");
  redirect("/kunder?status=kunde-slettet");
}

/** Gjenoppretter en mykt slettet kunde. Bare administrator. */
export async function restoreCustomerAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const result = await restoreCustomer(actor, id);
  if (!result.ok) {
    redirect(
      `/kunder?slettet=1&error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidatePath("/kunder");
  redirect("/kunder?slettet=1&status=kunde-gjenopprettet");
}

/** Svarene kundeskjemaet kan få etter et oppslag i Enhetsregisteret. */
export type CompanyLookupState =
  | { status: "found"; company: CompanyRecord }
  | {
      status:
        | "not_found"
        | "removed"
        | "unavailable"
        | "invalid"
        | "forbidden"
        | "rate_limited";
    };

/**
 * Slår opp et organisasjonsnummer i Brønnøysundregistrene mens brukeren fyller
 * ut kundeskjemaet.
 *
 * Dette er et AJAX-kall, ikke en skjemainnsending: alle avvisninger returneres
 * som en status skjemaet kan vise. En redirect ville blitt tolket som svaret og
 * gjort at skjemaet mistet feltene brukeren allerede har skrevet.
 */
export async function lookupCompanyAction(
  orgNumber: string,
): Promise<CompanyLookupState> {
  const actor = await getCurrentUser();
  if (!actor) return { status: "forbidden" };
  if (!hasPermission(actor, "customers.manage")) return { status: "forbidden" };

  // Hvert oppslag går mot et eksternt register. Grensen er per bruker, slik at
  // én fane med raske tastetrykk ikke kan bruke opp kvoten for alle.
  if (!allowRequestMemory(`brreg:${actor.id}`, 20, 60_000).allowed) {
    return { status: "rate_limited" };
  }

  const input = cleanText(orgNumber, { maxLength: LIMITS.line });
  const normalized = normalizeOrgNumber(input);

  // Et tomt eller ugyldig nummer bruker vi ikke et eksternt kall på.
  let state: CompanyLookupState;
  if (!normalized) {
    state = { status: "invalid" };
  } else {
    const result = await lookupCompany(input);
    state =
      result.status === "found"
        ? { status: "found", company: result.company }
        : { status: result.status };
  }

  // Oppslaget endrer ingen forretningsdata, men det skal likevel ligge i den
  // hash-kjedede loggen med resultatet. Revisjonsfeil får ikke velte svaret.
  try {
    await auditStandalone({
      entityType: "Customer",
      entityId: normalized || `orgnr:${input}`,
      action: `Slått opp organisasjonsnummer: ${input}`,
      actor: toAuditActor(actor),
      actionCode: "customer.lookup",
      metadata: { status: state.status },
      retentionClass: "OPS_90D",
    });
  } catch (error) {
    console.error("Feil ved revisjon av organisasjonsnummeroppslag:", error);
  }

  return state;
}
