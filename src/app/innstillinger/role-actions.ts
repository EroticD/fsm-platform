"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import {
  audit,
  auditRequestContext,
  auditStandalone,
  type AuditActor,
} from "@/lib/audit";
import { getCurrentUser, requireAdmin } from "@/lib/session";
import { cleanPermissions } from "@/lib/permissions";
import { LIMITS, cleanText } from "@/lib/sanitize";

const ROLES_PATH = "/innstillinger?tab=roller";

function roleError(code: string): never {
  redirect(`${ROLES_PATH}&error=${encodeURIComponent(code)}`);
}

function revalidateRoles() {
  revalidatePath("/innstillinger");
  revalidatePath("/brukere");
  revalidatePath("/", "layout");
}

/**
 * Aktøren slik revisjonsloggen trenger den. `getCurrentUser` er cachet per
 * forespørsel, så dette gir ikke et ekstra brukeroppslag.
 */
async function currentAuditActor(): Promise<AuditActor> {
  const user = await getCurrentUser();
  return {
    id: user?.id ?? "",
    name: user?.name ?? null,
    email: user?.email ?? null,
    departmentId: user?.departmentId ?? null,
  };
}

/** Rettigheter som ble lagt til og fjernet, sortert for lesbar diff. */
function permissionDiff(before: readonly string[], after: readonly string[]) {
  const from = new Set(before);
  const to = new Set(after);
  return {
    permissionsAdded: after.filter((permission) => !from.has(permission)).sort(),
    permissionsRemoved: before.filter((permission) => !to.has(permission)).sort(),
  };
}

/** Lager en stabil nøkkel fra visningsnavnet. Nøkkelen endres ikke senere. */
function roleKeyFromLabel(label: string): string {
  return (
    label
      .replace(/[æÆ]/g, "ae")
      .replace(/[øØ]/g, "o")
      .replace(/[åÅ]/g, "a")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "ROLLE"
  );
}

async function uniqueRoleKey(label: string): Promise<string> {
  const base = roleKeyFromLabel(label);
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const key = suffix === 1 ? base : `${base}_${suffix}`;
    const existing = await prisma.role.findUnique({
      where: { key },
      select: { key: true },
    });
    if (!existing) return key;
  }
  return `${base}_${Date.now()}`;
}

function submittedPermissions(formData: FormData) {
  return cleanPermissions(
    formData.getAll("permissions").map((value) => String(value)),
  );
}

export async function createRole(formData: FormData) {
  if (!(await requireAdmin())) return;

  const label = cleanText(formData.get("label"), { maxLength: LIMITS.title });
  const description = cleanText(formData.get("description"), {
    maxLength: LIMITS.line,
  });
  if (!label) roleError("mangler_navn");

  const key = await uniqueRoleKey(label);
  const permissions = submittedPermissions(formData);
  const actor = await currentAuditActor();
  const context = await auditRequestContext();

  // Rollen og revisjonsraden skrives i samme transaksjon. Da kan ikke en
  // opprettet rolle stå uten logg, eller en logg føres for en rolle som
  // transaksjonen likevel ruller tilbake.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.role.create({
        data: {
          key,
          label,
          description: description || null,
          permissions,
          isSystem: false,
        },
      });

      await audit(tx, {
        entityType: "Role",
        entityId: key,
        action: `Opprettet rolle: ${label} (${permissions.length} rettigheter)`,
        actionCode: "role.created",
        retentionClass: "SECURITY_1Y",
        actor,
        departmentId: actor.departmentId ?? null,
        context,
        metadata: {
          key,
          label,
          description: description || null,
          permissions,
        },
      });
    });
  } catch (error) {
    console.error("Kunne ikke opprette rolle", error);
    roleError("rollen_finnes");
  }

  revalidateRoles();
  redirect(`${ROLES_PATH}&role=created`);
}

