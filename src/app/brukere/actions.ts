"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { createInviteToken, buildInviteUrl } from "@/lib/invite";
import { sendInviteEmail } from "@/lib/email";
import { LIMITS, cleanEmail, cleanPhone, cleanText } from "@/lib/sanitize";
import {
  getCurrentUser,
  requireAdmin,
  requirePermission,
} from "@/lib/session";
import {
  assignedPermissions,
  cleanPermissions,
  effectivePermissions,
  hasPermission,
  isPermission,
} from "@/lib/permissions";
import {
  userActiveSchema,
  userCreateSchema,
  userInviteSchema,
  userPermissionsSchema,
  userPhoneSchema,
  userRoleSchema,
} from "@/lib/schemas/user";

const auditActor = (user: {
  id: string;
  name: string | null;
  email: string | null;
}) => ({ id: user.id, name: user.name, email: user.email });

type RoleRecord = {
  key: string;
  label: string;
  permissions: string[];
};

/** Henter en rolle fra databasen. Roller er data, ikke en fast enum. */
async function findRole(raw: FormDataEntryValue | null): Promise<RoleRecord | null> {
  const key = cleanText(raw, { maxLength: LIMITS.short });
  if (!key) return null;
  return prisma.role.findUnique({
    where: { key },
    select: { key: true, label: true, permissions: true },
  });
}

/**
 * En ikke-administrator kan bare tildele roller som ikke gir rettigheter
 * vedkommende ikke har selv. Det hindrer at brukeradministrasjon blir en vei
 * til å gi seg selv eller andre mer tilgang enn rollen tillater.
 */
function canAssignRole(
  actor: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  role: RoleRecord,
): boolean {
  if (actor.role === "ADMIN") return true;
  if (role.key === "ADMIN") return false;
  const actorPermissions = effectivePermissions(actor);
  return role.permissions.every(
    (permission) => !isPermission(permission) || actorPermissions.has(permission),
  );
}

