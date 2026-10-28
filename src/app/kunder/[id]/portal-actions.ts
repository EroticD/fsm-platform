"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { buildInviteUrl } from "@/lib/invite";
import type { InviteActionState } from "@/lib/invite-action-state";
import {
  createPortalUser as createPortalUserService,
  resendPortalInvite as resendPortalInviteService,
  setPortalUserActive as setPortalUserActiveService,
} from "@/server/users";

/**
 * Oppretter en kundeportalbruker koblet til en kontaktperson på kundekortet.
 * Brukeren er inaktiv og får en invitasjonslenke for å sette eget passord.
 *
 * Lenken returneres til den autentiserte siden og vises i sideinnholdet når
 * e-posten ikke kunne sendes. Den legges aldri i en URL.
 */
export async function createPortalUser(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { status: "error" };

  const customerId = String(formData.get("customerId") ?? "");
  const result = await createPortalUserService(actor, {
    customerId,
    name: formData.get("name"),
    email: formData.get("email"),
    contactId: formData.get("contactId"),
  });

  if (!result.ok) {
    if (!customerId) return { status: "error" };
    if (result.reason === "missing_fields") {
      redirect(`/kunder/${customerId}?tab=mer&error=mangler_felt#portal`);
    }
    if (result.reason === "invalid_contact") {
      redirect(`/kunder/${customerId}?tab=mer&error=ugyldig_kontakt#portal`);
    }
    if (result.reason === "duplicate_email") {
      redirect(`/kunder/${customerId}?tab=mer&error=epost_finnes#portal`);
    }
    return { status: "error" };
  }

  const { customerId: savedCustomerId, token, mailSent } = result.data;
  revalidatePath(`/kunder/${savedCustomerId}`);
  return {
    status: "invite",
    inviteUrl: mailSent ? "" : buildInviteUrl(token),
    mailSent,
    name: String(formData.get("name") ?? ""),
  };
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
export async function resendPortalInvite(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { status: "error" };

  const result = await resendPortalInviteService(actor, {
    customerId: formData.get("customerId"),
    id: formData.get("id"),
  });
  if (!result.ok) return { status: "error" };

  const { customerId, token, mailSent } = result.data;
  revalidatePath(`/kunder/${customerId}`);
  return {
    status: "invite",
    inviteUrl: mailSent ? "" : buildInviteUrl(token),
    mailSent,
    name: "",
  };
}
