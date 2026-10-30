import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { osloDayStart, toDateOnly } from "@/lib/dates";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import {
  createDefaultVisit,
  recomputeWorkOrderSchedule,
} from "@/server/visits";

const describeIntegration = integrationEnabled ? describe : describe.skip;

/**
 * Verifiserer at visittene er den planlagte sannheten og at de avledede
 * datofeltene følger min/maks uten å flytte en heldagsvisitt over midnatt.
 */
describeIntegration("Visiter: avledet datoperiode", () => {
  let departmentId = "";
  let customerId = "";
  let workOrderId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-visitt-avdeling") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-visitt-kunde"), departmentId },
    });
    customerId = customer.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-visitt-oppdrag"),
        departmentId,
        customerId,
        status: "OPEN",
        scheduledFor: new Date("2026-10-30T00:00:00.000Z"),
        scheduledTo: null,
      },
    });
    workOrderId = workOrder.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("avleder datoene fra én eller flere visiter", async () => {
    await prisma.$transaction(async (tx) => {
      await createDefaultVisit(tx, {
        workOrderId,
        startsAt: osloDayStart("2026-10-30"),
        endsAt: osloDayStart("2026-10-31"),
        allDay: true,
      });
      await recomputeWorkOrderSchedule(tx, workOrderId);
    });

    let order = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { scheduledFor: true, scheduledTo: true },
    });
    expect(toDateOnly(order?.scheduledFor)).toBe("2026-10-30");
    expect(toDateOnly(order?.scheduledTo)).toBe("2026-10-30");

    await prisma.visit.create({
      data: {
        workOrderId,
        startsAt: osloDayStart("2026-11-02"),
        endsAt: osloDayStart("2026-11-03"),
        allDay: true,
      },
    });
    await prisma.$transaction((tx) => recomputeWorkOrderSchedule(tx, workOrderId));

    order = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { scheduledFor: true, scheduledTo: true },
    });
    expect(toDateOnly(order?.scheduledFor)).toBe("2026-10-30");
    expect(toDateOnly(order?.scheduledTo)).toBe("2026-11-02");
  });

  it("fjerner avledede datoer når alle visiter slettes", async () => {
    await prisma.visit.deleteMany({ where: { workOrderId } });
    await prisma.$transaction((tx) => recomputeWorkOrderSchedule(tx, workOrderId));

    const order = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { scheduledFor: true, scheduledTo: true },
    });
    expect(order?.scheduledFor).toBeNull();
    expect(order?.scheduledTo).toBeNull();
  });
});
