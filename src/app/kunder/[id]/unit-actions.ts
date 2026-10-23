"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { getCurrentUser, requireAdmin, requirePermission } from "@/lib/session";
import { unitCreateSchema, unitUpdateSchema } from "@/lib/schemas/unit";

const auditActor = (user?: {
  id: string;
  name: string | null;
  email: string | null;
} | null) => ({
  id: user?.id ?? "",
  name: user?.name ?? null,
  email: user?.email ?? null,
});

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
  const actor = await getCurrentUser();
  if (!actor) return;

  const rawCustomerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const parsed = unitCreateSchema.safeParse({
    customerId: rawCustomerId,
    model: cleanText(formData.get("model"), { maxLength: LIMITS.title }),
    serialNumber: cleanText(formData.get("serialNumber"), { maxLength: LIMITS.line }),
    location: cleanText(formData.get("location"), { maxLength: LIMITS.line }),
  });
  if (!parsed.success) {
    redirect(
      rawCustomerId
        ? `/kunder/${rawCustomerId}?tab=enheter&error=ugyldig-data`
        : "/kunder?error=ugyldig-data",
    );
  }
  const { customerId, model, serialNumber, location } = parsed.data;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return;

  await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        customerId,
        model,
        serialNumber: serialNumber || null,
        location: location || null,
      },
    });

    // Enheten er en del av kundekortet, så hendelsen følger kundens id.
    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `La til enhet: ${model}${serialNumber ? ` (SN: ${serialNumber})` : ""}`,
      actor: auditActor(actor),
      metadata: { productId: product.id },
    });
  });

  revalidatePath(`/kunder/${customerId}`);
}

/** Oppdaterer navn, serienummer og plassering på en enhet. */
export async function updateUnit(formData: FormData) {
  if (!(await requirePermission("equipment.manage"))) return;
  const actor = await getCurrentUser();
  if (!actor) return;

  const rawCustomerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const parsed = unitUpdateSchema.safeParse({
    customerId: rawCustomerId,
    id: cleanText(formData.get("id"), { maxLength: LIMITS.line }),
    model: cleanText(formData.get("model"), { maxLength: LIMITS.title }),
    serialNumber: cleanText(formData.get("serialNumber"), { maxLength: LIMITS.line }),
    location: cleanText(formData.get("location"), { maxLength: LIMITS.line }),
  });
  if (!parsed.success) {
    redirect(
      rawCustomerId
        ? `/kunder/${rawCustomerId}?tab=enheter&error=ugyldig-data`
        : "/kunder?error=ugyldig-data",
    );
  }
  const { customerId, id, model, serialNumber, location } = parsed.data;

  const unit = await findUnitForCustomer(id, customerId);
  if (!unit) return;

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: {
        model,
        serialNumber: serialNumber || null,
        location: location || null,
      },
    });

    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `Oppdaterte enhet: ${model}${serialNumber ? ` (SN: ${serialNumber})` : ""}`,
      actor: auditActor(actor),
      metadata: { productId: id },
    });
  });

  revalidatePath(`/kunder/${customerId}`);
}

/**
 * Sletter en enhet. Rapporter som allerede er skrevet beholder sitt eget
 * øyeblikksbilde av enheten, så servicehistorikken blir stående.
 */
export async function deleteUnit(formData: FormData) {
  if (!(await requireAdmin())) return;
  const actor = await getCurrentUser();
  if (!actor) return;

  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });

  const unit = await findUnitForCustomer(id, customerId);
  if (!unit) return;

  await prisma.$transaction(async (tx) => {
    await tx.product.delete({ where: { id } });
    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `Slettet enhet: ${unit.model}${unit.serialNumber ? ` (SN: ${unit.serialNumber})` : ""}`,
      actor: auditActor(actor),
      metadata: { productId: id },
    });
  });

  revalidatePath(`/kunder/${customerId}`);
}
