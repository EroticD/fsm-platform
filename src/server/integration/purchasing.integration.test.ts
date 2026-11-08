import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import { invalidateModuleCache } from "@/server/modules";
import {
  adjustStock,
  createInventoryItem,
  createInventoryLocation,
} from "@/server/inventory";
import {
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createPurchaseOrderFromSuggestions,
  createSupplier,
  getPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  orderPurchaseOrder,
  receivePurchaseOrder,
  removePurchaseOrderLine,
} from "@/server/purchasing";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actor(
  id: string,
  role: string,
  departmentId: string | null,
  permissions: string[],
): ServiceActor {
  return {
    id,
    name: `IT-${role}-${id.slice(-4)}`,
    email: `${id}@example.test`,
    role,
    isActive: true,
    departmentId,
    customerId: null,
    contactId: null,
    permissions,
    permissionsCustomized: true,
    roleDefinition: null,
  };
}

async function setModule(key: string, enabled: boolean) {
  await prisma.moduleState.upsert({
    where: { key },
    update: { enabled },
    create: { key, enabled },
  });
  invalidateModuleCache();
}

async function stockAt(itemId: string, locationId: string): Promise<number> {
  const level = await prisma.stockLevel.findUnique({
    where: { itemId_locationId: { itemId, locationId } },
  });
  return Number(level?.quantity ?? 0);
}

