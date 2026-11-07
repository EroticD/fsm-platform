import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { todayUtc } from "@/lib/dates";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import { invalidateModuleCache } from "@/server/modules";
import {
  adjustStock,
  consumeReservation,
  createInventoryItem,
  createInventoryLocation,
  listInventory,
  releaseReservation,
  reserveStock,
} from "@/server/inventory";
import {
  approveExpense,
  approveMileageTrip,
  createExpense,
  createMileageTrip,
  exportPayroll,
  listMyExpenses,
  previewPayroll,
  rejectExpense,
  rejectMileageTrip,
} from "@/server/expenses";

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

describeIntegration("OPS-05 lager og FLD-01 utlegg mot ekte PostgreSQL", () => {
  let departmentA = "";
  let departmentB = "";
  let workOrderId = "";
  let technicianId = "";
  let locationA = "";
  let itemId = "";
  let concurrencyItemId = "";
  let officeA: ServiceActor;
  let officeB: ServiceActor;
  let technician: ServiceActor;
  let outsider: ServiceActor;

  beforeAll(async () => {
    await setModule("inventory", true);
    await setModule("fieldExpenses", true);

    const deptA = await prisma.department.create({
      data: { name: unique("IT-lager-A"), isActive: true },
    });
    const deptB = await prisma.department.create({
      data: { name: unique("IT-lager-B"), isActive: true },
    });
    departmentA = deptA.id;
    departmentB = deptB.id;

    const tech = await prisma.user.create({
      data: {
        name: "IT Lagertekniker",
        email: `${unique("it-lager-tech")}@example.test`,
        role: "TECHNICIAN",
        departmentId: departmentA,
        isActive: true,
      },
      select: { id: true },
    });
    technicianId = tech.id;

    const order = await prisma.workOrder.create({
      data: {
        title: unique("IT-lager-oppdrag"),
        reference: unique("O-LAGER"),
        departmentId: departmentA,
        status: "PLANNED",
        scheduledFor: todayUtc(),
      },
      select: { id: true },
    });
    workOrderId = order.id;

    // Eksisterende visitt-tid brukes i lønnsgrunnlaget.
    const start = new Date("2026-11-02T08:30:00.000Z");
    await prisma.visit.create({
      data: {
        workOrderId,
        sequence: 0,
        startsAt: start,
        endsAt: new Date("2026-11-02T12:00:00.000Z"),
        status: "DONE",
        enRouteAt: new Date("2026-11-02T08:30:00.000Z"),
        onSiteAt: new Date("2026-11-02T09:00:00.000Z"),
        doneAt: new Date("2026-11-02T11:00:00.000Z"),
        travelFromEndedAt: new Date("2026-11-02T11:30:00.000Z"),
        technicians: { create: { userId: technicianId } },
      },
    });

    officeA = actor("it-office-a", "OFFICE", departmentA, [
      "equipment.view",
      "equipment.manage",
      "workorders.view",
      "workorders.update",
      "workorders.edit",
      "settings.manage",
    ]);
    officeB = actor("it-office-b", "OFFICE", departmentB, [
      "equipment.view",
      "equipment.manage",
      "workorders.view",
      "workorders.update",
      "workorders.edit",
      "settings.manage",
    ]);
    technician = actor(technicianId, "TECHNICIAN", departmentA, [
      "workorders.view",
      "workorders.update",
      "reports.write",
      "equipment.view",
    ]);
    outsider = actor("it-outsider", "TECHNICIAN", departmentA, []);

    const location = await createInventoryLocation(officeA, {
      name: unique("Hovedlager"),
      type: "WAREHOUSE",
    });
    if (!location.ok) throw new Error("Kunne ikke opprette lokasjon");
    locationA = location.data.id;

    const item = await createInventoryItem(officeA, {
      sku: unique("SKU"),
      name: "Pakning 50 mm",
      unit: "stk",
      minLevel: 10,
    });
    if (!item.ok) throw new Error("Kunne ikke opprette vare");
    itemId = item.data.id;

    const concurrencyItem = await createInventoryItem(officeA, {
      sku: unique("SKU-KONK"),
      name: "Konkurransevare",
      unit: "stk",
      minLevel: 0,
    });
    if (!concurrencyItem.ok) throw new Error("Kunne ikke opprette konkurransevare");
    concurrencyItemId = concurrencyItem.data.id;
  });

  afterAll(async () => {
    if (departmentA) {
      await prisma.payrollExport.deleteMany({
        where: { departmentId: { in: [departmentA, departmentB] } },
      });
      await prisma.mileageTrip.deleteMany({
        where: { departmentId: { in: [departmentA, departmentB] } },
      });
      await prisma.expense.deleteMany({
        where: { departmentId: { in: [departmentA, departmentB] } },
      });
      await prisma.inventoryLocation.deleteMany({
        where: { departmentId: { in: [departmentA, departmentB] } },
      });
      await prisma.inventoryItem.deleteMany({
        where: { id: { in: [itemId, concurrencyItemId] } },
      });
      await prisma.upload.deleteMany({
        where: { uploadedById: technicianId },
      });
    }
    if (technicianId) {
      await prisma.workOrder.deleteMany({ where: { departmentId: departmentA } });
      await prisma.user.deleteMany({ where: { id: technicianId } });
    }
    await prisma.department.deleteMany({
      where: { id: { in: [departmentA, departmentB] } },
    });
    await prisma.moduleState.deleteMany({
      where: { key: { in: ["inventory", "fieldExpenses"] } },
    });
    invalidateModuleCache();
  });

  describe("lager", () => {
    it("justerer beholdning, lager kjøpsforslag og revisjonsspor", async () => {
      const adjusted = await adjustStock(officeA, {
        itemId,
        locationId: locationA,
        type: "IN",
        quantity: 20,
        reason: "Varemottak",
      });
      expect(adjusted.ok).toBe(true);
      if (adjusted.ok) expect(adjusted.data.quantity).toBe(20);

      const overview = await listInventory(officeA, { q: "Pakning" });
      expect(overview.ok).toBe(true);
      if (!overview.ok) return;
      const row = overview.data.items.find((item) => item.id === itemId);
      expect(row?.onHand).toBe(20);
      expect(row?.suggestedQuantity).toBe(0);

      // Bestillingspunktet er 10; med 20 på lager og 18 reservert blir
      // tilgjengelig 2, og forslaget 8.
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityType: "InventoryItem",
          entityId: itemId,
          action: { contains: "Justerte" },
        },
      });
      expect(audit).not.toBeNull();
    });

    it("hindrer negativ beholdning ved vanlig uttak", async () => {
      const before = await prisma.stockLevel.findFirst({
        where: { itemId, locationId: locationA },
      });
      const result = await adjustStock(officeA, {
        itemId,
        locationId: locationA,
        type: "OUT",
        quantity: 999,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("conflict");
      const after = await prisma.stockLevel.findFirst({
        where: { itemId, locationId: locationA },
      });
      expect(after?.quantity.toString()).toBe(before?.quantity.toString());
    });

    it("serialiserer samtidige reservasjoner og slipper bare gjennom nok beholdning", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          reserveStock(officeA, {
            itemId,
            locationId: locationA,
            quantity: 3,
            workOrderId,
            note: "Samtidig test",
          }),
        ),
      );
      const successes = results.filter((result) => result.ok);
      expect(successes).toHaveLength(6);
      expect(results.filter((result) => !result.ok)).toHaveLength(4);

      const active = await prisma.inventoryReservation.aggregate({
        where: { itemId, locationId: locationA, status: "ACTIVE" },
        _sum: { quantity: true },
      });
      expect(Number(active._sum.quantity)).toBe(18);

      const overview = await listInventory(officeA, { q: "Pakning" });
      if (!overview.ok) throw new Error("Liste feilet");
      const row = overview.data.items.find((item) => item.id === itemId);
      expect(row?.available).toBe(2);
      expect(row?.suggestedQuantity).toBe(8);
    });

    it("serialiserer samtidige uttak uten å gå under null", async () => {
      const filled = await adjustStock(officeA, {
        itemId: concurrencyItemId,
        locationId: locationA,
        type: "IN",
        quantity: 20,
      });
      expect(filled.ok).toBe(true);

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          adjustStock(officeA, {
            itemId: concurrencyItemId,
            locationId: locationA,
            type: "OUT",
            quantity: 3,
            reason: "Samtidig uttak",
          }),
        ),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(6);
      const level = await prisma.stockLevel.findUnique({
        where: { itemId_locationId: { itemId: concurrencyItemId, locationId: locationA } },
      });
      expect(Number(level?.quantity)).toBe(2);
    });

    it("frigjør og forbruker reservasjoner, og avviser dobbeltforbruk", async () => {
      const active = await prisma.inventoryReservation.findMany({
        where: { itemId, locationId: locationA, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      });
      expect(active.length).toBeGreaterThan(1);

      const released = await releaseReservation(officeA, active[0].id);
      expect(released.ok).toBe(true);
      const releasedRow = await prisma.inventoryReservation.findUnique({
        where: { id: active[0].id },
      });
      expect(releasedRow?.status).toBe("RELEASED");

      const before = await prisma.stockLevel.findUnique({
        where: { itemId_locationId: { itemId, locationId: locationA } },
      });
      const consumed = await consumeReservation(officeA, active[1].id);
      expect(consumed.ok).toBe(true);
      const after = await prisma.stockLevel.findUnique({
        where: { itemId_locationId: { itemId, locationId: locationA } },
      });
      expect(Number(before?.quantity) - Number(after?.quantity)).toBe(3);

      const again = await consumeReservation(officeA, active[1].id);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.reason).toBe("conflict");
    });

    it("avviser manglende rettigheter og stenger tjenesten når modulen er av", async () => {
      const denied = await adjustStock(outsider, {
        itemId,
        locationId: locationA,
        type: "IN",
        quantity: 1,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.reason).toBe("forbidden");

      const listDenied = await listInventory(outsider);
      expect(listDenied.ok).toBe(false);

      const reserveDenied = await adjustStock(technician, {
        itemId,
        locationId: locationA,
        type: "IN",
        quantity: 1,
      });
      expect(reserveDenied.ok).toBe(false);

      await setModule("inventory", false);
      const off = await listInventory(officeA);
      expect(off.ok).toBe(false);
      if (!off.ok) expect(off.reason).toBe("not_found");
      await setModule("inventory", true);
    });
  });

  describe("utlegg og lønn", () => {
    let approvedTripId = "";
    let rejectedTripId = "";
    let approvedExpenseId = "";
    let rejectedExpenseId = "";

    it("beregner kjøregodtgjørelse og mva på serveren", async () => {
      const trip = await createMileageTrip(technician, {
        date: "2026-11-01",
        fromAddress: "Lageret",
        toAddress: "Kunden",
        km: 12.5,
        rate: 3.5,
        workOrderId,
      });
      expect(trip.ok).toBe(true);
      if (!trip.ok) return;
      approvedTripId = trip.data.id;
      expect(trip.data.amount).toBe(43.75);

      const expense = await createExpense(technician, {
        date: "2026-11-01",
        category: "Parkering",
        amount: 125,
        vatRate: 25,
        workOrderId,
      });
      expect(expense.ok).toBe(true);
      if (!expense.ok) return;
      approvedExpenseId = expense.data.id;
      expect(expense.data.vatAmount).toBe(25);

      const rejectedTrip = await createMileageTrip(technician, {
        date: "2026-11-03",
        fromAddress: "Lageret",
        toAddress: "Privat",
        km: 2,
        rate: 3.5,
      });
      if (!rejectedTrip.ok) throw new Error("Kunne ikke opprette avvist tur");
      rejectedTripId = rejectedTrip.data.id;

      const rejectedExpense = await createExpense(technician, {
        date: "2026-11-03",
        category: "Kiosk",
        amount: 50,
        vatRate: 25,
      });
      if (!rejectedExpense.ok) throw new Error("Kunne ikke opprette avvist utlegg");
      rejectedExpenseId = rejectedExpense.data.id;
    });

    it("godkjenner og avviser med revisjonsspor", async () => {
      const approved = await approveMileageTrip(officeA, approvedTripId);
      expect(approved.ok).toBe(true);
      const approvedExp = await approveExpense(officeA, approvedExpenseId);
      expect(approvedExp.ok).toBe(true);
      const rejected = await rejectMileageTrip(officeA, rejectedTripId, "Privat kjøring");
      expect(rejected.ok).toBe(true);
      const rejectedExp = await rejectExpense(officeA, rejectedExpenseId, "Ikke gyldig kvittering");
      expect(rejectedExp.ok).toBe(true);

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: "Expense", entityId: approvedExpenseId },
        orderBy: { seq: "desc" },
      });
      expect(audit?.action).toContain("Godkjente");

      const technicianApprove = await approveExpense(technician, approvedExpenseId);
      expect(technicianApprove.ok).toBe(false);

      const otherDepartment = await approveExpense(officeB, approvedExpenseId);
      expect(otherDepartment.ok).toBe(false);
      if (!otherDepartment.ok) expect(otherDepartment.reason).toBe("not_found");
    });

    it("eksporterer godkjent tid, kjøretur og utlegg, men aldri avviste rader", async () => {
      const preview = await previewPayroll(officeA, {
        start: "2026-11-01",
        end: "2026-11-30",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.data.totals.workHours).toBe(2);
      expect(preview.data.totals.travelHours).toBe(1);
      expect(preview.data.totals.mileageAmount).toBe(43.75);
      expect(preview.data.totals.expenseAmount).toBe(125);
      expect(preview.data.rows.some((row) => row.amount === 50)).toBe(false);

      const first = await exportPayroll(officeA, {
        start: "2026-11-01",
        end: "2026-11-30",
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.existing).toBe(false);
      expect(first.data.csv).not.toContain("Kiosk");
      expect(first.data.csv).not.toContain("Privat");

      const second = await exportPayroll(officeA, {
        start: "2026-11-01",
        end: "2026-11-30",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.existing).toBe(true);
      expect(second.data.checksum).toBe(first.data.checksum);
      expect(second.data.csv).toBe(first.data.csv);

      const exports = await prisma.payrollExport.findMany({
        where: { departmentId: departmentA },
      });
      expect(exports).toHaveLength(1);
      const lines = await prisma.payrollExportLine.count({
        where: { exportId: exports[0].id },
      });
      expect(lines).toBe(first.data.rowCount);

      const rejectedStillPending = await prisma.expense.findUnique({
        where: { id: rejectedExpenseId },
      });
      expect(rejectedStillPending?.payrollExportId).toBeNull();
    });

    it("avviser overlappende perioder og manglende eksportrettighet", async () => {
      const overlap = await exportPayroll(officeA, {
        start: "2026-11-15",
        end: "2026-12-15",
      });
      expect(overlap.ok).toBe(false);
      if (!overlap.ok) expect(overlap.reason).toBe("conflict");

      const denied = await exportPayroll(technician, {
        start: "2026-12-01",
        end: "2026-12-31",
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.reason).toBe("forbidden");
    });

    it("kobler kvittering fra opplastingsruten og avviser ukjent fil", async () => {
      const storedName = `${unique("kvittering")}.pdf`;
      await prisma.upload.create({
        data: {
          storedName,
          originalName: "kvittering.pdf",
          mimeType: "application/pdf",
          size: 10,
          ownerType: "USER",
          ownerId: technicianId,
          uploadedById: technicianId,
        },
      });
      const withReceipt = await createExpense(technician, {
        date: "2026-11-04",
        category: "Drivstoff",
        amount: 500,
        vatRate: 25,
        receiptUrl: `/uploads/${storedName}`,
      });
      expect(withReceipt.ok).toBe(true);
      if (withReceipt.ok) {
        const row = await prisma.expense.findUnique({
          where: { id: withReceipt.data.id },
        });
        expect(row?.receiptUrl).toBe(`/uploads/${storedName}`);
      }

      const invalid = await createExpense(technician, {
        date: "2026-11-04",
        category: "Drivstoff",
        amount: 100,
        vatRate: 25,
        receiptUrl: "/uploads/finnes-ikke.pdf",
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.reason).toBe("invalid");
    });

    it("stenger sidetjenestene når modulen er av", async () => {
      await setModule("fieldExpenses", false);
      const off = await listMyExpenses(technician);
      expect(off.ok).toBe(false);
      if (!off.ok) expect(off.reason).toBe("not_found");
      const exportOff = await exportPayroll(officeA, {
        start: "2026-11-01",
        end: "2026-11-30",
      });
      expect(exportOff.ok).toBe(false);
      await setModule("fieldExpenses", true);
    });
  });
});
