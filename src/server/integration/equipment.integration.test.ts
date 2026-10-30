import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { addDaysUtc, todayUtc, toDateOnly } from "@/lib/dates";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import {
  addMeterReading,
  createEquipment,
  resolveEquipmentQrToken,
  rotateEquipmentQrToken,
  updateEquipment,
} from "@/server/equipment";
import {
  createMaintenancePlan,
  generateDueMaintenanceWorkOrders,
} from "@/server/maintenance";
import { notifyWarrantyExpiring } from "@/server/equipment";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("Utstyr og vedlikehold", () => {
  let departmentId = "";
  let customerId = "";
  let userId = "";
  let actor: ServiceActor;

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-utstyr-avdeling") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-utstyr-kunde"), departmentId },
    });
    customerId = customer.id;

    const user = await prisma.user.create({
      data: {
        name: "IT Utstyr",
        email: `${unique("it-utstyr")}@example.test`,
        role: "OFFICE",
        isActive: true,
        departmentId,
        permissionsCustomized: true,
        permissions: ["equipment.view", "equipment.manage"],
      },
    });
    userId = user.id;

    actor = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: "OFFICE",
      isActive: true,
      departmentId,
      permissionsCustomized: true,
      permissions: ["equipment.view", "equipment.manage"],
      roleDefinition: null,
    };
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { OR: [{ userId }, { dedupeKey: { contains: "warranty:" } }] },
    });
    await prisma.workOrder.deleteMany({ where: { customerId } });
    await prisma.maintenancePlan.deleteMany({ where: { customerId } });
    await prisma.product.deleteMany({ where: { customerId } });
    await prisma.equipmentCategory.deleteMany({
      where: { name: { startsWith: "IT-utstyr" } },
    });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  async function cleanupProduct(id: string) {
    await prisma.notification.deleteMany({
      where: { dedupeKey: { contains: id } },
    });
    await prisma.workOrder.deleteMany({ where: { productId: id } });
    await prisma.maintenancePlan.deleteMany({ where: { productId: id } });
    await prisma.product.deleteMany({ where: { id } });
  }

  async function createProduct(model: string) {
    return prisma.product.create({
      data: {
        customerId,
        model,
        serialNumber: unique("SN"),
        qrToken: randomUUID().replace(/-/g, ""),
        status: "ACTIVE",
        criticality: 2,
        meterUnit: "timer",
      },
    });
  }

  it("avviser hierarkisyklus i tjenestelaget", async () => {
    const root = await createProduct("Bygg A");
    const child = await createProduct("System 1");

    await expect(updateEquipment(actor, { id: child.id, parentId: root.id })).resolves.toMatchObject({
      ok: true,
    });

    const result = await updateEquipment(actor, {
      id: root.id,
      parentId: child.id,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.hierarchyCycle" },
    });

    const unchanged = await prisma.product.findUnique({
      where: { id: root.id },
      select: { parentId: true },
    });
    expect(unchanged?.parentId).toBeNull();

    await cleanupProduct(child.id);
    await cleanupProduct(root.id);
  });

  it("roterer QR-token slik at den gamle etiketten ikke lenger virker", async () => {
    const created = await createEquipment(actor, {
      customerId,
      model: "QR-pumpe",
      meterUnit: "timer",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: created.data.id },
      select: { qrToken: true },
    });
    expect(product.qrToken).toBeTruthy();
    const oldToken = product.qrToken!;
    expect(await resolveEquipmentQrToken(oldToken)).toMatchObject({
      id: created.data.id,
    });

    const rotated = await rotateEquipmentQrToken(actor, created.data.id);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    expect(await resolveEquipmentQrToken(oldToken)).toBeNull();
    expect(await resolveEquipmentQrToken(rotated.data.qrToken)).toMatchObject({
      id: created.data.id,
    });

    await cleanupProduct(created.data.id);
  });

  it("lager nøyaktig ett oppdrag når to målinger passerer samme terskel", async () => {
    const product = await createProduct("Målerpumpe");
    const plan = await createMaintenancePlan(actor, {
      title: "Service hver 100. time",
      trigger: "METER",
      productId: product.id,
      customerId,
      departmentId,
      meterInterval: 100,
      leadDays: 14,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // Første måling setter utgangspunktet.
    const baseline = await addMeterReading(actor, product.id, {
      value: 1000,
      readAt: toDateOnly(todayUtc()),
      source: "MANUAL",
    });
    expect(baseline.ok).toBe(true);

    const [first, second] = await Promise.all([
      addMeterReading(actor, product.id, {
        value: 1100,
        readAt: toDateOnly(todayUtc()),
        source: "MANUAL",
      }),
      addMeterReading(actor, product.id, {
        value: 1105,
        readAt: toDateOnly(todayUtc()),
        source: "MANUAL",
      }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const occurrences = await prisma.maintenancePlanOccurrence.findMany({
      where: { planId: plan.data.id },
      select: { workOrderId: true },
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].workOrderId).toBeTruthy();

    const orders = await prisma.workOrder.findMany({
      where: { productId: product.id },
      select: { id: true, scheduledFor: true },
    });
    expect(orders).toHaveLength(1);
    expect(toDateOnly(orders[0].scheduledFor)).toBe(toDateOnly(todayUtc()));

    await cleanupProduct(product.id);
  });

  it("genererer kalenderforekomst idempotent under samtidige kjøringer", async () => {
    const product = await createProduct("Kalenderpumpe");
    const due = addDaysUtc(todayUtc(), 3);
    const plan = await createMaintenancePlan(actor, {
      title: "Årlig kalenderservice",
      trigger: "CALENDAR",
      productId: product.id,
      customerId,
      departmentId,
      intervalMonths: 12,
      leadDays: 14,
      nextDueDate: toDateOnly(due),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const [first, second] = await Promise.all([
      generateDueMaintenanceWorkOrders(),
      generateDueMaintenanceWorkOrders(),
    ]);

    const generated = [...first, ...second].filter(
      (result) => result.workOrderId,
    );
    expect(generated).toHaveLength(1);

    const occurrences = await prisma.maintenancePlanOccurrence.findMany({
      where: { planId: plan.data.id },
      select: { dueDate: true, workOrderId: true },
    });
    expect(occurrences).toHaveLength(1);
    expect(toDateOnly(occurrences[0].dueDate)).toBe(toDateOnly(due));

    const order = await prisma.workOrder.findUniqueOrThrow({
      where: { id: occurrences[0].workOrderId! },
      select: { scheduledFor: true },
    });
    expect(toDateOnly(order.scheduledFor)).toBe(toDateOnly(due));

    await cleanupProduct(product.id);
  });

  it("varsler garantiutløp bare én gang", async () => {
    const warrantyUntil = addDaysUtc(todayUtc(), 10);
    const product = await prisma.product.create({
      data: {
        customerId,
        model: "Garantipumpe",
        qrToken: randomUUID().replace(/-/g, ""),
        warrantyUntil,
      },
    });

    const first = await notifyWarrantyExpiring();
    const second = await notifyWarrantyExpiring();
    expect(first.notified).toBeGreaterThanOrEqual(1);
    expect(second.notified).toBe(0);

    const notifications = await prisma.notification.findMany({
      where: { userId, type: "WARRANTY", dedupeKey: { contains: product.id } },
      select: { id: true, dedupeKey: true },
    });
    expect(notifications).toHaveLength(1);

    const updated = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { warrantyNotifiedAt: true },
    });
    expect(updated.warrantyNotifiedAt).not.toBeNull();

    await cleanupProduct(product.id);
  });
});
