"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { createInviteToken, buildInviteUrl } from "@/lib/invite";
import { sendInviteEmail } from "@/lib/email";
import { actorName } from "@/lib/session";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  OFFICE: "Kontor",
  TECHNICIAN: "Montør",
  CUSTOMER: "Kundeportal",
  USER: "Standard",
};

/**
 * Hvor skal brukeren sendes tilbake etter handlingen? Skjemaet sender med
 * `returnTo`, slik at samme skjema virker både på /brukere og i
 * innstillinger-fanen. Kun relative stier internt i appen godtas.
 */
function returnPath(formData: FormData): string {
  const raw = (formData.get("returnTo") as string) || "";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/brukere";
}

/** Legger på et query-parameter, uansett om stien allerede har query. */
function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** Begge sidene som viser brukeradministrasjonen må revalideres. */
function revalidateUserAdmin() {
  revalidatePath("/brukere");
  revalidatePath("/innstillinger");
}

export async function createUser(formData: FormData) {
  const back = returnPath(formData);
  const name = formData.get("name") as string;
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const role = formData.get("role") as string;
  const contactId = (formData.get("contactId") as string) || "";

  if (!name || !email || !role) return;

  // Kundeportalbrukere må kobles til en kontaktperson på kundekortet.
  let customerId: string | null = null;
  let linkedContactId: string | null = null;

  if (role === "CUSTOMER") {
    if (!contactId) redirect(withParam(back, "error", "mangler_kontakt"));
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) redirect(withParam(back, "error", "mangler_kontakt"));
    customerId = contact.customerId;
    linkedContactId = contact.id;
  } else if (contactId) {
    // Andre roller kan også kobles til en kontakt, men det er valgfritt.
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (contact) {
      customerId = contact.customerId;
      linkedContactId = contact.id;
    }
  }

  let newUser;
  try {
    newUser = await prisma.user.create({
      data: {
        name,
        email,
        role,
        customerId,
        contactId: linkedContactId,
        isActive: false,
      },
    });
  } catch (err) {
    console.error("Feil ved opprettelse av bruker", err);
    redirect(withParam(back, "error", "epost_finnes"));
  }

  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: newUser.id,
      action: `Opprettet bruker: ${name} (${ROLE_LABELS[role] || role})`,
      userName: await actorName(),
    },
  });

  // Lager en invitasjonslenke slik at brukeren kan sette eget passord.
  const token = await createInviteToken(newUser.id);
  const mailSent = await sendInviteEmail(email, name, buildInviteUrl(token));

  revalidateUserAdmin();
  redirect(
    withParam(
      withParam(back, "invite", newUser.id),
      "mail",
      mailSent ? "sent" : "manual"
    )
  );
}

export async function deleteUser(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;

  const userToDelete = await prisma.user.findUnique({ where: { id } });
  if (!userToDelete) return;

  await prisma.user.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: id,
      action: `Slettet bruker: ${userToDelete.name || "Ukjent"}`,
      userName: await actorName(),
    },
  });
  revalidateUserAdmin();
}

export async function changeRole(formData: FormData) {
  const id = formData.get("id") as string;
  const newRole = formData.get("role") as string;
  if (!id || !newRole) return;

  const userToUpdate = await prisma.user.findUnique({ where: { id } });
  if (!userToUpdate) return;

  await prisma.user.update({ where: { id }, data: { role: newRole } });
  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: id,
      action: `Endret rolle for ${userToUpdate.name || "Ukjent"} til ${ROLE_LABELS[newRole] || newRole}`,
      userName: await actorName(),
    },
  });
  revalidateUserAdmin();
}

export async function setActive(formData: FormData) {
  const id = formData.get("id") as string;
  const active = formData.get("active") === "true";
  if (!id) return;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;

  await prisma.user.update({ where: { id }, data: { isActive: active } });
  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: id,
      action: `${active ? "Aktiverte" : "Deaktiverte"} bruker: ${target.name || target.email}`,
      userName: await actorName(),
    },
  });
  revalidateUserAdmin();
}

export async function generateInvite(formData: FormData) {
  const back = returnPath(formData);
  const id = formData.get("id") as string;
  if (!id) return;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return;

  const token = await createInviteToken(id);
  const mailSent = await sendInviteEmail(
    user.email || "",
    user.name,
    buildInviteUrl(token)
  );
  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: id,
      action: `Genererte ny invitasjonslenke for: ${user.name || user.email}`,
      userName: await actorName(),
    },
  });
  revalidateUserAdmin();
  redirect(
    withParam(withParam(back, "invite", id), "mail", mailSent ? "sent" : "manual")
  );
}
