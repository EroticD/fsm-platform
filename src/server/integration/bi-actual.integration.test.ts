import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { invalidateModuleCache } from "@/server/modules";
import type { ServiceActor } from "@/server/actor";
import { getProfitability } from "@/server/bi";
import { createInvoice, registerCreditNote, sendInvoice } from "@/server/invoices";

const describeIntegration = integrationEnabled ? describe : describe.skip;

database: {
  // Merkelappnavn; testene hoppes over uten en eksplisitt testdatabase.
}

let departmentAId = "";
let departmentBId = "";
let customerAId = "";
let customerBId = "";
let technicianAId = "";
let technicianBId = "";
let technicianCId = "";
let adminUserId = "";
const createdInvoiceIds: string[] = [];
const createdWorkOrderIds: string[] = [];

const FROM = "2026-11-01";
const TO = "2026-11-30";

function adminActor(): ServiceActor {
  return {
    id: adminUserId,
    name: "BI-admin",
    email: "bi-admin@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId: null,
    permissionsCustomized: false,
    permissions: [],
    roleDefinition: { permissions: [] },
  };
}

function officeActor(departmentId: string): ServiceActor {
  return {
    id: `it-bi-office-${departmentId}`,
    name: "BI-kontor",
    email: "bi-office@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId,
    permissionsCustomized: true,
    permissions: ["reports.view"],
    roleDefinition: null,
  };
}

async function createCompletedOrder(options: {
  departmentId: string;
  customerId: string;
  technicianId: string;
  scheduledFor: string;
}) {
  const order = await prisma.workOrder.create({
    data: {
      title: unique("BI-oppdrag"),
      reference: unique("IT-BI"),
      departmentId: options.departmentId,
      customerId: options.customerId,
      status: "COMPLETED",
      scheduledFor: new Date(`${options.scheduledFor}T00:00:00.000Z`),
      technicians: { connect: { id: options.technicianId } },
    },
    select: { id: true },
  });
  createdWorkOrderIds.push(order.id);
  return order.id;
}

