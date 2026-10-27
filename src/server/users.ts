import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { buildInviteUrl, createInviteToken } from "@/lib/invite";
import { sendInviteEmail } from "@/lib/email";
import {
  LIMITS,
  cleanEmail,
  cleanPhone,
  cleanText,
} from "@/lib/sanitize";
import {
  assignedPermissions,
  cleanPermissions,
  effectivePermissions,
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
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import { clearCalendarToken } from "./calendar-feed";

type RoleRecord = {
  key: string;
  label: string;
  permissions: string[];
};

type RoleAwareActor = ServiceActor & {
  roleDefinition?: { permissions?: string[] | null } | null;
};

/** Henter en rolle fra databasen. Roller er data, ikke en fast enum. */
async function findRole(raw: unknown): Promise<RoleRecord | null> {
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
function canAssignRole(actor: RoleAwareActor, role: RoleRecord): boolean {
  if (isAdminActor(actor)) return true;
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
async function validDepartmentId(raw: unknown): Promise<string | null> {
  const id = cleanText(raw, { maxLength: LIMITS.line });
  if (!id) return null;
  const department = await prisma.department.findFirst({
    where: { id, isActive: true },
    select: { id: true },
  });
  return department?.id ?? null;
}

export type UserCreateInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  departmentId?: unknown;
  contactId?: unknown;
};

export type CreatedUser = {
  id: string;
  name: string;
  email: string;
  token: string;
  mailSent: boolean;
};

export async function createUser(
  actor: ServiceActor,
  input: UserCreateInput,
): Promise<ServiceResult<CreatedUser>> {
  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const email = cleanEmail(input.email);
  const phone = cleanPhone(input.phone);
  const role = await findRole(input.role);
  const contactId = cleanText(input.contactId, { maxLength: LIMITS.line });
  let departmentId = await validDepartmentId(input.departmentId);

  const parsed = userCreateSchema.safeParse({
    name,
    email,
    phone,
    role: cleanText(input.role, { maxLength: LIMITS.short }),
    departmentId,
    contactId,
  });
  if (!parsed.success) return fail("invalid");

  if (!actor.isActive) return fail("forbidden");

  // Bare administrator kan opprette nye administratorer.
  if (role?.key === "ADMIN") {
    if (!isAdminActor(actor)) return fail("forbidden");
  } else if (!can(actor, "users.manage")) {
    return fail("forbidden");
  }

  if (!role || !canAssignRole(actor, role)) return fail("forbidden");

  // Kundeportalbrukere gir tilgang til kundedata og krever customers.manage.
  if (role.key === "CUSTOMER" && !can(actor, "customers.manage")) {
    return fail("forbidden");
  }

  if (!name || !email) return fail("forbidden");
  if (role.key === "CUSTOMER") {
    departmentId = null;
  } else if (!isAdminActor(actor)) {
    // En avdelingsansvarlig kan bare opprette ansatte i egen avdeling.
    if (!actor.departmentId) return fail("forbidden");
    departmentId = actor.departmentId;
  }

  // Kundeportalbrukere må kobles til en kontaktperson på kundekortet. Andre
  // roller skal aldri knyttes til en kunde: en ansattkonto med customerId ville
  // gjort kundetilknytningen til en del av identiteten, og en kontaktperson i
  // skjemaet ignoreres derfor for ikke-kundeportalroller.
  let customerId: string | null = null;
  let linkedContactId: string | null = null;

  if (role.key === "CUSTOMER") {
    if (!contactId) return fail("missing_contact");
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return fail("missing_contact");
    customerId = contact.customerId;
    linkedContactId = contact.id;
  }

  let newUser: { id: string };
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
        actor: toAuditActor(actor),
      });

      return created;
    });
  } catch (error) {
    console.error("Feil ved opprettelse av bruker", error);
    return fail("duplicate_email");
  }

  // Invitasjonslenken sendes først etter at brukeren er lagret.
  const mailSent = await sendInviteEmail(email, name, buildInviteUrl(token));

  return ok({ id: newUser.id, name, email, token, mailSent });
}

