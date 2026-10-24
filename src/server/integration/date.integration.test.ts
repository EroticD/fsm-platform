import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { toDateOnly } from "@/lib/dates";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("Dato-kolonner: date round-trip", () => {
  let departmentId = "";
  let customerId = "";
  let workOrderId = "";
  let contractId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-dato-avdeling") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-dato-kunde"), departmentId },
    });
    customerId = customer.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-dato-oppdrag"),
        departmentId,
        customerId,
        status: "OPEN",
        scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
        scheduledTo: new Date("2026-10-21T00:00:00.000Z"),
      },
    });
    workOrderId = workOrder.id;

    const contract = await prisma.contract.create({
      data: {
        title: unique("IT-dato-avtale"),
        intervalMonths: 3,
        startDate: new Date("2026-01-31T00:00:00.000Z"),
        nextServiceDate: new Date("2026-04-30T00:00:00.000Z"),
        customerId,
        departmentId,
      },
    });
    contractId = contract.id;
  });

  afterAll(async () => {
    await prisma.contract.deleteMany({ where: { id: contractId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("lagrer og leser kalenderdatoer uten klokkeslett", async () => {
    const workOrder = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { scheduledFor: true, scheduledTo: true },
    });
    expect(toDateOnly(workOrder?.scheduledFor)).toBe("2026-10-19");
    expect(toDateOnly(workOrder?.scheduledTo)).toBe("2026-10-21");

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { startDate: true, nextServiceDate: true },
    });
    expect(toDateOnly(contract?.startDate)).toBe("2026-01-31");
    expect(toDateOnly(contract?.nextServiceDate)).toBe("2026-04-30");
  });
});
