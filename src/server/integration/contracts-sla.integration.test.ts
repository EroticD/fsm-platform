import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { addDaysUtc, osloDayStart, toDateOnly } from "@/lib/dates";
import type { ServiceActor } from "@/server/actor";
import {
  coverageFor,
  createContract,
  listContracts,
  runContractLifecycle,
} from "@/server/contracts";
import {
  markResolved,
  markResponded,
  startClock,
  sweepSlaClocks,
} from "@/server/sla";
import {
  createDefaultVisit,
  recomputeWorkOrderSchedule,
  setVisitStatus,
} from "@/server/visits";
import { createWorkOrder } from "@/server/work-orders";
import { getCustomerDetail } from "@/server/customers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "IT Aktør",
    email: "it@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: [
        "contracts.view",
        "contracts.manage",
        "sla.manage",
        "workorders.view",
        "workorders.create",
        "workorders.update",
        "reports.view",
        "customers.view",
      ],
    },
    ...overrides,
  };
}

describeIntegration("Avtaler, dekning og SLA", () => {
  let departmentA = "";
  let departmentB = "";
  let customer = "";
  let productA = "";
  let productB = "";
  let policy = "";
  let user = "";
  let contractA = "";
  let contractB = "";
  let workOrder = "";
  let officeActor: ServiceActor;

  beforeAll(async () => {
    const deptA = await prisma.department.create({
      data: { name: unique("IT-avtale-avd-A") },
    });
    const deptB = await prisma.department.create({
      data: { name: unique("IT-avtale-avd-B") },
    });
    departmentA = deptA.id;
    departmentB = deptB.id;

    const customerRow = await prisma.customer.create({
      data: { name: unique("IT-avtale-kunde"), departmentId: departmentA },
    });
    customer = customerRow.id;

    const [a, b] = await Promise.all([
      prisma.product.create({
        data: { model: unique("Pumpe-A"), customerId: customer, location: "A" },
      }),
      prisma.product.create({
        data: { model: unique("Pumpe-B"), customerId: customer, location: "B" },
      }),
    ]);
    productA = a.id;
    productB = b.id;

    const policyRow = await prisma.slaPolicy.create({
      data: {
        name: unique("IT-SLA"),
        departmentId: departmentA,
        responseMinutes: 60,
        resolutionMinutes: 240,
        businessHoursOnly: false,
      },
    });
    policy = policyRow.id;

    const staff = await prisma.user.create({
      data: {
        name: unique("IT-sak"),

        role: "OFFICE",
        isActive: true,
        departmentId: departmentA,
        permissions: [],
        permissionsCustomized: false,
      },
    });
    user = staff.id;

    const office = actor({
      id: user,
      name: staff.name,
      email: staff.email,
      departmentId: departmentA,
    });
    officeActor = office;

    const createdA = await createContract(office, customer, {
      title: unique("IT-avtale-A"),
      startDate: toDateOnly(new Date()),
      endDate: null,
      intervalMonths: 12,
      departmentId: departmentA,
      slaPolicyId: policy,
      renewalMode: "MANUAL",
      lines: [
        { productId: productA, scope: "Pumpe A" },
        { productId: null, scope: "Alt utstyr" },
      ],
    });
    if (!createdA.ok) throw new Error("Kunne ikke opprette avtale A");
    contractA = createdA.data.id;

    const createdB = await createContract(
      actor({ departmentId: departmentB }),
      customer,
      {
        title: unique("IT-avtale-B"),
        startDate: toDateOnly(new Date()),
        intervalMonths: 12,
        departmentId: departmentB,
      },
    );
    if (!createdB.ok) throw new Error("Kunne ikke opprette avtale B");
    contractB = createdB.data.id;

    // Egen manuell ordre uten avtalekobling; SLA-klokken får policyen
    // eksplisitt. Da kolliderer den ikke med avtalens genererte oppdrag.
    const scheduled = addDaysUtc(new Date(), 1);
    const order = await prisma.workOrder.create({
      data: {
        title: unique("IT-SLA-oppdrag"),
        departmentId: departmentA,
        customerId: customer,
        status: "OPEN",
        scheduledFor: osloDayStart(toDateOnly(scheduled)),
      },
    });
    workOrder = order.id;
    await prisma.$transaction(async (tx) => {
      await createDefaultVisit(tx, {
        workOrderId: order.id,
        startsAt: osloDayStart(toDateOnly(scheduled)),
        endsAt: osloDayStart(toDateOnly(addDaysUtc(scheduled, 1))),
        allDay: true,
      });
      await recomputeWorkOrderSchedule(tx, order.id);
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: user } });
    await prisma.workOrder.deleteMany({
      where: {
        OR: [
          { id: workOrder },
          { contractId: { in: [contractA, contractB] } },
        ],
      },
    });
    await prisma.contract.deleteMany({
      where: { id: { in: [contractA, contractB] } },
    });
    await prisma.slaPolicy.deleteMany({ where: { id: policy } });
    await prisma.user.deleteMany({ where: { id: user } });
    await prisma.product.deleteMany({
      where: { id: { in: [productA, productB] } },
    });
    await prisma.customer.deleteMany({ where: { id: customer } });
    await prisma.department.deleteMany({
      where: { id: { in: [departmentA, departmentB] } },
    });
  });

  it("starter klokken, registrerer respons og løsning", async () => {
    const now = new Date("2026-10-30T08:00:00.000Z");
    const started = await prisma.$transaction((tx) =>
      startClock(tx, workOrder, { policyId: policy, now }),
    );
    expect(started).not.toBeNull();

    let clock = await prisma.slaClock.findFirstOrThrow({
      where: { workOrderId: workOrder, policyId: policy },
    });
    expect(clock.respondedAt).toBeNull();
    expect(clock.state).toBe("ON_TRACK");

    const respondedAt = new Date("2026-10-30T08:30:00.000Z");
    await prisma.$transaction((tx) =>
      markResponded(tx, workOrder, respondedAt),
    );
    clock = await prisma.slaClock.findFirstOrThrow({
      where: { workOrderId: workOrder, policyId: policy },
    });
    expect(clock.respondedAt).toEqual(respondedAt);
    expect(clock.state).toBe("ON_TRACK");

    const resolvedAt = new Date("2026-10-30T11:00:00.000Z");
    await prisma.$transaction((tx) => markResolved(tx, workOrder, resolvedAt));
    clock = await prisma.slaClock.findFirstOrThrow({
      where: { workOrderId: workOrder, policyId: policy },
    });
    expect(clock.resolvedAt).toEqual(resolvedAt);
    expect(clock.state).toBe("MET");
  });

  it("reagerer på første EN_ROUTE og løser på DONE", async () => {
    const now = Date.now();
    await prisma.slaClock.updateMany({
      where: { workOrderId: workOrder },
      data: {
        respondedAt: null,
        resolvedAt: null,
        state: "ON_TRACK",
        breachedAt: null,
        startedAt: new Date(now),
        respondBy: new Date(now + 60 * 60_000),
        resolveBy: new Date(now + 4 * 60 * 60_000),
      },
    });
    const visit = await prisma.visit.findFirstOrThrow({
      where: { workOrderId: workOrder },
    });

    const enRoute = await setVisitStatus(officeActor, visit.id, "EN_ROUTE");
    expect(enRoute.ok).toBe(true);
    let clock = await prisma.slaClock.findFirstOrThrow({
      where: { workOrderId: workOrder },
    });
    expect(clock.respondedAt).not.toBeNull();
    const firstResponse = clock.respondedAt;

    const onSite = await setVisitStatus(officeActor, visit.id, "ON_SITE");
    expect(onSite.ok).toBe(true);
    clock = await prisma.slaClock.findFirstOrThrow({
      where: { workOrderId: workOrder },
    });
    expect(clock.respondedAt).toEqual(firstResponse);

    const done = await setVisitStatus(officeActor, visit.id, "DONE");
    expect(done.ok).toBe(true);
    clock = await prisma.slaClock.findFirstOrThrow({
      where: { workOrderId: workOrder },
    });
    expect(clock.resolvedAt).not.toBeNull();
    expect(clock.state).toBe("MET");
  });

  it("starter klokken når et nytt oppdrag opprettes for en aktiv avtale", async () => {
    const result = await createWorkOrder(
      officeActor as never,
      {
        title: unique("IT-ny-SLA-ordre"),
        description: "",
        departmentId: departmentA,
        customerId: customer,
        contactId: "",
        scheduledFor: toDateOnly(new Date()),
        scheduledTo: "",
        technicianIds: [],
        templateIds: [],
        tagNames: [],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const clock = await prisma.slaClock.findFirst({
      where: { workOrderId: result.id },
    });
    expect(clock?.policyId).toBe(policy);
    expect(clock?.state).toBe("ON_TRACK");

    await prisma.workOrder.delete({ where: { id: result.id } });
  });

  it("sveiper brudd idempotent og varsler bare én gang", async () => {
    await prisma.slaClock.deleteMany({ where: { workOrderId: workOrder } });
    await prisma.notification.deleteMany({ where: { userId: user } });

    const startedAt = new Date("2026-10-30T08:00:00.000Z");
    await prisma.slaClock.create({
      data: {
        workOrderId: workOrder,
        policyId: policy,
        startedAt,
        // Bevisst gamle frister; sveipingen regner dem ut på nytt.
        respondBy: new Date("2026-10-30T09:00:00.000Z"),
        resolveBy: new Date("2026-10-30T12:00:00.000Z"),
        state: "ON_TRACK",
      },
    });

    const now = new Date("2026-10-30T15:00:00.000Z");
    const first = await sweepSlaClocks(now);
    const second = await sweepSlaClocks(now);
    expect(first.breached).toBeGreaterThanOrEqual(1);
    // Klokkene blir liggende som BREACHED og sveipes fortsatt, men ingen ny
    // overgang skjer og dermed ingen ny varselrad.
    expect(second.notified).toBe(0);

    const notifications = await prisma.notification.findMany({
      where: { userId: user, type: "SLA_BREACHED" },
    });
    expect(notifications).toHaveLength(1);

    const clock = await prisma.slaClock.findFirstOrThrow({
      where: { workOrderId: workOrder },
    });
    expect(clock.state).toBe("BREACHED");
    expect(clock.breachedAt).not.toBeNull();
  });

  it("fornyer automatisk nøyaktig én gang ved samtidige kjøringer", async () => {
    const intervalMonths = 12;
    const startDate = new Date("2025-10-30T00:00:00.000Z");
    const endDate = new Date("2026-10-29T00:00:00.000Z");
    const auto = await prisma.contract.create({
      data: {
        title: unique("IT-auto-forny"),
        startDate,
        endDate,
        intervalMonths,
        nextServiceDate: new Date("2026-10-30T00:00:00.000Z"),
        status: "ACTIVE",
        isActive: true,
        renewalMode: "AUTO",
        customerId: customer,
        departmentId: departmentA,
      },
    });

    const now = new Date("2026-10-30T12:00:00.000Z");
    const [first, second] = await Promise.all([
      runContractLifecycle(now),
      runContractLifecycle(now),
    ]);
    expect(first.renewed + second.renewed).toBe(1);
    expect(first.expired + second.expired).toBe(0);

    const renewed = await prisma.contract.findUniqueOrThrow({
      where: { id: auto.id },
    });
    expect(toDateOnly(renewed.endDate)).toBe("2027-10-30");
    expect(renewed.status).toBe("ACTIVE");

    const orders = await prisma.workOrder.findMany({
      where: { contractId: auto.id },
      select: { id: true },
    });
    expect(orders).toHaveLength(1);

    await prisma.workOrder.deleteMany({ where: { contractId: auto.id } });
    await prisma.contract.delete({ where: { id: auto.id } });
  });

  it("dekning respekterer produkt og dato", async () => {
    const now = new Date("2026-10-30T12:00:00.000Z");
    const coveredA = await coverageFor(customer, productA, now);
    const coveredB = await coverageFor(customer, productB, now);
    expect(coveredA.covered).toBe(true);
    expect(coveredB.covered).toBe(true);

    // Avtale B dekker alt utstyr, så begge må utløpe for at kunden skal være
    // uten dekning.
    await prisma.contract.updateMany({
      where: { id: { in: [contractA, contractB] } },
      data: {
        endDate: new Date("2026-10-01T00:00:00.000Z"),
        status: "EXPIRED",
        isActive: false,
      },
    });
    const expired = await coverageFor(customer, productA, now);
    expect(expired.covered).toBe(false);

    await prisma.contract.updateMany({
      where: { id: { in: [contractA, contractB] } },
      data: {
        endDate: new Date("2027-10-01T00:00:00.000Z"),
        status: "ACTIVE",
        isActive: true,
      },
    });
    const future = await coverageFor(customer, productA, new Date("2028-01-01T00:00:00.000Z"));
    expect(future.covered).toBe(false);
  });

  it("skjuler avtaler i andre avdelinger", async () => {
    const result = await listContracts(
      actor({ departmentId: departmentA }),
      { pageSize: 100 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.contracts.map((contract) => contract.id);
    expect(ids).toContain(contractA);
    expect(ids).not.toContain(contractB);
  });

  it("filtrerer avtalefanen på kundekortet etter avdeling (C-05)", async () => {
    const detail = await getCustomerDetail(officeActor, customer, {
      tab: "avtaler",
      orderPage: 1,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    const ids = detail.data.customer.contracts.map((contract) => contract.id);
    expect(ids).toContain(contractA);
    expect(ids).not.toContain(contractB);
    expect(detail.data.customer._count.contracts).toBe(1);
  });

  it("oppretter avtalelinjer med produktvalidering", async () => {
    const line = await prisma.contractLine.findFirst({
      where: { contractId: contractA, productId: productA },
    });
    expect(line?.scope).toBe("Pumpe A");
  });
});