export async function updateRole(formData: FormData) {
  if (!(await requireAdmin())) return;

  const key = cleanText(formData.get("key"), { maxLength: LIMITS.short });
  const label = cleanText(formData.get("label"), { maxLength: LIMITS.title });
  const description = cleanText(formData.get("description"), {
    maxLength: LIMITS.line,
  });
  if (!key || !label) roleError("mangler_navn");

  const existing = await prisma.role.findUnique({ where: { key } });
  if (!existing) roleError("ukjent_rolle");

  // Administrator har alltid alle rettigheter, og kundeportalen styres av
  // kundetilknytningen. Rettighetslisten deres skal derfor ikke kunne endres.
  const permissions =
    key === "ADMIN" || key === "CUSTOMER"
      ? existing.permissions
      : submittedPermissions(formData);

  const actor = await currentAuditActor();
  const context = await auditRequestContext();
  const diff = permissionDiff(existing.permissions, permissions);

  // Oppdateringen og loggen deler transaksjon, slik at rettighetsendringen og
  // revisjonsraden alltid beskriver samme tilstand.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { key },
        data: {
          label,
          description: description || null,
          permissions,
        },
      });
      // En rettighetsendring skal også ugyldiggjøre eksisterende
      // kalenderabonnementer for rollen.
      await tx.user.updateMany({
        where: { role: key },
        data: {
          calendarTokenHash: null,
          calendarTokenCreatedAt: null,
          calendarTokenLastUsedAt: null,
        },
      });

      await audit(tx, {
        entityType: "Role",
        entityId: key,
        action: `Oppdaterte rolle: ${existing.label} → ${label} (${permissions.length} rettigheter)`,
        actionCode: "role.updated",
        retentionClass: "SECURITY_1Y",
        actor,
        departmentId: actor.departmentId ?? null,
        context,
        // Før/etter for rettighetene, slik at en sikkerhetsrevisjon kan se
        // nøyaktig hva rollen fikk og mistet uten å sammenligne to rader.
        metadata: {
          key,
          labelFrom: existing.label,
          labelTo: label,
          descriptionFrom: existing.description ?? null,
          descriptionTo: description || null,
          permissionsFrom: existing.permissions,
          permissionsTo: permissions,
          ...diff,
        },
      });
    });
  } catch (error) {
    console.error("Kunne ikke oppdatere rolle", error);
    roleError("rollen_finnes");
  }

  revalidateRoles();
  redirect(`${ROLES_PATH}&role=updated`);
}

export async function deleteRole(formData: FormData) {
  if (!(await requireAdmin())) return;

  const key = cleanText(formData.get("key"), { maxLength: LIMITS.short });
  if (!key) return;

  const role = await prisma.role.findUnique({ where: { key } });
  if (!role) return;

  const actor = await currentAuditActor();
  const context = await auditRequestContext();

  // Avviste slettinger er også hendelser. De skrives i egen transaksjon fordi
  // det ikke finnes noen forretningsendring å binde dem til.
  if (role.isSystem) {
    await auditStandalone({
      entityType: "Role",
      entityId: key,
      action: `Avviste sletting av systemrollen: ${role.label}`,
      actionCode: "role.deleted",
      outcome: "DENIED",
      retentionClass: "SECURITY_1Y",
      actor,
      departmentId: actor.departmentId ?? null,
      context,
      metadata: { key, label: role.label, reason: "systemrolle" },
    });
    roleError("systemrolle");
  }

  const users = await prisma.user.count({ where: { role: key } });
  if (users > 0) {
    await auditStandalone({
      entityType: "Role",
      entityId: key,
      action: `Avviste sletting av rollen «${role.label}» fordi ${users} brukere har den`,
      actionCode: "role.deleted",
      outcome: "DENIED",
      retentionClass: "SECURITY_1Y",
      actor,
      departmentId: actor.departmentId ?? null,
      context,
      metadata: { key, label: role.label, reason: "rolle_i_bruk", usersInRole: users },
    });
    roleError("rolle_i_bruk");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { key } });
      await audit(tx, {
        entityType: "Role",
        entityId: key,
        action: `Slettet rolle: ${role.label}`,
        actionCode: "role.deleted",
        retentionClass: "SECURITY_1Y",
        actor,
        departmentId: actor.departmentId ?? null,
        context,
        metadata: {
          key,
          label: role.label,
          description: role.description ?? null,
          permissions: role.permissions,
        },
      });
    });
  } catch (error) {
    console.error("Kunne ikke slette rolle", error);
    roleError("rolle_i_bruk");
  }

  revalidateRoles();
  redirect(`${ROLES_PATH}&role=deleted`);
}
