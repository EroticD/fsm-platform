import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import { invalidateModuleCache } from "@/server/modules";
import {
  createExternalOrder,
  getExternalOrder,
  listExternalOrders,
  updateExternalOrder,
} from "@/server/external-orders";
import { createQuote, getQuote, listQuotes, sendQuote, updateQuote } from "@/server/quotes";
import {
  adjustStock,
  consumeReservation,
  createInventoryItem,
  createInventoryLocation,
  listInventory,
  listStockLevels,
  reserveStock,
} from "@/server/inventory";

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

describeIntegration(
  "API-integrasjoner: eksterne ordrer, tilbud og lager mot ekte PostgreSQL",
  () => {
    let departmentA = "";
    let departmentB = "";
    let customerA = "";
    let customerB = "";
    let officeA: ServiceActor;
    let officeB: ServiceActor;
    let itemId = "";
    let locationId = "";
    let workOrderId = "";
    let quoteId = "";
    const source = unique("erp");
    const externalId = unique("WO");
    const createdWorkOrderIds: string[] = [];

    beforeAll(async () => {
      await setModule("quotes", true);
      await setModule("inventory", true);

      const deptA = await prisma.department.create({
        data: { name: unique("IT-api-A"), isActive: true },
      });
      const deptB = await prisma.department.create({
        data: { name: unique("IT-api-B"), isActive: true },
      });
      departmentA = deptA.id;
      departmentB = deptB.id;

      const cA = await prisma.customer.create({
        data: {
          name: unique("API-kunde A"),
          departmentId: departmentA,
          orgNumber: String(900000000 + Math.floor(Math.random() * 99999999)),
        },
      });
      const cB = await prisma.customer.create({
        data: {
          name: unique("API-kunde B"),
          departmentId: departmentB,
        },
      });
      customerA = cA.id;
      customerB = cB.id;

      officeA = actor("it-api-office-a", "OFFICE", departmentA, [
        "customers.view",
        "customers.manage",
        "workorders.view",
        "workorders.create",
        "workorders.update",
        "workorders.edit",
        "equipment.view",
        "equipment.manage",
      ]);
      officeB = actor("it-api-office-b", "OFFICE", departmentB, [
        "customers.view",
        "customers.manage",
        "workorders.view",
        "workorders.create",
        "workorders.update",
        "workorders.edit",
        "equipment.view",
        "equipment.manage",
      ]);
    });

    afterAll(async () => {
      await prisma.externalOrder.deleteMany({ where: { source } });
      await prisma.quote.deleteMany({ where: { createdById: officeA.id } });
      await prisma.inventoryReservation.deleteMany({
        where: { locationId },
      });
      await prisma.stockMovement.deleteMany({ where: { locationId } });
      await prisma.stockLevel.deleteMany({ where: { locationId } });
      await prisma.inventoryItem.deleteMany({ where: { id: itemId } });
      await prisma.inventoryLocation.deleteMany({ where: { id: locationId } });
      if (createdWorkOrderIds.length > 0) {
        await prisma.workOrder.deleteMany({
          where: { id: { in: createdWorkOrderIds } },
        });
      }
      await prisma.customer.deleteMany({
        where: { id: { in: [customerA, customerB] } },
      });
      await prisma.department.deleteMany({
        where: { id: { in: [departmentA, departmentB] } },
      });
      await setModule("quotes", true);
      await setModule("inventory", true);
    });

    it("oppretter ekstern ordre én gang og replay-er samme ordre", async () => {
      const input = {
        source,
        externalId,
        customerId: customerA,
        title: "Akutt service",
        description: "Lekkasje på varmtvannstank.",
        requestedDate: "2026-11-20",
        priority: "HIGH",
        lines: [
          {
            description: "Servicebesøk",
            quantity: "1",
            unitPrice: "1250",
            vatRate: "25",
          },
        ],
        payload: { erpStatus: "CONFIRMED" },
      };

      const first = await createExternalOrder(officeA, input);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.reason);
      expect(first.data.replay).toBe(false);
      createdWorkOrderIds.push(first.data.workOrderId);

      const replay = await createExternalOrder(officeA, input);
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error(replay.reason);
      expect(replay.data.replay).toBe(true);
      expect(replay.data.id).toBe(first.data.id);
      expect(replay.data.workOrderId).toBe(first.data.workOrderId);

      expect(
        await prisma.externalOrder.count({ where: { source, externalId } }),
      ).toBe(1);

      const stored = await prisma.externalOrder.findUnique({
        where: { source_externalId: { source, externalId } },
        select: {
          priority: true,
          payload: true,
          workOrder: {
            select: { title: true, description: true, customerId: true },
          },
        },
      });
      expect(stored?.priority).toBe("HIGH");
      expect(stored?.payload).toEqual({ erpStatus: "CONFIRMED" });
      expect(stored?.workOrder.customerId).toBe(customerA);
      expect(stored?.workOrder.description).toContain("Servicebesøk");

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: "ExternalOrder", entityId: first.data.id },
        select: { action: true },
      });
      expect(audit?.action).toContain(source);

      workOrderId = first.data.workOrderId;
    });

    it("avviser samme nøkkel med annet innhold", async () => {
      const conflict = await createExternalOrder(officeA, {
        source,
        externalId,
        customerId: customerA,
        title: "Endret ordre",
        requestedDate: "2026-11-21",
      });
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) {
        expect(conflict.reason).toBe("conflict");
        expect(conflict.details).toMatchObject({
          code: "orders.idempotencyConflict",
        });
      }
    });

    it("skjuler ordren for en annen avdeling", async () => {
      const order = await prisma.externalOrder.findUnique({
        where: { source_externalId: { source, externalId } },
        select: { id: true },
      });
      const other = await getExternalOrder(officeB, order?.id ?? "");
      expect(other.ok).toBe(false);
      if (!other.ok) expect(other.reason).toBe("not_found");

      const list = await listExternalOrders(officeB, {});
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.data.orders.some((row) => row.id === order?.id)).toBe(false);
      }
    });

    it("endrer status på det mappede oppdraget", async () => {
      const order = await prisma.externalOrder.findUnique({
        where: { source_externalId: { source, externalId } },
        select: { id: true },
      });
      const changed = await updateExternalOrder(officeA, order?.id ?? "", {
        status: "IN_PROGRESS",
      });
      expect(changed.ok).toBe(true);
      if (changed.ok) {
        expect(changed.data.workOrder.status).toBe("IN_PROGRESS");
      }
    });

    it("beregner tilbudets totaler på serveren og oppdaterer dem", async () => {
      const created = await createQuote(officeA, {
        title: unique("API-tilbud"),
        customerId: customerA,
        validUntil: "2027-12-31",
        vatRate: "25",
        lines: [
          { description: "Arbeid", quantity: "2", unitPrice: "100", vatRate: "25" },
          { description: "Materiell", quantity: "1", unitPrice: "50", vatRate: "25" },
        ],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.reason);
      quoteId = created.data.id;

      const detail = await getQuote(officeA, quoteId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) throw new Error(detail.reason);
      expect(detail.data.subtotal.toFixed(2)).toBe("250.00");
      expect(detail.data.vatTotal.toFixed(2)).toBe("62.50");
      expect(detail.data.total.toFixed(2)).toBe("312.50");

      const updated = await updateQuote(officeA, quoteId, {
        title: detail.data.title,
        customerId: customerA,
        validUntil: "2027-12-31",
        vatRate: "25",
        lines: [
          { description: "Arbeid", quantity: "3", unitPrice: "100", vatRate: "25" },
        ],
      });
      expect(updated.ok).toBe(true);

      const fresh = await getQuote(officeA, quoteId);
      expect(fresh.ok).toBe(true);
      if (fresh.ok) {
        expect(fresh.data.subtotal.toFixed(2)).toBe("300.00");
        expect(fresh.data.vatTotal.toFixed(2)).toBe("75.00");
        expect(fresh.data.total.toFixed(2)).toBe("375.00");
        expect(fresh.data.lines).toHaveLength(1);
      }
    });

    it("skjuler tilbudet for en annen avdeling", async () => {
      const other = await getQuote(officeB, quoteId);
      expect(other.ok).toBe(false);
      if (!other.ok) expect(other.reason).toBe("not_found");

      const list = await listQuotes(officeB, {});
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.data.quotes.some((quote) => quote.id === quoteId)).toBe(
          false,
        );
      }
    });

    it("sender tilbudet og fryser versjonen", async () => {
      const sent = await sendQuote(officeA, quoteId);
      expect(sent.ok).toBe(true);
      if (sent.ok) expect(sent.data.version).toBe(1);

      const detail = await getQuote(officeA, quoteId);
      expect(detail.ok).toBe(true);
      if (detail.ok) expect(detail.data.status).toBe("SENT");
    });

    it("reserverer, forbruker og avviser negativ beholdning", async () => {
      const location = await createInventoryLocation(officeA, {
        name: unique("API-lager"),
        type: "WAREHOUSE",
      });
      expect(location.ok).toBe(true);
      if (!location.ok) throw new Error(location.reason);
      locationId = location.data.id;

      const item = await createInventoryItem(officeA, {
        sku: unique("API-SKU"),
        name: "Pakning 50 mm",
      });
      expect(item.ok).toBe(true);
      if (!item.ok) throw new Error(item.reason);
      itemId = item.data.id;

      const inbound = await adjustStock(officeA, {
        itemId,
        locationId,
        type: "IN",
        quantity: 10,
      });
      expect(inbound.ok).toBe(true);

      const reserved = await reserveStock(officeA, {
        itemId,
        locationId,
        quantity: 3,
        workOrderId,
      });
      expect(reserved.ok).toBe(true);
      if (!reserved.ok) throw new Error(reserved.reason);
      expect(reserved.data.available).toBe(7);

      const tooMany = await reserveStock(officeA, {
        itemId,
        locationId,
        quantity: 100,
        workOrderId,
      });
      expect(tooMany.ok).toBe(false);
      if (!tooMany.ok) {
        expect(tooMany.reason).toBe("conflict");
        expect(tooMany.details).toMatchObject({
          code: "inventory.insufficientStock",
        });
      }

      const stockBefore = await listStockLevels(officeA, { itemId });
      expect(stockBefore.ok).toBe(true);
      if (stockBefore.ok) {
        expect(stockBefore.data[0]).toMatchObject({
          quantity: 10,
          reserved: 3,
          available: 7,
        });
      }

      const consumed = await consumeReservation(officeA, reserved.data.id);
      expect(consumed.ok).toBe(true);
      if (consumed.ok) expect(consumed.data.quantity).toBe(3);

      const second = await consumeReservation(officeA, reserved.data.id);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.reason).toBe("conflict");
        expect(second.details).toMatchObject({
          code: "inventory.reservationNotActive",
        });
      }

      const stockAfter = await listStockLevels(officeA, { itemId });
      expect(stockAfter.ok).toBe(true);
      if (stockAfter.ok) {
        expect(stockAfter.data[0]).toMatchObject({
          quantity: 7,
          reserved: 0,
          available: 7,
        });
      }

      // Avdelingssperren følger lokasjonen, ikke varen.
      const otherStock = await listStockLevels(officeB, { itemId });
      expect(otherStock.ok).toBe(true);
      if (otherStock.ok) expect(otherStock.data).toEqual([]);
    });

    it("svarer 404 når modulene er av", async () => {
      await setModule("quotes", false);
      const quote = await getQuote(officeA, quoteId);
      expect(quote.ok).toBe(false);
      if (!quote.ok) expect(quote.reason).toBe("not_found");

      await setModule("inventory", false);
      const inventory = await listInventory(officeA);
      expect(inventory.ok).toBe(false);
      if (!inventory.ok) expect(inventory.reason).toBe("not_found");

      await setModule("quotes", true);
      await setModule("inventory", true);
    });
  },
);
