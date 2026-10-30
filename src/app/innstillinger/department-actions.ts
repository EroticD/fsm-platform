"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { actorName, requireAdmin } from "@/lib/session";
import { LIMITS, cleanEmail, cleanPhone, cleanText } from "@/lib/sanitize";

function revalidateDepartments() {
  revalidatePath("/innstillinger");
  revalidatePath("/brukere");
  revalidatePath("/oppdrag");
}

export async function createDepartment(formData: FormData) {
  if (!(await requireAdmin())) return;

  const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
  const description = cleanText(formData.get("description"), { maxLength: LIMITS.line });
  const phone = cleanPhone(formData.get("phone"));
  const email = cleanEmail(formData.get("email"));
  const address = cleanText(formData.get("address"), { maxLength: LIMITS.line });
  const city = cleanText(formData.get("city"), { maxLength: LIMITS.short });
  const postalCode = cleanText(formData.get("postalCode"), { maxLength: 20 });
  const trackingEnabled = formData.get("trackingEnabled") === "on";
  if (!name) return;

  try {
    const department = await prisma.department.create({
      data: {
        name,
        description: description || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        city: city || null,
        postalCode: postalCode || null,
        trackingEnabled,
      },
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
  const phone = cleanPhone(formData.get("phone"));
  const email = cleanEmail(formData.get("email"));
  const address = cleanText(formData.get("address"), { maxLength: LIMITS.line });
  const city = cleanText(formData.get("city"), { maxLength: LIMITS.short });
  const postalCode = cleanText(formData.get("postalCode"), { maxLength: 20 });
  const trackingEnabled = formData.get("trackingEnabled") === "on";
  if (!id || !name) return;

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) return;

  try {
    await prisma.department.update({
      where: { id },
      data: {
        name,
        description: description || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        city: city || null,
        postalCode: postalCode || null,
        trackingEnabled,
      },
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

  const actor = await actorName();

  await prisma.$transaction(async (tx) => {
    await tx.department.update({ where: { id }, data: { isActive: active } });

    // Deaktivering skal faktisk stoppe operativ tilgang. Oppdrags- og
    // montørspørringene krever en aktiv avdeling, og eksisterende økter
    // ugyldiggjøres slik at en åpen fane ikke fortsetter med gammel tilstand.
    // Kontoene beholdes, slik at avdelingen kan aktiveres igjen senere.
    let deactivatedUsers = 0;
    if (!active) {
      const result = await tx.user.updateMany({
        where: { departmentId: id },
        data: {
          sessionVersion: { increment: 1 },
          calendarTokenHash: null,
          calendarTokenCreatedAt: null,
          calendarTokenLastUsedAt: null,
        },
      });
      deactivatedUsers = result.count;
    }

    await tx.auditLog.create({
      data: {
        entityType: "Department",
        entityId: id,
        action: `${active ? "Aktiverte" : "Deaktiverte"} avdeling: ${department.name}`,
        userName: actor,
        metadata: active ? undefined : { deactivatedUsers },
      },
    });
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
