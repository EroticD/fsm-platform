import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import type { Permission } from "@/lib/permissions";
import {
  materialIdSchema,
  materialSchema,
  materialUpdateSchema,
} from "@/lib/schemas/material";
import {
  can,
  fail,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

const MATERIAL_SELECT = {
  id: true,
  workOrderId: true,
  name: true,
  sku: true,
  quantity: true,
  unit: true,
  unitPrice: true,
  createdAt: true,
} as const;

async function requireWorkOrder(
  actor: ServiceActor,
  workOrderId: string,
  permission: Permission,
) {
  if (!actor.isActive || !can(actor, permission)) return null;
  return prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScopeFor(actor) },
    select: { id: true },
  });
}

function idFrom(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

export async function listMaterials(
  actor: ServiceActor,
  workOrderId: unknown,
): Promise<ServiceResult<unknown[]>> {
  const id = idFrom(workOrderId);
  if (!id) return fail("invalid");
  if (!(await requireWorkOrder(actor, id, "workorders.view"))) {
    return fail("forbidden");
  }

  const materials = await prisma.material.findMany({
    where: { workOrderId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: MATERIAL_SELECT,
  });
  return ok(materials);
}

export async function addMaterial(
  actor: ServiceActor,
  input: Record<string, unknown>,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");

  if (!(await requireWorkOrder(actor, parsed.data.workOrderId, "workorders.update"))) {
    return fail("forbidden");
  }

  const created = await prisma.$transaction(async (tx) => {
    const material = await tx.material.create({
      data: {
        workOrderId: parsed.data.workOrderId,
        name: parsed.data.name,
        sku: parsed.data.sku ?? null,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit,
        unitPrice: parsed.data.unitPrice,
      },
      select: { id: true },
    });

    await audit(tx, {
      entityType: "Material",
      entityId: material.id,
      action: "La til materiale",
      actor: toAuditActor(actor),
      metadata: {
        workOrderId: parsed.data.workOrderId,
        name: parsed.data.name,
        quantity: parsed.data.quantity,
      },
    });
    return material;
  });

  return ok({ id: created.id });
}

export async function updateMaterial(
  actor: ServiceActor,
  input: Record<string, unknown>,
): Promise<ServiceResult> {
  const parsed = materialUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("invalid");

  const material = await prisma.material.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, workOrderId: true },
  });
  if (!material) return fail("not_found");
  if (!(await requireWorkOrder(actor, material.workOrderId, "workorders.update"))) {
    return fail("forbidden");
  }

  await prisma.$transaction(async (tx) => {
    await tx.material.update({
      where: { id: material.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku ?? null } : {}),
        ...(parsed.data.quantity !== undefined
          ? { quantity: parsed.data.quantity }
          : {}),
        ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit } : {}),
        ...(parsed.data.unitPrice !== undefined
          ? { unitPrice: parsed.data.unitPrice }
          : {}),
      },
    });
    await audit(tx, {
      entityType: "Material",
      entityId: material.id,
      action: "Oppdaterte materiale",
      actor: toAuditActor(actor),
      metadata: { workOrderId: material.workOrderId },
    });
  });

  return ok(undefined);
}

export async function deleteMaterial(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  const parsed = materialIdSchema.safeParse({ id: idFrom(input.id) });
  if (!parsed.success) return fail("invalid");

  const material = await prisma.material.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, workOrderId: true },
  });
  if (!material) return fail("not_found");
  if (!(await requireWorkOrder(actor, material.workOrderId, "workorders.edit"))) {
    return fail("forbidden");
  }

  await prisma.$transaction(async (tx) => {
    await tx.material.delete({ where: { id: material.id } });
    await audit(tx, {
      entityType: "Material",
      entityId: material.id,
      action: "Slettet materiale",
      actor: toAuditActor(actor),
      metadata: { workOrderId: material.workOrderId },
    });
  });

  return ok(undefined);
}

export async function getMaterialTotals(
  actor: ServiceActor,
  workOrderId: unknown,
): Promise<ServiceResult<{ count: number; quantity: number; amount: number }>> {
  const id = idFrom(workOrderId);
  if (!id) return fail("invalid");
  if (!(await requireWorkOrder(actor, id, "workorders.view"))) {
    return fail("forbidden");
  }

  const materials = await prisma.material.findMany({
    where: { workOrderId: id },
    select: { quantity: true, unitPrice: true },
    take: 2000,
  });

  let quantity = 0;
  let amount = 0;
  for (const material of materials) {
    const qty = Number(material.quantity);
    quantity += qty;
    amount += qty * Number(material.unitPrice);
  }

  return ok({
    count: materials.length,
    quantity: Math.round(quantity * 100) / 100,
    amount: Math.round(amount * 100) / 100,
  });
}
