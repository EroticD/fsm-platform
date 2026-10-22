"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { actorName, requireAdmin, requirePermission } from "@/lib/session";

/** Kort hjelper: henter enheten og sjekker at den faktisk tilhører kunden. */
async function findUnitForCustomer(id: string, customerId: string) {
  if (!id || !customerId) return null;
  const unit = await prisma.product.findUnique({ where: { id } });
  if (!unit || unit.customerId !== customerId) return null;
  return unit;
}

/** Registrerer en ny enhet (maskin/utstyr) på kunden. */
export async function createUnit(formData: FormData) {
  if (!(await requirePermission("equipment.manage"))) return;
  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const model = cleanText(formData.get("model"), { maxLength: LIMITS.title });
  const serialNumber = cleanText(formData.get("serialNumber"), { maxLength: LIMITS.line }) || null;
  const location = cleanText(formData.get("location"), { maxLength: LIMITS.line }) || null;

  if (!customerId || !model) return;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return;

  await prisma.product.create({
    data: { customerId, model, serialNumber, location },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customerId,
      action: `La til enhet: ${model}${serialNumber ? ` (SN: ${serialNumber})` : ""}`,
      userName: await actorName(),
    },
  });

  revalidatePath(`/kunder/${customerId}`);
}

/** Oppdaterer navn, serienummer og plassering på en enhet. */
export async function updateUnit(formData: FormData) {
  if (!(await requirePermission("equipment.manage"))) return;
  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const model = cleanText(formData.get("model"), { maxLength: LIMITS.title });
  const serialNumber = cleanText(formData.get("serialNumber"), { maxLength: LIMITS.line }) || null;
  const location = cleanText(formData.get("location"), { maxLength: LIMITS.line }) || null;

  if (!model) return;

  const unit = await findUnitForCustomer(id, customerId);
  if (!unit) return;

  await prisma.product.update({
    where: { id },
    data: { model, serialNumber, location },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customerId,
      action: `Oppdaterte enhet: ${model}${serialNumber ? ` (SN: ${serialNumber})` : ""}`,
      userName: await actorName(),
    },
  });

  revalidatePath(`/kunder/${customerId}`);
}

/**
 * Sletter en enhet. Rapporter som allerede er skrevet beholder sitt eget
 * øyeblikksbilde av enheten, så servicehistorikken blir stående.
 */
export async function deleteUnit(formData: FormData) {
  if (!(await requireAdmin())) return;
  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });

  const unit = await findUnitForCustomer(id, customerId);
  if (!unit) return;

  await prisma.product.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customerId,
      action: `Slettet enhet: ${unit.model}${unit.serialNumber ? ` (SN: ${unit.serialNumber})` : ""}`,
      userName: await actorName(),
    },
  });

  revalidatePath(`/kunder/${customerId}`);
}
