"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { createInviteToken, buildInviteUrl } from "@/lib/invite";
import { sendInviteEmail } from "@/lib/email";
import { LIMITS, cleanEmail, cleanText } from "@/lib/sanitize";
import { actorName, requireOffice } from "@/lib/session";

/**
 * Oppretter en kundeportalbruker koblet til en kontaktperson på kundekortet.
 * Brukeren er inaktiv og får en invitasjonslenke for å sette eget passord.
 */
export async function createPortalUser(formData: FormData) {
  if (!(await requireOffice())) return;
  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
  const email = cleanEmail(formData.get("email"));
  const contactId = cleanText(formData.get("contactId"), { maxLength: LIMITS.line });

  if (!customerId) return;
  if (!name || !email || !contactId) {
    redirect(`/kunder/${customerId}?tab=portal&error=mangler_felt`);
  }

  // Kontaktpersonen må faktisk tilhøre denne kunden.
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.customerId !== customerId) {
    redirect(`/kunder/${customerId}?tab=portal&error=ugyldig_kontakt`);
  }

  let newUser;
  try {
    newUser = await prisma.user.create({
      data: {
        name,
        email,
        role: "CUSTOMER",
        customerId,
        contactId: contact.id,
        isActive: false,
      },
    });
  } catch (err) {
    console.error("Feil ved opprettelse av kundeportalbruker", err);
    redirect(`/kunder/${customerId}?tab=portal&error=epost_finnes`);
  }

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customerId,
      action: `Opprettet kundeportalbruker: ${name} (${email})`,
      userName: await actorName(),
    },
  });

  const token = await createInviteToken(newUser.id);
  const mailSent = await sendInviteEmail(email, name, buildInviteUrl(token));

  revalidatePath(`/kunder/${customerId}`);
  redirect(
    `/kunder/${customerId}?tab=portal&invite=${newUser.id}&inviteToken=${encodeURIComponent(token)}&mail=${mailSent ? "sent" : "manual"}`
  );
}

/** Aktiverer eller deaktiverer en kundeportalbruker. */
export async function setPortalUserActive(formData: FormData) {
  if (!(await requireOffice())) return;
  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const active = formData.get("active") === "true";
  if (!customerId || !id) return;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.customerId !== customerId) return;

  await prisma.user.update({ where: { id }, data: { isActive: active } });
  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customerId,
      action: `${active ? "Aktiverte" : "Deaktiverte"} kundeportalbruker: ${target.name || target.email}`,
      userName: await actorName(),
    },
  });
  revalidatePath(`/kunder/${customerId}`);
}

/** Lager en ny invitasjonslenke for en kundeportalbruker. */
export async function resendPortalInvite(formData: FormData) {
  if (!(await requireOffice())) return;
  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  if (!customerId || !id) return;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.customerId !== customerId) return;

  const token = await createInviteToken(id);
  const mailSent = await sendInviteEmail(user.email || "", user.name, buildInviteUrl(token));

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customerId,
      action: `Sendte ny invitasjonslenke til kundeportalbruker: ${user.name || user.email}`,
      userName: await actorName(),
    },
  });
  revalidatePath(`/kunder/${customerId}`);
  redirect(
    `/kunder/${customerId}?tab=portal&invite=${id}&inviteToken=${encodeURIComponent(token)}&mail=${mailSent ? "sent" : "manual"}`
  );
}