describeIntegration("OPS-05 innkjøp mot ekte PostgreSQL", () => {
  let departmentA = "";
  let departmentB = "";
  let locationA = "";
  let locationB = "";
  let supplierAId = "";
  let supplierBId = "";
  let globalSupplierId = "";
  let itemAId = "";
  let itemBId = "";
  let officeA: ServiceActor;
  let officeB: ServiceActor;
  let technician: ServiceActor;
  let outsider: ServiceActor;
  let admin: ServiceActor;

  async function newOrder(
    options: { itemId?: string; quantity?: number; unitCost?: number } = {},
  ) {
    const created = await createPurchaseOrder(officeA, {
      supplierId: supplierAId,
      locationId: locationA,
      expectedAt: "2026-11-20",
      notes: unique("IT-innkjop"),
    });
    if (!created.ok) throw new Error("Kunne ikke opprette innkjøpsordre");
    const line = await addPurchaseOrderLine(officeA, {
      purchaseOrderId: created.data.id,
      itemId: options.itemId ?? itemAId,
      orderedQuantity: options.quantity ?? 10,
      unitCost: options.unitCost ?? 12.5,
    });
    if (!line.ok) throw new Error("Kunne ikke legge til linje");
    return { id: created.data.id, number: created.data.number, lineId: line.data.id };
  }

  beforeAll(async () => {
    await setModule("inventory", true);

    const deptA = await prisma.department.create({
      data: { name: unique("IT-innkjop-A"), isActive: true },
    });
    const deptB = await prisma.department.create({
      data: { name: unique("IT-innkjop-B"), isActive: true },
    });
    departmentA = deptA.id;
    departmentB = deptB.id;

    officeA = actor("it-innkjop-office-a", "OFFICE", departmentA, [
      "equipment.view",
      "equipment.manage",
    ]);
    officeB = actor("it-innkjop-office-b", "OFFICE", departmentB, [
      "equipment.view",
      "equipment.manage",
    ]);
    technician = actor("it-innkjop-tech", "TECHNICIAN", departmentA, [
      "equipment.view",
    ]);
    outsider = actor("it-innkjop-outsider", "TECHNICIAN", departmentA, []);
    admin = actor("it-innkjop-admin", "ADMIN", null, []);

    const a = await createInventoryLocation(officeA, {
      name: unique("Innkjøpslager A"),
      type: "WAREHOUSE",
    });
    if (!a.ok) throw new Error("Kunne ikke opprette lokasjon A");
    locationA = a.data.id;
    const b = await createInventoryLocation(officeB, {
      name: unique("Innkjøpslager B"),
      type: "WAREHOUSE",
    });
    if (!b.ok) throw new Error("Kunne ikke opprette lokasjon B");
    locationB = b.data.id;

    const supplierA = await createSupplier(officeA, {
      name: unique("Leverandør A"),
      orgNumber: "123 456 789",
      email: "a@leverandor.test",
    });
    if (!supplierA.ok) throw new Error("Kunne ikke opprette leverandør A");
    supplierAId = supplierA.data.id;
    const supplierB = await createSupplier(officeB, {
      name: unique("Leverandør B"),
    });
    if (!supplierB.ok) throw new Error("Kunne ikke opprette leverandør B");
    supplierBId = supplierB.data.id;
    const globalSupplier = await createSupplier(admin, {
      name: unique("Felles leverandør"),
    });
    if (!globalSupplier.ok) throw new Error("Kunne ikke opprette felles leverandør");
    globalSupplierId = globalSupplier.data.id;

    const itemA = await createInventoryItem(officeA, {
      sku: unique("IT-PO-A"),
      name: "Innkjøpsvare A",
      unit: "stk",
      minLevel: 10,
    });
    if (!itemA.ok) throw new Error("Kunne ikke opprette vare A");
    itemAId = itemA.data.id;
    const itemB = await createInventoryItem(officeA, {
      sku: unique("IT-PO-B"),
      name: "Innkjøpsvare B",
      unit: "stk",
      minLevel: 5,
    });
    if (!itemB.ok) throw new Error("Kunne ikke opprette vare B");
    itemBId = itemB.data.id;
  });

  afterAll(async () => {
    if (departmentA) {
      await prisma.purchaseOrder.deleteMany({
        where: { departmentId: { in: [departmentA, departmentB] } },
      });
      await prisma.supplier.deleteMany({
        where: {
          OR: [
            { departmentId: { in: [departmentA, departmentB] } },
            { id: globalSupplierId },
          ],
        },
      });
      await prisma.inventoryLocation.deleteMany({
        where: { departmentId: { in: [departmentA, departmentB] } },
      });
      await prisma.inventoryItem.deleteMany({
        where: { id: { in: [itemAId, itemBId] } },
      });
    }
    await prisma.department.deleteMany({
      where: { id: { in: [departmentA, departmentB] } },
    });
    await prisma.moduleState.deleteMany({ where: { key: "inventory" } });
    invalidateModuleCache();
  });

  it("oppretter utkast fra kjøpsforslag med foreslått mengde", async () => {
    const filled = await adjustStock(officeA, {
      itemId: itemAId,
      locationId: locationA,
      type: "IN",
      quantity: 2,
      reason: "Testoppfylling",
    });
    expect(filled.ok).toBe(true);

    const created = await createPurchaseOrderFromSuggestions(officeA, {
      supplierId: supplierAId,
      locationId: locationA,
      itemIds: [itemAId],
      expectedAt: "2026-11-25",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.number).toMatch(/^PO-\d{4}-\d{5}$/);
    expect(created.data.lineCount).toBe(1);

    const detail = await getPurchaseOrder(officeA, created.data.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.order.status).toBe("DRAFT");
    expect(detail.data.order.orderedTotal).toBe("0.00");
    expect(detail.data.lines).toHaveLength(1);
    expect(detail.data.lines[0].orderedQuantity).toBe(8);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "PurchaseOrder", entityId: created.data.id },
      orderBy: { seq: "desc" },
    });
    expect(audit?.action).toContain("kjøpsforslag");
  });

  it("fullt mottak øker beholdningen, setter RECEIVED og reviderer", async () => {
    const { id, number, lineId } = await newOrder();
    const ordered = await orderPurchaseOrder(officeA, id);
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    expect(ordered.data.status).toBe("ORDERED");

    const before = await stockAt(itemAId, locationA);
    const received = await receivePurchaseOrder(officeA, id, [
      { lineId, quantity: 10 },
    ]);
    expect(received.ok).toBe(true);
    if (!received.ok) return;
    expect(received.data.status).toBe("RECEIVED");

    expect(await stockAt(itemAId, locationA)).toBe(before + 10);
    const movement = await prisma.stockMovement.findFirst({
      where: { itemId: itemAId, locationId: locationA, type: "IN" },
      orderBy: { createdAt: "desc" },
    });
    expect(movement?.reason).toContain(number);
    expect(Number(movement?.quantity)).toBe(10);

    const row = await prisma.purchaseOrder.findUnique({ where: { id } });
    expect(row?.status).toBe("RECEIVED");
    expect(row?.receivedAt).not.toBeNull();

    const detail = await getPurchaseOrder(officeA, id);
    if (!detail.ok) throw new Error("Detalj feilet");
    expect(detail.data.order.orderedTotal).toBe("125.00");
    expect(detail.data.order.receivedTotal).toBe("125.00");

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "PurchaseOrder",
        entityId: id,
        action: { contains: "Mottok" },
      },
    });
    expect(audit).not.toBeNull();
  });

  it("delt mottak oppdaterer status og avviser overmottak", async () => {
    const { id, lineId } = await newOrder({ quantity: 10 });
    const ordered = await orderPurchaseOrder(officeA, id);
    expect(ordered.ok).toBe(true);
    const before = await stockAt(itemAId, locationA);

    const partial = await receivePurchaseOrder(officeA, id, [
      { lineId, quantity: 4 },
    ]);
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.data.status).toBe("PARTIALLY_RECEIVED");
    expect(await stockAt(itemAId, locationA)).toBe(before + 4);

    const over = await receivePurchaseOrder(officeA, id, [
      { lineId, quantity: 7 },
    ]);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.reason).toBe("conflict");
      expect((over.details as { code?: string }).code).toBe(
        "purchasing.overReceipt",
      );
    }
    expect(await stockAt(itemAId, locationA)).toBe(before + 4);

    const line = await prisma.purchaseOrderLine.findUnique({ where: { id: lineId } });
    expect(Number(line?.receivedQuantity)).toBe(4);

    const rest = await receivePurchaseOrder(officeA, id, [
      { lineId, quantity: 6 },
    ]);
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.data.status).toBe("RECEIVED");
    expect(await stockAt(itemAId, locationA)).toBe(before + 10);
  });

  it("serialiserer samtidige mottak uten overmottak", async () => {
    const { id, lineId } = await newOrder({ quantity: 10 });
    expect((await orderPurchaseOrder(officeA, id)).ok).toBe(true);
    const before = await stockAt(itemAId, locationA);

    const results = await Promise.all([
      receivePurchaseOrder(officeA, id, [{ lineId, quantity: 6 }]),
      receivePurchaseOrder(officeA, id, [{ lineId, quantity: 6 }]),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const rejected = results.find((result) => !result.ok);
    expect(rejected?.ok).toBe(false);
    if (rejected && !rejected.ok) {
      expect((rejected.details as { code?: string }).code).toBe(
        "purchasing.overReceipt",
      );
    }

    const row = await prisma.purchaseOrder.findUnique({ where: { id } });
    expect(row?.status).toBe("PARTIALLY_RECEIVED");
    expect(await stockAt(itemAId, locationA)).toBe(before + 6);
    const line = await prisma.purchaseOrderLine.findUnique({ where: { id: lineId } });
    expect(Number(line?.receivedQuantity)).toBe(6);

    const rest = await receivePurchaseOrder(officeA, id, [
      { lineId, quantity: 4 },
    ]);
    expect(rest.ok).toBe(true);
  });

  it("avbestiller før mottak, men aldri etter at varer er mottatt", async () => {
    const draft = await newOrder({ quantity: 3 });
    const cancelledDraft = await cancelPurchaseOrder(officeA, draft.id);
    expect(cancelledDraft.ok).toBe(true);
    if (!cancelledDraft.ok) return;
    expect(cancelledDraft.data.status).toBe("CANCELLED");
    const orderAfterCancel = await orderPurchaseOrder(officeA, draft.id);
    expect(orderAfterCancel.ok).toBe(false);
    const receiveAfterCancel = await receivePurchaseOrder(officeA, draft.id, [
      { lineId: draft.lineId, quantity: 1 },
    ]);
    expect(receiveAfterCancel.ok).toBe(false);

    const ordered = await newOrder({ quantity: 5 });
    expect((await orderPurchaseOrder(officeA, ordered.id)).ok).toBe(true);
    const cancelledOrdered = await cancelPurchaseOrder(officeA, ordered.id);
    expect(cancelledOrdered.ok).toBe(true);

    const partial = await newOrder({ quantity: 5 });
    expect((await orderPurchaseOrder(officeA, partial.id)).ok).toBe(true);
    expect(
      (
        await receivePurchaseOrder(officeA, partial.id, [
          { lineId: partial.lineId, quantity: 2 },
        ])
      ).ok,
    ).toBe(true);
    const cancelPartial = await cancelPurchaseOrder(officeA, partial.id);
    expect(cancelPartial.ok).toBe(false);
    if (!cancelPartial.ok) expect(cancelPartial.reason).toBe("conflict");
  });

  it("håndhever statusoverganger for linjer og bestilling", async () => {
    const { id, lineId } = await newOrder({ quantity: 4 });
    const duplicate = await addPurchaseOrderLine(officeA, {
      purchaseOrderId: id,
      itemId: itemAId,
      orderedQuantity: 1,
      unitCost: 10,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect((duplicate.details as { code?: string }).code).toBe(
        "purchasing.duplicateLine",
      );
    }

    const receiveDraft = await receivePurchaseOrder(officeA, id, [
      { lineId, quantity: 1 },
    ]);
    expect(receiveDraft.ok).toBe(false);

    expect(
      (
        await removePurchaseOrderLine(officeA, {
          purchaseOrderId: id,
          lineId,
        })
      ).ok,
    ).toBe(true);

    const emptyOrder = await orderPurchaseOrder(officeA, id);
    expect(emptyOrder.ok).toBe(false);
    if (!emptyOrder.ok) {
      expect((emptyOrder.details as { code?: string }).code).toBe(
        "purchasing.nothingToOrder",
      );
    }

    const relined = await addPurchaseOrderLine(officeA, {
      purchaseOrderId: id,
      itemId: itemBId,
      orderedQuantity: 2,
      unitCost: 5,
    });
    expect(relined.ok).toBe(true);
    expect((await orderPurchaseOrder(officeA, id)).ok).toBe(true);

    const secondOrder = await orderPurchaseOrder(officeA, id);
    expect(secondOrder.ok).toBe(false);
    const addAfterOrder = await addPurchaseOrderLine(officeA, {
      purchaseOrderId: id,
      itemId: itemAId,
      orderedQuantity: 1,
      unitCost: 5,
    });
    expect(addAfterOrder.ok).toBe(false);
    const removeAfterOrder = await removePurchaseOrderLine(officeA, {
      purchaseOrderId: id,
      lineId: relined.ok ? relined.data.id : "",
    });
    expect(removeAfterOrder.ok).toBe(false);
  });

  it("avviser manglende rettigheter og fremmed avdeling", async () => {
    const { id, lineId } = await newOrder({ quantity: 2 });

    const technicianList = await listPurchaseOrders(technician);
    expect(technicianList.ok).toBe(true);
    const technicianRead = await getPurchaseOrder(technician, id);
    expect(technicianRead.ok).toBe(true);
    const technicianReceive = await receivePurchaseOrder(technician, id, [
      { lineId, quantity: 1 },
    ]);
    expect(technicianReceive.ok).toBe(false);
    if (!technicianReceive.ok) expect(technicianReceive.reason).toBe("forbidden");

    const outsiderList = await listPurchaseOrders(outsider);
    expect(outsiderList.ok).toBe(false);
    if (!outsiderList.ok) expect(outsiderList.reason).toBe("forbidden");

    const otherDepartmentRead = await getPurchaseOrder(officeB, id);
    expect(otherDepartmentRead.ok).toBe(false);
    if (!otherDepartmentRead.ok) expect(otherDepartmentRead.reason).toBe("not_found");
    const otherDepartmentCancel = await cancelPurchaseOrder(officeB, id);
    expect(otherDepartmentCancel.ok).toBe(false);

    const otherDepartmentList = await listPurchaseOrders(officeB);
    expect(otherDepartmentList.ok).toBe(true);
    if (otherDepartmentList.ok) {
      expect(otherDepartmentList.data.orders.some((order) => order.id === id)).toBe(
        false,
      );
    }

    const foreignSupplier = await createPurchaseOrder(officeB, {
      supplierId: supplierAId,
      locationId: locationB,
    });
    expect(foreignSupplier.ok).toBe(false);

    const suppliersA = await listSuppliers(officeA);
    expect(suppliersA.ok).toBe(true);
    if (suppliersA.ok) {
      expect(suppliersA.data.suppliers.some((s) => s.id === supplierBId)).toBe(false);
      expect(suppliersA.data.suppliers.some((s) => s.id === globalSupplierId)).toBe(
        true,
      );
    }

    const adminRead = await getPurchaseOrder(admin, id);
    expect(adminRead.ok).toBe(true);
    const adminSuppliers = await listSuppliers(admin);
    expect(adminSuppliers.ok).toBe(true);
    if (adminSuppliers.ok) {
      expect(adminSuppliers.data.suppliers.map((s) => s.id)).toEqual(
        expect.arrayContaining([supplierAId, supplierBId, globalSupplierId]),
      );
    }
  });

  it("stenger innkjøp når inventory-modulen er av", async () => {
    const { id } = await newOrder({ quantity: 1 });
    await setModule("inventory", false);
    const listOff = await listPurchaseOrders(officeA);
    expect(listOff.ok).toBe(false);
    if (!listOff.ok) expect(listOff.reason).toBe("not_found");
    const detailOff = await getPurchaseOrder(officeA, id);
    expect(detailOff.ok).toBe(false);
    const supplierOff = await createSupplier(officeA, { name: unique("Stengt") });
    expect(supplierOff.ok).toBe(false);
    await setModule("inventory", true);
  });
});