export async function deleteUser(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  // Sletting er alltid forbeholdt administrator.
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const parsed = userInviteSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;

  const userToDelete = await prisma.user.findUnique({ where: { id } });
  if (!userToDelete) return fail("not_found");

  // Ikke slett deg selv, og ikke fjern den siste aktive administratoren.
  if (userToDelete.id === actor.id) return fail("forbidden");
  if (userToDelete.role === "ADMIN") {
    if (
      userToDelete.isActive &&
      (await activeAdminCount(userToDelete.id)) === 0
    ) {
      return fail("forbidden");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id } });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Slettet bruker: ${userToDelete.name || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

export async function changeRole(
  actor: ServiceActor,
  input: { id?: unknown; role?: unknown },
): Promise<ServiceResult> {
  const parsed = userRoleSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    role: cleanText(input.role, { maxLength: LIMITS.short }),
  });
  if (!parsed.success) return fail("invalid");
  const { id } = parsed.data;
  const newRole = await findRole(parsed.data.role);
  if (!newRole) return fail("not_found");

  if (!actor.isActive) return fail("forbidden");

  const userToUpdate = await prisma.user.findUnique({ where: { id } });
  if (!userToUpdate) return fail("not_found");

  // Roller som berører administrator krever administrator. Det hindrer at en
  // kontorbruker gir seg selv – eller noen andre – full tilgang.
  const touchesAdmin =
    userToUpdate.role === "ADMIN" || newRole.key === "ADMIN";
  if (touchesAdmin) {
    if (!isAdminActor(actor)) return fail("forbidden");
  } else if (!can(actor, "users.manage")) {
    return fail("forbidden");
  }

  if (!canAssignRole(actor, newRole)) return fail("forbidden");

  // Kundeportalbrukere gir tilgang til kundedata og krever customers.manage.
  if (newRole.key === "CUSTOMER") {
    if (!can(actor, "customers.manage")) return fail("forbidden");
    // En kundeportalbruker uten kundetilknytning må aldri oppstå: da ville
    // PDF-tilgangen kunne matche oppdrag uten kunde (`null === null`).
    if (!userToUpdate.customerId) return fail("forbidden");
  }

  // Avdelingsansvarlige kan bare endre brukere i egen avdeling.
  if (
    !isAdminActor(actor) &&
    (!actor.departmentId || userToUpdate.departmentId !== actor.departmentId)
  ) {
    return fail("forbidden");
  }

  // Ikke fjern den siste aktive administratoren.
  if (
    userToUpdate.role === "ADMIN" &&
    newRole.key !== "ADMIN" &&
    (await activeAdminCount(userToUpdate.id)) === 0
  ) {
    return fail("forbidden");
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
        departmentId:
          newRole.key === "CUSTOMER" ? null : userToUpdate.departmentId,
        // Ugyldiggjør eksisterende økter i samme transaksjon.
        sessionVersion: { increment: 1 },
      },
    });
    await clearCalendarToken(id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Endret rolle for ${userToUpdate.name || "Ukjent"} til ${newRole.label}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

export async function setActive(
  actor: ServiceActor,
  input: { id?: unknown; active?: unknown },
): Promise<ServiceResult> {
  if (!actor.isActive) return fail("forbidden");

  const parsed = userActiveSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    active: input.active,
  });
  if (!parsed.success) return fail("invalid");
  const { id, active } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return fail("not_found");

  // Avdelingsansvarlige kan bare endre brukere i egen avdeling.
  if (
    !isAdminActor(actor) &&
    (!actor.departmentId || target.departmentId !== actor.departmentId)
  ) {
    return fail("forbidden");
  }

  // Endringer på en administrator krever administrator.
  if (target.role === "ADMIN") {
    if (!isAdminActor(actor)) return fail("forbidden");
    // Ikke deaktiver deg selv eller den siste aktive administratoren.
    if (!active && target.id === actor.id) return fail("forbidden");
    if (
      !active &&
      target.isActive &&
      (await activeAdminCount(target.id)) === 0
    ) {
      return fail("forbidden");
    }
  } else if (!can(actor, "users.manage")) {
    return fail("forbidden");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { isActive: active, sessionVersion: { increment: 1 } },
    });
    if (!active) await clearCalendarToken(id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `${active ? "Aktiverte" : "Deaktiverte"} bruker: ${target.name || target.email}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

/**
 * Flytter en ansatt til en annen avdeling. Bare administrator kan gjøre dette:
 * avdelingen avgjør hvilke oppdrag brukeren ser, så en avdelingsansvarlig må
 * ikke kunne flytte seg selv eller andre til en annen avdeling.
 */
export async function changeDepartment(
  actor: ServiceActor,
  input: { id?: unknown; departmentId?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const parsed = userInviteSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return fail("not_found");

  const departmentId =
    target.role === "CUSTOMER"
      ? null
      : await validDepartmentId(input.departmentId);

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
    await clearCalendarToken(id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Endret avdeling for ${target.name || target.email || "Ukjent"} til ${departmentName}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

export async function changePhone(
  actor: ServiceActor,
  input: { id?: unknown; phone?: unknown },
): Promise<ServiceResult> {
  if (!actor.isActive) return fail("forbidden");

  const parsed = userPhoneSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    phone: cleanPhone(input.phone),
  });
  if (!parsed.success) return fail("invalid");
  const { id, phone } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id },
    include: { roleDefinition: true },
  });
  if (!target) return fail("not_found");

  // Bare administrator eller den ansatte selv kan endre telefonnummer.
  const isSelf = actor.id === id;
  if (!isSelf) {
    if (!can(actor, "users.manage")) return fail("forbidden");
    // Samme regler som de øvrige brukerhandlingene: ikke rør administratorer
    // eller brukere utenfor egen avdeling.
    if (target.role === "ADMIN" && !isAdminActor(actor)) return fail("forbidden");
    if (
      !isAdminActor(actor) &&
      (!actor.departmentId || target.departmentId !== actor.departmentId)
    ) {
      return fail("forbidden");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { phone: phone || null } });
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Endret telefonnummer for ${target.name || target.email || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

/**
 * Lagrer tilpassede rettigheter for en bruker. Bare administrator. Listen
 * overstyrer rollens rettigheter helt. Velger man nøyaktig rollens liste,
 * fjernes overstyringen slik at brukeren følger rollen videre.
 */
export async function changePermissions(
  actor: ServiceActor,
  input: { id?: unknown; permissions?: unknown[] },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const parsed = userPermissionsSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    permissions: (input.permissions ?? []).map((value) => String(value)),
  });
  if (!parsed.success) return fail("invalid");
  const { id } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id },
    include: { roleDefinition: true },
  });
  if (!target) return fail("not_found");

  // Administrator har alltid alle rettigheter, og kundeportalen styres av
  // kundetilknytningen. Tilpassede lister ville bare vært misvisende.
  if (target.role === "ADMIN" || target.role === "CUSTOMER") {
    return fail("forbidden");
  }

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
    await clearCalendarToken(id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: customized
        ? `Endret tilpassede rettigheter for ${target.name || target.email || "Ukjent"}`
        : `Tilbakestilte rettigheter til rollen for ${target.name || target.email || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

/** Fjerner en tilpasset rettighetsliste og lar rollen gjelde igjen. */
export async function resetPermissions(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const parsed = userInviteSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        permissions: [],
        permissionsCustomized: false,
        sessionVersion: { increment: 1 },
      },
    });
    await clearCalendarToken(id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Tilbakestilte rettigheter til rollen for ${target.name || target.email || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

export type GeneratedInvite = {
  id: string;
  token: string;
  mailSent: boolean;
};

export async function generateInvite(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult<GeneratedInvite>> {
  const parsed = userInviteSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { roleDefinition: true },
  });
  if (!user) return fail("not_found");

  if (!actor.isActive) return fail("forbidden");
  if (!can(actor, "users.manage")) return fail("forbidden");

  // En invitasjonslenke lar mottakeren sette nytt passord. For en konto som
  // allerede er aktiv er det en kontoovertakelse, ikke en invitasjon. Aktive
  // brukere må bruke «glemt passord» (som går til e-postadressen) i stedet.
  if (user.isActive) return fail("forbidden");

  // En invitasjonslenke gir mulighet til å sette nytt passord. For en
  // administrator er det derfor en full kontoovertakelse, og krever admin.
  if (user.role === "ADMIN" && !isAdminActor(actor)) return fail("forbidden");

  // Avdelingsansvarlige kan bare invitere brukere i egen avdeling.
  if (
    !isAdminActor(actor) &&
    (!actor.departmentId || user.departmentId !== actor.departmentId)
  ) {
    return fail("forbidden");
  }

  // En aktør kan ikke invitere en bruker som har rettigheter aktøren ikke har
  // selv – det ville latt aktøren ta over en konto med mer tilgang.
  if (!isAdminActor(actor)) {
    const actorPerms = assignedPermissions(actor);
    const targetPerms = assignedPermissions(user);
    for (const permission of targetPerms) {
      if (!actorPerms.has(permission)) return fail("forbidden");
    }
  }

  const token = await prisma.$transaction(async (tx) => {
    const created = await createInviteToken(id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: id,
      action: `Genererte ny invitasjonslenke for: ${user.name || user.email}`,
      actor: toAuditActor(actor),
    });
    return created;
  });
  const mailSent = await sendInviteEmail(
    user.email || "",
    user.name,
    buildInviteUrl(token),
  );

  return ok({ id, token, mailSent });
}