function samePermissions(left: string[], right: string[]): boolean {
  const a = new Set(left.filter(isPermission));
  const b = new Set(right.filter(isPermission));
  return a.size === b.size && [...a].every((permission) => b.has(permission));
}

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
  const phone = cleanPhone(formData.get("phone"));
  const role = await findRole(formData.get("role"));
  const contactId = cleanText(formData.get("contactId"), { maxLength: LIMITS.line });
  let departmentId = await validDepartmentId(formData.get("departmentId"));

  const parsed = userCreateSchema.safeParse({
    name,
    email,
    phone,
    role: cleanText(formData.get("role"), { maxLength: LIMITS.short }),
    departmentId,
    contactId,
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));

  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  // Bare administrator kan opprette nye administratorer.
  if (role?.key === "ADMIN") {
    if (actor.role !== "ADMIN") return;
  } else if (!hasPermission(actor, "users.manage")) {
    return;
  }

  if (!role || !canAssignRole(actor, role)) return;

  // Kundeportalbrukere gir tilgang til kundedata og krever customers.manage.
  if (role.key === "CUSTOMER" && !hasPermission(actor, "customers.manage")) return;

  if (!name || !email) return;
  if (role.key === "CUSTOMER") {
    departmentId = null;
  } else if (actor.role !== "ADMIN") {
    // En avdelingsansvarlig kan bare opprette ansatte i egen avdeling.
    if (!actor.departmentId) return;
    departmentId = actor.departmentId;
  }

  // Kundeportalbrukere må kobles til en kontaktperson på kundekortet.
  let customerId: string | null = null;
  let linkedContactId: string | null = null;

  if (role.key === "CUSTOMER") {
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
  let token = "";
  try {
    newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          email,
          phone: phone || null,
          role: role.key,
          departmentId,
          customerId,
          contactId: linkedContactId,
          isActive: false,
        },
      });

      // Invitasjonsnøkkelen lages i samme transaksjon som brukeren, slik at en
      // feil i loggen ruller tilbake både kontoen og nøkkelen.
      token = await createInviteToken(created.id, tx);

      await audit(tx, {
        entityType: "User",
        entityId: created.id,
        action: `Opprettet bruker: ${name} (${role.label})`,
        actor: auditActor(actor),
      });

      return created;
    });
  } catch (err) {
    console.error("Feil ved opprettelse av bruker", err);
    redirect(withParam(back, "error", "epost_finnes"));
  }

  // Invitasjonslenken sendes først etter at brukeren er lagret.
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

  const parsed = userInviteSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
  });
  if (!parsed.success) redirect(withParam(returnPath(formData), "error", "ugyldig-data"));
  const id = parsed.data.id;

  const userToDelete = await prisma.user.findUnique({ where: { id } });
  if (!userToDelete) return;

  // Ikke slett deg selv, og ikke fjern den siste aktive administratoren.
  if (userToDelete.id === actor.id) return;
  if (userToDelete.role === "ADMIN") {
    if (userToDelete.isActive && (await activeAdminCount(userToDelete.id)) === 0) {
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id } });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Slettet bruker: ${userToDelete.name || "Ukjent"}`,
      actor: auditActor(actor),
    });
  });
  revalidateUserAdmin();
}

export async function changeRole(formData: FormData) {
  const back = returnPath(formData);
  const parsed = userRoleSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
    role: cleanText(formData.get("role"), { maxLength: LIMITS.short }),
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));
  const { id } = parsed.data;
  const newRole = await findRole(parsed.data.role);
  if (!newRole) return;

  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const userToUpdate = await prisma.user.findUnique({ where: { id } });
  if (!userToUpdate) return;

  // Roller som berører administrator krever administrator. Det hindrer at en
  // kontorbruker gir seg selv – eller noen andre – full tilgang.
  const touchesAdmin = userToUpdate.role === "ADMIN" || newRole.key === "ADMIN";
  if (touchesAdmin) {
    if (actor.role !== "ADMIN") return;
  } else if (!hasPermission(actor, "users.manage")) {
    return;
  }

  if (!canAssignRole(actor, newRole)) return;

  // Kundeportalbrukere gir tilgang til kundedata og krever customers.manage.
  if (newRole.key === "CUSTOMER" && !hasPermission(actor, "customers.manage")) return;

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
    newRole.key !== "ADMIN" &&
    (await activeAdminCount(userToUpdate.id)) === 0
  ) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        role: newRole.key,
        // En ny rolle skal gjelde fra start; en gammel tilpasset liste skal ikke
        // henge igjen og overstyre den nye rollen.
        permissions: [],
        permissionsCustomized: false,
        // Kundeportalbrukere skal ikke være knyttet til en intern avdeling.
        departmentId: newRole.key === "CUSTOMER" ? null : userToUpdate.departmentId,
        // Ugyldiggjør eksisterende økter i samme transaksjon.
        sessionVersion: { increment: 1 },
      },
    });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Endret rolle for ${userToUpdate.name || "Ukjent"} til ${newRole.label}`,
      actor: auditActor(actor),
    });
  });
  revalidateUserAdmin();
}

export async function setActive(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const parsed = userActiveSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
    active: formData.get("active"),
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));
  const { id, active } = parsed.data;

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

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { isActive: active, sessionVersion: { increment: 1 } },
    });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `${active ? "Aktiverte" : "Deaktiverte"} bruker: ${target.name || target.email}`,
      actor: auditActor(actor),
    });
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
  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const back = returnPath(formData);
  const parsed = userInviteSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));
  const id = parsed.data.id;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;

  const departmentId = target.role === "CUSTOMER"
    ? null
    : await validDepartmentId(formData.get("departmentId"));

  let departmentName = "Ingen avdeling";
  if (departmentId) {
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { name: true },
    });
    departmentName = department?.name ?? departmentName;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { departmentId, sessionVersion: { increment: 1 } },
    });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Endret avdeling for ${target.name || target.email || "Ukjent"} til ${departmentName}`,
      actor: auditActor(actor),
    });
  });
  revalidateUserAdmin();
}

export async function changePhone(formData: FormData) {
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const parsed = userPhoneSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
    phone: cleanPhone(formData.get("phone")),
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));
  const { id, phone } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id },
    include: { roleDefinition: true },
  });
  if (!target) return;

  // Bare administrator eller den ansatte selv kan endre telefonnummer.
  const isSelf = actor.id === id;
  if (!isSelf) {
    if (!hasPermission(actor, "users.manage")) return;
    // Samme regler som de øvrige brukerhandlingene: ikke rør administratorer
    // eller brukere utenfor egen avdeling.
    if (target.role === "ADMIN" && actor.role !== "ADMIN") return;
    if (
      actor.role !== "ADMIN" &&
      (!actor.departmentId || target.departmentId !== actor.departmentId)
    ) {
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { phone: phone || null } });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Endret telefonnummer for ${target.name || target.email || "Ukjent"}`,
      actor: auditActor(actor),
    });
  });
  revalidateUserAdmin();
}

