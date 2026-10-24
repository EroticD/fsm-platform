"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { actorName, requireAdmin } from "@/lib/session";
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

  try {
    await prisma.role.create({
      data: {
        key,
        label,
        description: description || null,
        permissions,
        isSystem: false,
      },
    });
  } catch (error) {
    console.error("Kunne ikke opprette rolle", error);
    roleError("rollen_finnes");
  }

  await prisma.auditLog.create({
    data: {
      entityType: "Role",
      entityId: key,
      action: `Opprettet rolle: ${label} (${permissions.length} rettigheter)`,
      userName: await actorName(),
    },
  });

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

  try {
    await prisma.$transaction([
      prisma.role.update({
        where: { key },
        data: {
          label,
          description: description || null,
          permissions,
        },
      }),
      // En rettighetsendring skal også ugyldiggjøre eksisterende
      // kalenderabonnementer for rollen.
      prisma.user.updateMany({
        where: { role: key },
        data: {
          calendarTokenHash: null,
          calendarTokenCreatedAt: null,
          calendarTokenLastUsedAt: null,
        },
      }),
    ]);
  } catch (error) {
    console.error("Kunne ikke oppdatere rolle", error);
    roleError("rollen_finnes");
  }

  await prisma.auditLog.create({
    data: {
      entityType: "Role",
      entityId: key,
      action: `Oppdaterte rolle: ${existing.label} → ${label} (${permissions.length} rettigheter)`,
      userName: await actorName(),
    },
  });

  revalidateRoles();
  redirect(`${ROLES_PATH}&role=updated`);
}

export async function deleteRole(formData: FormData) {
  if (!(await requireAdmin())) return;

  const key = cleanText(formData.get("key"), { maxLength: LIMITS.short });
  if (!key) return;

  const role = await prisma.role.findUnique({ where: { key } });
  if (!role) return;
  if (role.isSystem) roleError("systemrolle");

  const users = await prisma.user.count({ where: { role: key } });
  if (users > 0) roleError("rolle_i_bruk");

  try {
    await prisma.role.delete({ where: { key } });
  } catch (error) {
    console.error("Kunne ikke slette rolle", error);
    roleError("rolle_i_bruk");
  }

  await prisma.auditLog.create({
    data: {
      entityType: "Role",
      entityId: key,
      action: `Slettet rolle: ${role.label}`,
      userName: await actorName(),
    },
  });

  revalidateRoles();
  redirect(`${ROLES_PATH}&role=deleted`);
}
