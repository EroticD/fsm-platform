"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { actorName } from "@/lib/session";

/** Kort hjelper: henter enheten og sjekker at den faktisk tilhører kunden. */
async function findUnitForCustomer(id: string, customerId: string) {
  if (!id || !customerId) return null;
  const unit = await prisma.product.findUnique({ where: { id } });
  if (!unit || unit.customerId !== customerId) return null;
  return unit;
}

/** Registrerer en ny enhet (maskin/utstyr) på kunden. */
export async function createUnit(formData: FormData) {
  const customerId = formData.get("customerId") as string;
  const model = (formData.get("model") as string)?.trim();
  const serialNumber = (formData.get("serialNumber") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;

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
  const customerId = formData.get("customerId") as string;
  const id = formData.get("id") as string;
  const model = (formData.get("model") as string)?.trim();
  const serialNumber = (formData.get("serialNumber") as string)?.trim() || null;
  const location = (formData.get("location") as string)?.trim() || null;

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
  const customerId = formData.get("customerId") as string;
  const id = formData.get("id") as string;

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