/**
 * Lagrer tilpassede rettigheter for en bruker. Bare administrator. Listen
 * overstyrer rollens rettigheter helt. Velger man nøyaktig rollens liste,
 * fjernes overstyringen slik at brukeren følger rollen videre.
 */
export async function changePermissions(formData: FormData) {
  if (!(await requireAdmin())) return;
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const parsed = userPermissionsSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
    permissions: formData.getAll("permissions").map((value) => String(value)),
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));
  const { id } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id },
    include: { roleDefinition: true },
  });
  if (!target) return;

  // Administrator har alltid alle rettigheter, og kundeportalen styres av
  // kundetilknytningen. Tilpassede lister ville bare vært misvisende.
  if (target.role === "ADMIN" || target.role === "CUSTOMER") return;

  const permissions = cleanPermissions(parsed.data.permissions);
  const rolePermissions = target.roleDefinition?.permissions ?? [];
  const customized = !samePermissions(permissions, rolePermissions);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        permissions: customized ? permissions : [],
        permissionsCustomized: customized,
        sessionVersion: { increment: 1 },
      },
    });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: customized
        ? `Endret tilpassede rettigheter for ${target.name || target.email || "Ukjent"}`
        : `Tilbakestilte rettigheter til rollen for ${target.name || target.email || "Ukjent"}`,
      actor: auditActor(actor),
    });
  });
  revalidateUserAdmin();
}

/** Fjerner en tilpasset rettighetsliste og lar rollen gjelde igjen. */
export async function resetPermissions(formData: FormData) {
  if (!(await requireAdmin())) return;
  const back = returnPath(formData);
  const actor = await getCurrentUser();
  if (!actor?.isActive) return;

  const parsed = userInviteSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));
  const id = parsed.data.id;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        permissions: [],
        permissionsCustomized: false,
        sessionVersion: { increment: 1 },
      },
    });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Tilbakestilte rettigheter til rollen for ${target.name || target.email || "Ukjent"}`,
      actor: auditActor(actor),
    });
  });
  revalidateUserAdmin();
}

export async function generateInvite(formData: FormData) {
  const back = returnPath(formData);
  const parsed = userInviteSchema.safeParse({
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
  });
  if (!parsed.success) redirect(withParam(back, "error", "ugyldig-data"));
  const id = parsed.data.id;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { roleDefinition: true },
  });
  if (!user) return;

  const actor = await getCurrentUser();
  if (!actor?.isActive) return;
  if (!hasPermission(actor, "users.manage")) return;

  // En invitasjonslenke gir mulighet til å sette nytt passord. For en
  // administrator er det derfor en full kontoovertakelse, og krever admin.
  if (user.role === "ADMIN" && actor.role !== "ADMIN") return;

  // Avdelingsansvarlige kan bare invitere brukere i egen avdeling.
  if (
    actor.role !== "ADMIN" &&
    (!actor.departmentId || user.departmentId !== actor.departmentId)
  ) {
    return;
  }

  // En aktør kan ikke invitere en bruker som har rettigheter aktøren ikke har
  // selv – det ville latt aktøren ta over en konto med mer tilgang.
  if (actor.role !== "ADMIN") {
    const actorPerms = assignedPermissions(actor);
    const targetPerms = assignedPermissions(user);
    for (const permission of targetPerms) {
      if (!actorPerms.has(permission)) return;
    }
  }

  const token = await prisma.$transaction(async (tx) => {
    const created = await createInviteToken(id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Genererte ny invitasjonslenke for: ${user.name || user.email}`,
      actor: auditActor(actor),
    });
    return created;
  });
  const mailSent = await sendInviteEmail(
    user.email || "",
    user.name,
    buildInviteUrl(token)
  );
  revalidateUserAdmin();
  redirect(
    withParam(
      withParam(withParam(back, "invite", id), "inviteToken", token),
      "mail",
      mailSent ? "sent" : "manual"
    )
  );
}
