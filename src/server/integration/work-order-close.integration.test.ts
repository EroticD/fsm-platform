import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { transitionWorkOrderStatus } from "@/lib/work-order-status-action";

/**
 * Vakt på livssyklusen ved lukking og gjenåpning.
 *
 * Enhetstestene asserterer på mock-kall og så derfor ikke at radene faktisk
 * ender i riktig tilstand. Denne testen lukker via den ekte tjenesten og leser
 * databasen etterpå. Det er nivået der 0.9.2-feilen ville blitt fanget.
 */
const describeIntegration = integrationEnabled ? describe : describe.skip;

const actor = { id: "it-close-actor", name: "Test", email: "test@example.test" };

describeIntegration("Lukking og gjenåpning av oppdrag", () => {
  let departmentId = "";
  let customerId = "";
  let policyId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-close-avd") },
    });
    departmentId = department.id;
    const customer = await prisma.customer.create({
      data: { name: unique("IT-close-kunde"), departmentId },
    });
    customerId = customer.id;
    const policy = await prisma.slaPolicy.create({
      data: {
        name: unique("IT-close-policy"),
        departmentId,
        responseMinutes: 30,
        resolutionMinutes: 120,
        businessHoursOnly: false,
      },
    });
    policyId = policy.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({ where: { departmentId } });
    await prisma.contract.deleteMany({ where: { departmentId } });
    await prisma.slaPolicy.deleteMany({ where: { departmentId } });
    await prisma.customer.deleteMany({ where: { departmentId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  async function activeWorkOrder() {
    const startsAt = new Date(Date.now() - 60 * 60_000);
    const workOrder = await prisma.workOrder.create({
      data: {
        reference: unique("REF-CLOSE"),
        title: unique("IT-close-oppdrag"),
        departmentId,
        customerId,
        status: "IN_PROGRESS",
        scheduledFor: startsAt,
      },
      select: { id: true },
    });
    const visit = await prisma.visit.create({
      data: {
        workOrderId: workOrder.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 60 * 60_000),
        status: "ON_SITE",
        onSiteAt: startsAt,
      },
      select: { id: true },
    });
    const link = await prisma.trackingLink.create({
      data: {
        tokenHash: unique("hash"),
        workOrderId: workOrder.id,
        visitId: visit.id,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
      select: { id: true },
    });
    const clock = await prisma.slaClock.create({
      data: {
        workOrderId: workOrder.id,
        policyId,
        startedAt: startsAt,
        respondBy: new Date(startsAt.getTime() + 30 * 60_000),
        resolveBy: new Date(startsAt.getTime() + 120 * 60_000),
        state: "ON_TRACK",
      },
      select: { id: true },
    });
    return { workOrder, visit, link, clock };
  }

  it("rydder visitt, returkjøring, sporing og SLA når oppdraget fullføres", async () => {
    const { workOrder, visit, link, clock } = await activeWorkOrder();

    const result = await transitionWorkOrderStatus({
      workOrderId: workOrder.id,
      from: "IN_PROGRESS",
      to: "COMPLETED",
      isAdmin: false,
      actor,
      action: "Fullførte oppdraget",
    });

    expect(result).toEqual({ ok: true });
    const storedVisit = await prisma.visit.findUnique({
      where: { id: visit.id },
      select: { status: true, doneAt: true, travelFromEndedAt: true },
    });
    expect(storedVisit?.status).toBe("DONE");
    expect(storedVisit?.doneAt).toBeInstanceOf(Date);
    expect(storedVisit?.travelFromEndedAt).toBeInstanceOf(Date);
    const storedLink = await prisma.trackingLink.findUnique({
      where: { id: link.id },
      select: { revokedAt: true },
    });
    expect(storedLink?.revokedAt).toBeInstanceOf(Date);
    const storedClock = await prisma.slaClock.findUnique({
      where: { id: clock.id },
      select: { resolvedAt: true },
    });
    expect(storedClock?.resolvedAt).toBeInstanceOf(Date);
  });

  it("gir gjenåpnet oppdrag en aktiv visitt igjen", async () => {
    const { workOrder, visit } = await activeWorkOrder();
    await transitionWorkOrderStatus({
      workOrderId: workOrder.id,
      from: "IN_PROGRESS",
      to: "COMPLETED",
      isAdmin: false,
      actor,
      action: "Fullførte oppdraget",
    });

    const reopened = await transitionWorkOrderStatus({
      workOrderId: workOrder.id,
      from: "COMPLETED",
      to: "IN_PROGRESS",
      isAdmin: true,
      force: true,
      actor,
      action: "Gjenåpnet oppdraget",
    });

    expect(reopened).toEqual({ ok: true });
    const storedVisit = await prisma.visit.findUnique({
      where: { id: visit.id },
      select: { status: true, doneAt: true },
    });
    expect(storedVisit).toEqual({ status: "PLANNED", doneAt: null });
    const storedOrder = await prisma.workOrder.findUnique({
      where: { id: workOrder.id },
      select: { status: true },
    });
    expect(storedOrder?.status).toBe("IN_PROGRESS");
  });
});