// ---------------------------------------------------------------------------
// Kundeportalbrukere
// ---------------------------------------------------------------------------

export type PortalUserResult = {
  id: string;
  customerId: string;
  token: string;
  mailSent: boolean;
};

/** Oppretter en kundeportalbruker koblet til en kontaktperson på kundekortet. */
export async function createPortalUser(
  actor: ServiceActor,
  input: {
    customerId?: unknown;
    name?: unknown;
    email?: unknown;
    contactId?: unknown;
  },
): Promise<ServiceResult<PortalUserResult>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const customerId = cleanText(input.customerId, { maxLength: LIMITS.line });
  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const email = cleanEmail(input.email);
  const contactId = cleanText(input.contactId, { maxLength: LIMITS.line });

  if (!customerId) return fail("invalid");
  if (!name || !email || !contactId) return fail("missing_fields");

  // Kontaktpersonen må faktisk tilhøre denne kunden.
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.customerId !== customerId) {
    return fail("invalid_contact");
  }

  let created: { id: string };
  let token = "";
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          role: "CUSTOMER",
          customerId,
          contactId: contact.id,
          isActive: false,
        },
      });
      token = await createInviteToken(user.id, tx);
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Opprettet kundeportalbruker: ${name} (${email})`,
        actor: toAuditActor(actor),
      });
      return user;
    });
  } catch (error) {
    console.error("Feil ved opprettelse av kundeportalbruker", error);
    return fail("duplicate_email");
  }

  const mailSent = await sendInviteEmail(email, name, buildInviteUrl(token));

  return ok({ id: created.id, customerId, token, mailSent });
}

/** Aktiverer eller deaktiverer en kundeportalbruker. */
export async function setPortalUserActive(
  actor: ServiceActor,
  input: { customerId?: unknown; id?: unknown; active?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const customerId = cleanText(input.customerId, { maxLength: LIMITS.line });
  const id = cleanText(input.id, { maxLength: LIMITS.line });
  const active = input.active === "true";
  if (!customerId || !id) return fail("invalid");

  const target = await prisma.user.findUnique({ where: { id } });
  if (
    !target ||
    target.role !== "CUSTOMER" ||
    target.customerId !== customerId
  ) {
    return fail("not_found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        isActive: active,
        ...(active ? {} : { sessionVersion: { increment: 1 } }),
      },
    });
    if (!active) await clearCalendarToken(id, tx);
    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `${active ? "Aktiverte" : "Deaktiverte"} kundeportalbruker: ${target.name || target.email}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

/** Lager en ny invitasjonslenke for en kundeportalbruker. */
export async function resendPortalInvite(
  actor: ServiceActor,
  input: { customerId?: unknown; id?: unknown },
): Promise<ServiceResult<PortalUserResult>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const customerId = cleanText(input.customerId, { maxLength: LIMITS.line });
  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!customerId || !id) return fail("invalid");

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CUSTOMER" || user.customerId !== customerId) {
    return fail("not_found");
  }
  // Samme regel som for interne brukere: en aktiv konto kan ikke få en ny
  // invitasjonslenke som lar noen sette passordet på nytt.
  if (user.isActive) return fail("forbidden");

  const token = await prisma.$transaction(async (tx) => {
    const created = await createInviteToken(id, tx);
    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `Sendte ny invitasjonslenke til kundeportalbruker: ${user.name || user.email}`,
      actor: toAuditActor(actor),
    });
    return created;
  });
  const mailSent = await sendInviteEmail(
    user.email || "",
    user.name,
    buildInviteUrl(token),
  );

  return ok({ id, customerId, token, mailSent });
}
