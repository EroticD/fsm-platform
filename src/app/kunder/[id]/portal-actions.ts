"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createPortalUser as createPortalUserService,
  resendPortalInvite as resendPortalInviteService,
  setPortalUserActive as setPortalUserActiveService,
} from "@/server/users";

/**
 * Oppretter en kundeportalbruker koblet til en kontaktperson på kundekortet.
 * Brukeren er inaktiv og får en invitasjonslenke for å sette eget passord.
 */
export async function createPortalUser(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createPortalUserService(actor, {
    customerId: formData.get("customerId"),
    name: formData.get("name"),
    email: formData.get("email"),
    contactId: formData.get("contactId"),
  });

  if (!result.ok) {
    const customerId = String(formData.get("customerId") ?? "");
    if (!customerId) return;
    if (result.reason === "missing_fields") {
      redirect(`/kunder/${customerId}?tab=portal&error=mangler_felt`);
    }
    if (result.reason === "invalid_contact") {
      redirect(`/kunder/${customerId}?tab=portal&error=ugyldig_kontakt`);
    }
    if (result.reason === "duplicate_email") {
      redirect(`/kunder/${customerId}?tab=portal&error=epost_finnes`);
    }
    return;
  }

  const { customerId, id, mailSent } = result.data;
  revalidatePath(`/kunder/${customerId}`);
  // Invitasjonsnøkkelen sendes i e-post, ikke i adressen. En URL med nøkkelen
  // ville lagret et kontoovertakelsesmiddel i logger og historikk.
  redirect(
    `/kunder/${customerId}?tab=portal&invite=${id}&mail=${mailSent ? "sent" : "manual"}`,
  );
}

/** Aktiverer eller deaktiverer en kundeportalbruker. */
export async function setPortalUserActive(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const customerId = String(formData.get("customerId") ?? "");
  const result = await setPortalUserActiveService(actor, {
    customerId,
    id: formData.get("id"),
    active: formData.get("active"),
  });
  if (!result.ok || !customerId) return;

  revalidatePath(`/kunder/${customerId}`);
}

/** Lager en ny invitasjonslenke for en kundeportalbruker. */
export async function resendPortalInvite(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await resendPortalInviteService(actor, {
    customerId: formData.get("customerId"),
    id: formData.get("id"),
  });
  if (!result.ok) return;

  const { customerId, id, mailSent } = result.data;
  revalidatePath(`/kunder/${customerId}`);
  // Invitasjonsnøkkelen sendes i e-post, ikke i adressen. En URL med nøkkelen
  // ville lagret et kontoovertakelsesmiddel i logger og historikk.
  redirect(
    `/kunder/${customerId}?tab=portal&invite=${id}&mail=${mailSent ? "sent" : "manual"}`,
  );
}
