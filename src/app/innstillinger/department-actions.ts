"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { actorName, requireAdmin } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";

function revalidateDepartments() {
  revalidatePath("/innstillinger");
  revalidatePath("/brukere");
  revalidatePath("/oppdrag");
}

export async function createDepartment(formData: FormData) {
  if (!(await requireAdmin())) return;

  const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
  const description = cleanText(formData.get("description"), { maxLength: LIMITS.line });
  if (!name) return;

  try {
    const department = await prisma.department.create({
      data: { name, description: description || null },
    });
    await prisma.auditLog.create({
      data: {
        entityType: "Department",
        entityId: department.id,
        action: `Opprettet avdeling: ${name}`,
        userName: await actorName(),
      },
    });
  } catch (error) {
    console.error("Kunne ikke opprette avdeling", error);
  }
  revalidateDepartments();
}

export async function updateDepartment(formData: FormData) {
  if (!(await requireAdmin())) return;

  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
  const description = cleanText(formData.get("description"), { maxLength: LIMITS.line });
  if (!id || !name) return;

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) return;

  try {
    await prisma.department.update({
      where: { id },
      data: { name, description: description || null },
    });
    await prisma.auditLog.create({
      data: {
        entityType: "Department",
        entityId: id,
        action: `Oppdaterte avdeling: ${existing.name} → ${name}`,
        userName: await actorName(),
      },
    });
  } catch (error) {
    console.error("Kunne ikke oppdatere avdeling", error);
  }
  revalidateDepartments();
}

export async function toggleDepartment(formData: FormData) {
  if (!(await requireAdmin())) return;

  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const active = formData.get("active") === "true";
  if (!id) return;

  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) return;

  // Standardavdelingen kan ikke deaktiveres uten at en annen er valgt først.
  if (!active && department.isDefault) return;

  await prisma.department.update({ where: { id }, data: { isActive: active } });
  await prisma.auditLog.create({
    data: {
      entityType: "Department",
      entityId: id,
      action: `${active ? "Aktiverte" : "Deaktiverte"} avdeling: ${department.name}`,
      userName: await actorName(),
    },
  });
  revalidateDepartments();
}

export async function setDefaultDepartment(formData: FormData) {
  if (!(await requireAdmin())) return;

  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  if (!id) return;

  const department = await prisma.department.findUnique({ where: { id } });
  if (!department || !department.isActive) return;

  await prisma.$transaction([
    prisma.department.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    }),
    prisma.department.update({
      where: { id },
      data: { isDefault: true, isActive: true },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      entityType: "Department",
      entityId: id,
      action: `Satte ${department.name} som standardavdeling`,
      userName: await actorName(),
    },
  });
  revalidateDepartments();
}
