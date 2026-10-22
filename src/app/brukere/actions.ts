"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { createInviteToken, buildInviteUrl } from "@/lib/invite";
import { sendInviteEmail } from "@/lib/email";
import { LIMITS, cleanEmail, cleanRole, cleanText } from "@/lib/sanitize";
import {
  actorName,
  getCurrentUser,
  requireAdmin,
  requirePermission,
} from "@/lib/session";
import { cleanPermissions, hasPermission } from "@/lib/permissions";

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

/** Antall aktive administratorer, eventuelt utenom én bestemt bruker. */
async function activeAdminCount(excludeId?: string): Promise<number> {
  return prisma.user.count({
    where: {
      role: "ADMIN",
      isActive: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/** Godtar bare en aktiv avdeling, ellers null. */
async function validDepartmentId(raw: FormDataEntryValue | null): Promise<string | null> {
  const id = cleanText(raw, { maxLength: LIMITS.line });
  if (!id) return null;
  const department = await prisma.department.findFirst({
    where: { id, isActive: true },
    select: { id: true },
  });
  return department?.id ?? null;
}

export async function createUser(formData: FormData) {
  const back = returnPath(formData);
  const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
  const email = cleanEmail(formData.get("email"));
  const role = cleanRole(formData.get("role"));
  const contactId = cleanText(formData.get("contactId"), { maxLength: LIMITS.line });
  let departmentId = await validDepartmentId(formData.get("departmentId"));

  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  // Bare administrator kan opprette nye administratorer.
  if (role === "ADMIN") {
    if (actor.role !== "ADMIN") return;
  } else if (!hasPermission(actor, "users.manage")) {
    return;
  }

  // Kundeportalbrukere gir tilgang til kundedata og krever customers.manage.
  if (role === "CUSTOMER" && !hasPermission(actor, "customers.manage")) return;

  if (!name || !email || !role) return;
  if (role === "CUSTOMER") {
    departmentId = null;
  } else if (actor.role !== "ADMIN") {
    // En avdelingsansvarlig kan bare opprette ansatte i egen avdeling.
    if (!actor.departmentId) return;
    departmentId = actor.departmentId;
  }

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
        departmentId,
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
      withParam(
        withParam(back, "invite", newUser.id),
        "inviteToken",
        token
      ),
      "mail",
      mailSent ? "sent" : "manual"
    )
  );
}

export async function deleteUser(formData: FormData) {
  // Sletting er alltid forbeholdt administrator.
  if (!(await requireAdmin())) return;

  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  if (!id) return;

  const userToDelete = await prisma.user.findUnique({ where: { id } });
  if (!userToDelete) return;

  // Ikke slett deg selv, og ikke fjern den siste aktive administratoren.
  if (userToDelete.id === actor.id) return;
  if (userToDelete.role === "ADMIN") {
    if (userToDelete.isActive && (await activeAdminCount(userToDelete.id)) === 0) {
      return;
    }
  }

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
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const newRole = cleanRole(formData.get("role"));
  if (!id || !newRole) return;

  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const userToUpdate = await prisma.user.findUnique({ where: { id } });
  if (!userToUpdate) return;

  // Roller som berører administrator krever administrator. Det hindrer at en
  // kontorbruker gir seg selv – eller noen andre – full tilgang.
  const touchesAdmin = userToUpdate.role === "ADMIN" || newRole === "ADMIN";
  if (touchesAdmin) {
    if (actor.role !== "ADMIN") return;
  } else if (!hasPermission(actor, "users.manage")) {
    return;
  }

  // Kundeportalbrukere gir tilgang til kundedata og krever customers.manage.
  if (newRole === "CUSTOMER" && !hasPermission(actor, "customers.manage")) return;

  // Avdelingsansvarlige kan bare endre brukere i egen avdeling.
  if (
    actor.role !== "ADMIN" &&
    (!actor.departmentId || userToUpdate.departmentId !== actor.departmentId)
  ) {
    return;
  }

  // Ikke fjern den siste aktive administratoren.
  if (
    userToUpdate.role === "ADMIN" &&
    newRole !== "ADMIN" &&
    (await activeAdminCount(userToUpdate.id)) === 0
  ) {
    return;
  }

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
  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const active = formData.get("active") === "true";
  if (!id) return;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;

  // Avdelingsansvarlige kan bare endre brukere i egen avdeling.
  if (
    actor.role !== "ADMIN" &&
    (!actor.departmentId || target.departmentId !== actor.departmentId)
  ) {
    return;
  }

  // Endringer på en administrator krever administrator.
  if (target.role === "ADMIN") {
    if (!(await requireAdmin())) return;
    // Ikke deaktiver deg selv eller den siste aktive administratoren.
    if (!active && target.id === actor.id) return;
    if (!active && target.isActive && (await activeAdminCount(target.id)) === 0) {
      return;
    }
  } else if (!(await requirePermission("users.manage"))) {
    return;
  }

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

/**
 * Flytter en ansatt til en annen avdeling. Bare administrator kan gjøre dette:
 * avdelingen avgjør hvilke oppdrag brukeren ser, så en avdelingsansvarlig må
 * ikke kunne flytte seg selv eller andre til en annen avdeling.
 */
export async function changeDepartment(formData: FormData) {
  if (!(await requireAdmin())) return;

  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  if (!id) return;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;

  const departmentId = target.role === "CUSTOMER"
    ? null
    : await validDepartmentId(formData.get("departmentId"));

  await prisma.user.update({ where: { id }, data: { departmentId } });

  let departmentName = "Ingen avdeling";
  if (departmentId) {
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { name: true },
    });
    departmentName = department?.name ?? departmentName;
  }

  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: id,
      action: `Endret avdeling for ${target.name || target.email || "Ukjent"} til ${departmentName}`,
      userName: await actorName(),
    },
  });
  revalidateUserAdmin();
}

/** Lagrer ekstra rettigheter utover rollens standardnivå. Bare admin. */
export async function changePermissions(formData: FormData) {
  if (!(await requireAdmin())) return;

  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  if (!id) return;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;

  const permissions = cleanPermissions(
    formData.getAll("permissions").map((value) => String(value)),
  );

  await prisma.user.update({ where: { id }, data: { permissions } });
  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: id,
      action: `Endret ekstra rettigheter for ${target.name || target.email || "Ukjent"}`,
      userName: await actorName(),
    },
  });
  revalidateUserAdmin();
}

export async function generateInvite(formData: FormData) {
  const back = returnPath(formData);
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  if (!id) return;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return;

  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  // En invitasjonslenke gir mulighet til å sette nytt passord. For en
  // administrator er det derfor en full kontoovertakelse, og krever admin.
  if (user.role === "ADMIN") {
    if (actor.role !== "ADMIN") return;
  } else if (!hasPermission(actor, "users.manage")) {
    return;
  }

  // Avdelingsansvarlige kan bare invitere brukere i egen avdeling.
  if (
    actor.role !== "ADMIN" &&
    (!actor.departmentId || user.departmentId !== actor.departmentId)
  ) {
    return;
  }

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
    withParam(
      withParam(withParam(back, "invite", id), "inviteToken", token),
      "mail",
      mailSent ? "sent" : "manual"
    )
  );
}