async function createSent(
  workOrderId: string,
  customerId: string,
  amount: number,
) {
  const created = await createInvoice(adminActor(), {
    workOrderId,
    customerId,
    issueDate: "2026-11-10",
    lines: [
      { description: "Service", quantity: 1, unitPrice: amount, vatRate: 25 },
    ],
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.reason);
  createdInvoiceIds.push(created.data.id);
  const sent = await sendInvoice(adminActor(), created.data.id);
  expect(sent.ok).toBe(true);
  if (!sent.ok) throw new Error(sent.reason);
  return created.data.id;
}

describeIntegration("BI faktisk omsetning mot ekte PostgreSQL", () => {
  let orderA1Id = "";
  let orderA2Id = "";
  let orderB1Id = "";
  let invoiceA1Id = "";

  beforeAll(async () => {
    await prisma.role.upsert({
      where: { key: "ADMIN" },
      update: {},
      create: {
        key: "ADMIN",
        label: unique("Administrator"),
        description: "Integrasjonstest",
        permissions: [],
        isSystem: true,
      },
    });
    const admin = await prisma.user.create({
      data: {
        name: "BI-admin",
        email: `${unique("bi-admin")}@example.test`,
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const departmentA = await prisma.department.create({
      data: { name: unique("BI-avdeling A") },
    });
    const departmentB = await prisma.department.create({
      data: { name: unique("BI-avdeling B") },
    });
    departmentAId = departmentA.id;
    departmentBId = departmentB.id;

    const customerA = await prisma.customer.create({
      data: { name: unique("BI-kunde A"), departmentId: departmentAId },
    });
    const customerB = await prisma.customer.create({
      data: { name: unique("BI-kunde B"), departmentId: departmentBId },
    });
    customerAId = customerA.id;
    customerBId = customerB.id;

    const technicianA = await prisma.user.create({
      data: {
        name: unique("BI-montør A"),
        email: `${unique("bi-tech-a")}@example.test`,
        role: "TECHNICIAN",
        departmentId: departmentAId,
        isActive: true,
      },
      select: { id: true },
    });
    const technicianB = await prisma.user.create({
      data: {
        name: unique("BI-montør B"),
        email: `${unique("bi-tech-b")}@example.test`,
        role: "TECHNICIAN",
        departmentId: departmentAId,
        isActive: true,
      },
      select: { id: true },
    });
    const technicianC = await prisma.user.create({
      data: {
        name: unique("BI-montør C"),
        email: `${unique("bi-tech-c")}@example.test`,
        role: "TECHNICIAN",
        departmentId: departmentBId,
        isActive: true,
      },
      select: { id: true },
    });
    technicianAId = technicianA.id;
    technicianBId = technicianB.id;
    technicianCId = technicianC.id;

    await prisma.moduleState.upsert({
      where: { key: "invoicing" },
      update: { enabled: true },
      create: { key: "invoicing", enabled: true },
    });
    invalidateModuleCache();

    orderA1Id = await createCompletedOrder({
      departmentId: departmentAId,
      customerId: customerAId,
      technicianId: technicianAId,
      scheduledFor: "2026-11-02",
    });
    orderA2Id = await createCompletedOrder({
      departmentId: departmentAId,
      customerId: customerAId,
      technicianId: technicianBId,
      scheduledFor: "2026-11-03",
    });
    orderB1Id = await createCompletedOrder({
      departmentId: departmentBId,
      customerId: customerBId,
      technicianId: technicianCId,
      scheduledFor: "2026-11-04",
    });

    invoiceA1Id = await createSent(orderA1Id, customerAId, 100);
    const credit = await registerCreditNote(adminActor(), invoiceA1Id, {
      amount: "25.00",
      issuedAt: "2026-11-11",
    });
    expect(credit.ok).toBe(true);

    // En kladd skal aldri telle som faktisk omsetning.
    const draft = await createInvoice(adminActor(), {
      workOrderId: orderA2Id,
      customerId: customerAId,
      issueDate: "2026-11-10",
      lines: [
        { description: "Kladd", quantity: 1, unitPrice: 50, vatRate: 25 },
      ],
    });
    expect(draft.ok).toBe(true);
    if (draft.ok) createdInvoiceIds.push(draft.data.id);

    await createSent(orderB1Id, customerBId, 200);
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({
      where: { invoiceId: { in: createdInvoiceIds } },
    });
    await prisma.creditNote.deleteMany({
      where: { invoiceId: { in: createdInvoiceIds } },
    });
    await prisma.invoice.deleteMany({
      where: { id: { in: createdInvoiceIds } },
    });
    await prisma.workOrder.deleteMany({
      where: { id: { in: createdWorkOrderIds } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: [customerAId, customerBId] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [adminUserId, technicianAId, technicianBId, technicianCId].filter(
            Boolean,
          ),
        },
      },
    });
    await prisma.department.deleteMany({
      where: { id: { in: [departmentAId, departmentBId] } },
    });
    await prisma.moduleState.upsert({
      where: { key: "invoicing" },
      update: { enabled: true },
      create: { key: "invoicing", enabled: true },
    });
    invalidateModuleCache();
  });

  it("beregner netto faktisk omsetning uten MVA og uten kladd", async () => {
    const result = await getProfitability(adminActor(), {
      from: FROM,
      to: TO,
      departmentId: departmentAId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;

    expect(data.revenue.actualAvailable).toBe(true);
    expect(data.revenue.actualRevenueOre).toBe(8_000);
    expect(data.revenue.actualInvoiceCount).toBe(1);
    expect(data.revenue.actualOrderCount).toBe(1);
    expect(data.perOrder.find((row) => row.id === orderA1Id)?.actualRevenueOre).toBe(
      8_000,
    );
    expect(data.perOrder.find((row) => row.id === orderA2Id)?.actualRevenueOre).toBe(
      0,
    );
    expect(
      data.perTechnician.find((row) => row.id === technicianAId)
        ?.actualRevenueOre,
    ).toBe(8_000);
  });

  it("isolerer avdelinger og avviser filter utenfor kontorets omfang", async () => {
    const officeA = officeActor(departmentAId);
    const own = await getProfitability(officeA, { from: FROM, to: TO });
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.data.revenue.actualRevenueOre).toBe(8_000);
      expect(
        own.data.perCustomer.every((row) => row.id === customerAId),
      ).toBe(true);
    }

    const cross = await getProfitability(officeA, {
      from: FROM,
      to: TO,
      departmentId: departmentBId,
    });
    expect(cross).toEqual({ ok: false, reason: "forbidden" });

    const departmentB = await getProfitability(adminActor(), {
      from: FROM,
      to: TO,
      departmentId: departmentBId,
    });
    expect(departmentB.ok).toBe(true);
    if (departmentB.ok) {
      expect(departmentB.data.revenue.actualRevenueOre).toBe(20_000);
      expect(departmentB.data.perOrder[0].actualRevenueOre).toBe(20_000);
    }
  });

  it("gir bare estimat når faktureringsmodulen er av", async () => {
    await prisma.moduleState.update({
      where: { key: "invoicing" },
      data: { enabled: false },
    });
    invalidateModuleCache();

    const result = await getProfitability(officeActor(departmentAId), {
      from: FROM,
      to: TO,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.revenue.actualAvailable).toBe(false);
    expect(result.data.revenue.actualRevenueOre).toBeNull();
    expect(result.data.revenue.actualInvoiceCount).toBe(0);
    expect(
      result.data.perOrder.find((row) => row.id === orderA1Id)?.actualRevenueOre,
    ).toBeNull();

    await prisma.moduleState.update({
      where: { key: "invoicing" },
      data: { enabled: true },
    });
    invalidateModuleCache();
  });

  it("er utilgjengelig når utvalget bare har kladder", async () => {
    const result = await getProfitability(officeActor(departmentAId), {
      from: FROM,
      to: TO,
      technicianId: technicianBId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.orders.total).toBe(1);
    expect(result.data.revenue.actualAvailable).toBe(false);
    expect(result.data.revenue.actualRevenueOre).toBeNull();
    expect(result.data.perOrder[0].actualRevenueOre).toBeNull();
  });
});
