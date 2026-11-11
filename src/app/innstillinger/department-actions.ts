"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import {
  audit,
  auditRequestContext,
  auditStandalone,
  type AuditActor,
} from "@/lib/audit";
import { getCurrentUser, requireAdmin } from "@/lib/session";
import { LIMITS, cleanEmail, cleanPhone, cleanText } from "@/lib/sanitize";

function revalidateDepartments() {
  revalidatePath("/innstillinger");
  revalidatePath("/brukere");
  revalidatePath("/oppdrag");
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

type FieldValue = string | boolean | null;

/** Før/etter for feltene som faktisk endret seg. */
function buildChanges(
  before: Record<string, FieldValue>,
  after: Record<string, FieldValue>,
): Record<string, { from: FieldValue; to: FieldValue }> {
  const changes: Record<string, { from: FieldValue; to: FieldValue }> = {};
  for (const field of Object.keys(after)) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
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

  const actor = await currentAuditActor();
  const context = await auditRequestContext();

  // Avdelingen og revisjonsraden skrives i samme transaksjon, slik at en
  // opprettet avdeling alltid har en loggført opprinnelse.
  try {
    await prisma.$transaction(async (tx) => {
      const department = await tx.department.create({
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
      await audit(tx, {
        entityType: "Department",
        entityId: department.id,
        action: `Opprettet avdeling: ${name}`,
        actionCode: "department.created",
        actor,
        // Hendelsen gjelder avdelingen selv, ikke aktørens egen avdeling.
        departmentId: department.id,
        context,
        metadata: {
          name,
          trackingEnabled,
        },
      });
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

  const actor = await currentAuditActor();
  const context = await auditRequestContext();

  const changes = buildChanges(
    {
      name: existing.name,
      description: existing.description ?? null,
      phone: existing.phone ?? null,
      email: existing.email ?? null,
      address: existing.address ?? null,
      city: existing.city ?? null,
      postalCode: existing.postalCode ?? null,
      trackingEnabled: existing.trackingEnabled,
    },
    {
      name,
      description: description || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      city: city || null,
      postalCode: postalCode || null,
      trackingEnabled,
    },
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.department.update({
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
      await audit(tx, {
        entityType: "Department",
        entityId: id,
        action: `Oppdaterte avdeling: ${existing.name} → ${name}`,
        actionCode: "department.updated",
        actor,
        departmentId: id,
        context,
        // Feltene som endret seg, med før/etter. Sporing av montør er et
        // personvernvalg, så den vises alltid – også når den ikke endres.
        metadata: {
          changes,
          trackingEnabled: {
            from: existing.trackingEnabled,
            to: trackingEnabled,
          },
        },
      });
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

  const actor = await currentAuditActor();
  const context = await auditRequestContext();

  // Standardavdelingen kan ikke deaktiveres uten at en annen er valgt først.
  // Det avviste forsøket logges, så det er synlig hvem som prøvde.
  if (!active && department.isDefault) {
    await auditStandalone({
      entityType: "Department",
      entityId: id,
      action: `Avviste deaktivering av standardavdelingen: ${department.name}`,
      actionCode: "department.updated",
      outcome: "DENIED",
      actor,
      departmentId: id,
      context,
      metadata: { reason: "standardavdeling", isActive: { from: true, to: false } },
    });
    return;
  }

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

    await audit(tx, {
      entityType: "Department",
      entityId: id,
      action: `${active ? "Aktiverte" : "Deaktiverte"} avdeling: ${department.name}`,
      actionCode: "department.updated",
      actor,
      departmentId: id,
      context,
      metadata: {
        isActive: { from: department.isActive, to: active },
        ...(active ? {} : { deactivatedUsers }),
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

  const actor = await currentAuditActor();
  const context = await auditRequestContext();

  // Standardavdelingen og loggen byttes i samme transaksjon, så det aldri
  // finnes en periode uten loggført standardavdeling.
  await prisma.$transaction(async (tx) => {
    const previous = await tx.department.findFirst({
      where: { isDefault: true, id: { not: id } },
      select: { id: true, name: true },
    });

    await tx.department.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
    await tx.department.update({
      where: { id },
      data: { isDefault: true, isActive: true },
    });

    await audit(tx, {
      entityType: "Department",
      entityId: id,
      action: `Satte ${department.name} som standardavdeling`,
      actionCode: "department.default_changed",
      actor,
      departmentId: id,
      context,
      metadata: {
        name: department.name,
        previousDefaultId: previous?.id ?? null,
        previousDefaultName: previous?.name ?? null,
      },
    });
  });
  revalidateDepartments();
}
