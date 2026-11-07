import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import {
  addDaysUtc,
  dateOnlyInOslo,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
} from "@/lib/dates";
import { toVisitCalendarEvent } from "@/lib/calendar-events";
import { summarizeWorkOrderTime } from "@/lib/visit-time";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import {
  createWorkOrder,
  assignTechnician,
  updateWorkOrder,
} from "@/server/work-orders";
import {
  assignVisit,
  finishTravelFrom,
  setVisitStatus,
} from "@/server/visits";
import { startClock } from "@/server/sla";
import { splitMultiDayAllDayVisits } from "@/server/visit-backfill";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "workdays-actor",
    name: "IT Arbeidsdager",
    email: "workdays@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: [
        "workorders.view",
        "workorders.create",
        "workorders.edit",
        "workorders.update",
        "workorders.assign",
      ],
    },
    ...overrides,
  };
}

function orderInput(
  departmentId: string,
  customerId: string,
  scheduledFor: string,
  scheduledTo = "",
  technicianIds: string[] = [],
) {
  return {
    title: unique("IT-arbeidsdag"),
    description: "",
    departmentId,
    customerId,
    contactId: "",
    scheduledFor,
    scheduledTo,
    technicianIds,
    templateIds: [],
    tagNames: [],
  };
}

describeIntegration("Arbeidsdager: én økt per dag", () => {
  let departmentId = "";
  let customerId = "";
  let techA = "";
  let techB = "";
  let office: ServiceActor;
  const createdOrders: string[] = [];

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-arbeidsdag-avd") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-arbeidsdag-kunde"), departmentId },
    });
    customerId = customer.id;

    const [a, b] = await Promise.all([
      prisma.user.create({
        data: {
          name: unique("IT-montør-A"),
          role: "TECHNICIAN",
          departmentId,
          isActive: true,
          permissions: ["workorders.view", "workorders.update"],
          permissionsCustomized: true,
        },
      }),
      prisma.user.create({
        data: {
          name: unique("IT-montør-B"),
          role: "TECHNICIAN",
          departmentId,
          isActive: true,
          permissions: ["workorders.view", "workorders.update"],
          permissionsCustomized: true,
        },
      }),
    ]);
    techA = a.id;
    techB = b.id;
    office = actor({ departmentId });
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({
      where: { id: { in: createdOrders } },
    });
    await prisma.workOrder.deleteMany({ where: { departmentId } });
    await prisma.contract.deleteMany({ where: { departmentId } });
    await prisma.slaPolicy.deleteMany({ where: { departmentId } });
    await prisma.user.deleteMany({ where: { departmentId } });
    await prisma.customer.deleteMany({ where: { departmentId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  async function createOrder(
    overrides: {
      scheduledFor?: string;
      scheduledTo?: string;
      technicianIds?: string[];
    } = {},
  ) {
    const result = await createWorkOrder(
      office as never,
      orderInput(
        departmentId,
        customerId,
        overrides.scheduledFor ?? "2026-12-01",
        overrides.scheduledTo ?? "2026-12-03",
        overrides.technicianIds ?? [techA],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Kunne ikke opprette testoppdrag");
    createdOrders.push(result.id);
    return result.id;
  }

  it("oppretter én heldagsøkt per dag med sekvens og montører", async () => {
    const workOrderId = await createOrder();

    const visits = await prisma.visit.findMany({
      where: { workOrderId },
      orderBy: { sequence: "asc" },
      include: { technicians: { select: { userId: true } } },
    });

    expect(visits).toHaveLength(3);
    expect(visits.map((visit) => visit.sequence)).toEqual([0, 1, 2]);
    expect(
      visits.map((visit) => dateOnlyInOslo(visit.startsAt)),
    ).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    for (const visit of visits) {
      expect(visit.allDay).toBe(true);
      expect(visit.status).toBe("PLANNED");
      expect(visit.technicians.map((technician) => technician.userId)).toEqual([
        techA,
      ]);
    }
  });

  it("legger til og fjerner planlagte dager når perioden endres", async () => {
    const workOrderId = await createOrder({
      scheduledFor: "2026-12-01",
      scheduledTo: "2026-12-02",
    });

    const extended = await updateWorkOrder(office as never, workOrderId, {
      ...orderInput(
        departmentId,
        customerId,
        "2026-12-01",
        "2026-12-04",
        [techA],
      ),
      title: "Utvidet",
    });
    expect(extended.ok).toBe(true);

    let visits = await prisma.visit.findMany({
      where: { workOrderId },
      orderBy: { startsAt: "asc" },
    });
    expect(visits.map((visit) => dateOnlyInOslo(visit.startsAt))).toEqual([
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
    ]);

    const shrunk = await updateWorkOrder(office as never, workOrderId, {
      ...orderInput(
        departmentId,
        customerId,
        "2026-12-02",
        "2026-12-03",
        [techA],
      ),
      title: "Krympet",
    });
    expect(shrunk.ok).toBe(true);

    visits = await prisma.visit.findMany({
      where: { workOrderId },
      orderBy: { startsAt: "asc" },
    });
    expect(visits.map((visit) => dateOnlyInOslo(visit.startsAt))).toEqual([
      "2026-12-02",
      "2026-12-03",
    ]);
  });

  it("beholder neste dag og lar den startes etter at første dag er ferdig", async () => {
    const workOrderId = await createOrder({
      scheduledFor: "2026-12-08",
      scheduledTo: "2026-12-09",
    });
    const [dayOne, dayTwo] = await prisma.visit.findMany({
      where: { workOrderId },
      orderBy: { startsAt: "asc" },
    });

    for (const status of ["EN_ROUTE", "ON_SITE", "DONE"] as const) {
      const result = await setVisitStatus(office, dayOne.id, status);
      expect(result.ok).toBe(true);
    }

    const first = await prisma.visit.findUniqueOrThrow({
      where: { id: dayOne.id },
    });
    const second = await prisma.visit.findUniqueOrThrow({
      where: { id: dayTwo.id },
    });
    expect(first.status).toBe("DONE");
    expect(first.enRouteAt).not.toBeNull();
    expect(first.onSiteAt).not.toBeNull();
    expect(first.doneAt).not.toBeNull();
    expect(second.status).toBe("PLANNED");
    expect(second.enRouteAt).toBeNull();

    const order = await prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrderId },
    });
    // Én fullført dag fullfører ikke hele oppdraget automatisk.
    expect(order.status).not.toBe("COMPLETED");

    expect((await setVisitStatus(office, dayTwo.id, "EN_ROUTE")).ok).toBe(true);
    const next = await prisma.visit.findUniqueOrThrow({
      where: { id: dayTwo.id },
    });
    expect(next.status).toBe("EN_ROUTE");
    expect(next.enRouteAt).not.toBeNull();
  });

  it("avviser krymping som ville fjernet en fullført dag", async () => {
    const workOrderId = await createOrder({
      scheduledFor: "2026-12-15",
      scheduledTo: "2026-12-16",
    });
    const first = await prisma.visit.findFirstOrThrow({
      where: { workOrderId },
      orderBy: { startsAt: "asc" },
    });
    for (const status of ["EN_ROUTE", "ON_SITE", "DONE"] as const) {
      await setVisitStatus(office, first.id, status);
    }

    const result = await updateWorkOrder(office as never, workOrderId, {
      ...orderInput(departmentId, customerId, "2026-12-16", "", [techA]),
      title: "Konflikt",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "ugyldig-data",
      detail: "visits.errors.loggedDayConflict",
    });
    expect(
      await prisma.visit.count({ where: { workOrderId } }),
    ).toBe(2);
  });

  it("speiler arbeidsdagens montører og oppdaterer alle dager ved oppdragstildeling", async () => {
    const workOrderId = await createOrder({
      scheduledFor: "2026-12-21",
      scheduledTo: "2026-12-22",
      technicianIds: [techA],
    });
    const [dayOne, dayTwo] = await prisma.visit.findMany({
      where: { workOrderId },
      orderBy: { startsAt: "asc" },
    });

    const dispatch = await assignVisit(office, dayOne.id, [techB]);
    expect(dispatch.ok).toBe(true);
    let visits = await prisma.visit.findMany({
      where: { workOrderId },
      include: { technicians: { select: { userId: true } } },
      orderBy: { startsAt: "asc" },
    });
    expect(
      visits.map((visit) =>
        visit.technicians.map((technician) => technician.userId).sort(),
      ),
    ).toEqual([[techB], [techB]]);

    // Oppdragsnivået bruker samme regel: alle dager får montøren.
    expect(
      (await assignTechnician(office as never, workOrderId, techA)).ok,
    ).toBe(true);
    visits = await prisma.visit.findMany({
      where: { workOrderId },
      include: { technicians: { select: { userId: true } } },
      orderBy: { startsAt: "asc" },
    });
    expect(
      visits.map((visit) =>
        visit.technicians.map((technician) => technician.userId).sort(),
      ),
    ).toEqual([
      [techA, techB].sort(),
      [techA, techB].sort(),
    ]);

    void dayTwo;
  });

  it("viser faktisk varighet i kalenderen og summerer tid per dag", async () => {
    const workOrderId = await createOrder({
      scheduledFor: "2026-12-28",
      scheduledTo: "2026-12-29",
    });
    const [dayOne] = await prisma.visit.findMany({
      where: { workOrderId },
      orderBy: { startsAt: "asc" },
    });
    for (const status of ["EN_ROUTE", "ON_SITE", "DONE"] as const) {
      await setVisitStatus(office, dayOne.id, status);
    }

    const visits = await prisma.visit.findMany({
      where: { workOrderId },
      include: {
        technicians: { include: { user: { select: { name: true } } } },
        workOrder: { include: { customer: true } },
      },
      orderBy: { startsAt: "asc" },
    });

    const first = visits[0];
    const event = toVisitCalendarEvent(first);
    expect(event?.allDay).toBe(false);
    expect(event?.start).toBe(first.enRouteAt?.toISOString());
    expect(event?.end).toBe(first.doneAt?.toISOString());

    const secondEvent = toVisitCalendarEvent(visits[1]);
    expect(secondEvent?.allDay).toBe(true);
    expect(secondEvent?.start).toBe("2026-12-29");

    const summary = summarizeWorkOrderTime(visits);
    expect(summary.days).toHaveLength(2);
    expect(summary.days[0].date).toBe("2026-12-28");
    expect(summary.days[0].travelToMinutes).not.toBeNull();
    expect(summary.days[0].workMinutes).not.toBeNull();
  });

  it("deler reisetid mellom to jobber, avslutter siste kjøring og summerer alt", async () => {
    const orderA = await createOrder({
      scheduledFor: "2027-01-04",
      scheduledTo: "",
    });
    const orderB = await createOrder({
      scheduledFor: "2027-01-04",
      scheduledTo: "",
    });
    const [visitA] = await prisma.visit.findMany({
      where: { workOrderId: orderA },
    });
    const [visitB] = await prisma.visit.findMany({
      where: { workOrderId: orderB },
    });

    for (const status of ["EN_ROUTE", "ON_SITE", "DONE"] as const) {
      expect((await setVisitStatus(office, visitA.id, status)).ok).toBe(true);
    }

    // Neste jobb starter reisen: samme tidspunkt blir returkjøring for A.
    expect((await setVisitStatus(office, visitB.id, "EN_ROUTE")).ok).toBe(true);
    const closedA = await prisma.visit.findUniqueOrThrow({
      where: { id: visitA.id },
    });
    const startedB = await prisma.visit.findUniqueOrThrow({
      where: { id: visitB.id },
    });
    expect(closedA.travelFromEndedAt).toEqual(startedB.enRouteAt);

    for (const status of ["ON_SITE", "DONE"] as const) {
      expect((await setVisitStatus(office, visitB.id, status)).ok).toBe(true);
    }
    // Siste jobb på dagen lukkes eksplisitt.
    expect((await finishTravelFrom(office, visitB.id)).ok).toBe(true);

    const finished = await prisma.visit.findMany({
      where: { id: { in: [visitA.id, visitB.id] } },
      include: {
        technicians: { include: { user: { select: { name: true } } } },
        workOrder: { include: { customer: true } },
      },
      orderBy: { startsAt: "asc" },
    });
    const summary = summarizeWorkOrderTime(finished);
    expect(summary.sessions).toBe(2);
    expect(summary.travelToMinutes).toBeGreaterThanOrEqual(0);
    expect(summary.travelFromMinutes).toBeGreaterThanOrEqual(0);
    expect(summary.totalMinutes).toBe(
      summary.travelToMinutes +
        summary.workMinutes +
        summary.travelFromMinutes,
    );

    const event = toVisitCalendarEvent(finished[0]);
    expect(event?.allDay).toBe(false);
    expect(event?.start).toBe(finished[0].enRouteAt?.toISOString());
    expect(event?.end).toBe(finished[0].travelFromEndedAt?.toISOString());
  });
});

describeIntegration("SLA uten aktiv avtale", () => {
  let departmentId = "";
  let customerId = "";
  let policyId = "";
  let contractId = "";
  let office: ServiceActor;
  const createdOrders: string[] = [];

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-sla-avd") },
    });
    departmentId = department.id;
    const customer = await prisma.customer.create({
      data: { name: unique("IT-sla-kunde"), departmentId },
    });
    customerId = customer.id;
    office = actor({ departmentId });

    const policy = await prisma.slaPolicy.create({
      data: {
        name: unique("IT-sla-policy"),
        departmentId,
        responseMinutes: 30,
        resolutionMinutes: 120,
        businessHoursOnly: false,
      },
    });
    policyId = policy.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({
      where: { OR: [{ id: { in: createdOrders } }, { departmentId }] },
    });
    await prisma.contract.deleteMany({ where: { departmentId } });
    await prisma.slaPolicy.deleteMany({ where: { departmentId } });
    await prisma.user.deleteMany({ where: { departmentId } });
    await prisma.customer.deleteMany({ where: { departmentId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    void contractId;
  });

  async function createOrder(scheduledFor = "2026-12-01") {
    const result = await createWorkOrder(
      office as never,
      orderInput(departmentId, customerId, scheduledFor),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Kunne ikke opprette testoppdrag");
    createdOrders.push(result.id);
    return result.id;
  }

  it("starter ingen klokke uten avtale, heller ikke med eksplisitt policy", async () => {
    const workOrderId = await createOrder();
    expect(
      await prisma.slaClock.count({ where: { workOrderId } }),
    ).toBe(0);

    const explicit = await prisma.$transaction((tx) =>
      startClock(tx, workOrderId, { policyId }),
    );
    expect(explicit).toBeNull();
  });

  it("starter klokke når kunden har aktiv avtale med aktiv SLA-policy", async () => {
    const now = new Date();
    const contract = await prisma.contract.create({
      data: {
        title: unique("IT-sla-avtale"),
        intervalMonths: 12,
        startDate: osloDayStart(toDateOnly(addDaysUtc(now, -30))),
        nextServiceDate: osloDayStart(toDateOnly(addDaysUtc(now, 300))),
        customerId,
        departmentId,
        slaPolicyId: policyId,
        status: "ACTIVE",
        isActive: true,
      },
    });
    contractId = contract.id;

    const workOrderId = await createOrder("2026-12-02");
    const clock = await prisma.slaClock.findFirst({
      where: { workOrderId },
    });
    expect(clock?.policyId).toBe(policyId);
  });

  it("starter ikke klokke når avtalens policy er deaktivert", async () => {
    await prisma.slaPolicy.update({
      where: { id: policyId },
      data: { isActive: false },
    });
    const workOrderId = await createOrder("2026-12-03");
    expect(
      await prisma.slaClock.count({ where: { workOrderId } }),
    ).toBe(0);
    await prisma.slaPolicy.update({
      where: { id: policyId },
      data: { isActive: true },
    });
  });
});

describeIntegration("Backfill av flerdagersvisiter", () => {
  let departmentId = "";
  let customerId = "";
  let technicianId = "";
  let workOrderId = "";
  let multiDayVisitId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-backfill-avd") },
    });
    departmentId = department.id;
    const customer = await prisma.customer.create({
      data: { name: unique("IT-backfill-kunde"), departmentId },
    });
    customerId = customer.id;
    const technician = await prisma.user.create({
      data: {
        name: unique("IT-backfill-montør"),
        role: "TECHNICIAN",
        departmentId,
        isActive: true,
        permissions: [],
        permissionsCustomized: true,
      },
    });
    technicianId = technician.id;

    const order = await prisma.workOrder.create({
      data: {
        reference: unique("REF"),
        title: unique("IT-backfill-oppdrag"),
        departmentId,
        customerId,
        status: "OPEN",
        scheduledFor: parseDateOnly("2026-12-10"),
        scheduledTo: parseDateOnly("2026-12-12"),
        technicians: { connect: { id: technicianId } },
      },
    });
    workOrderId = order.id;

    const visit = await prisma.visit.create({
      data: {
        workOrderId,
        sequence: 0,
        startsAt: osloDayStart("2026-12-10"),
        endsAt: osloDayStart("2026-12-13"),
        allDay: true,
        status: "DONE",
        enRouteAt: new Date("2026-12-10T07:00:00.000Z"),
        onSiteAt: new Date("2026-12-10T07:30:00.000Z"),
        doneAt: new Date("2026-12-10T11:00:00.000Z"),
        technicians: { create: [{ userId: technicianId }] },
      },
    });
    multiDayVisitId = visit.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.user.deleteMany({ where: { departmentId } });
    await prisma.customer.deleteMany({ where: { departmentId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("deler i dagsøkter og beholder tidsloggen på første dag", async () => {
    const dry = await splitMultiDayAllDayVisits(prisma, { dryRun: true });
    expect(dry.split).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.visit.count({ where: { workOrderId } }),
    ).toBe(1);

    const applied = await splitMultiDayAllDayVisits(prisma);
    expect(applied.split).toBeGreaterThanOrEqual(1);

    const visits = await prisma.visit.findMany({
      where: { workOrderId },
      orderBy: { startsAt: "asc" },
      include: { technicians: { select: { userId: true } } },
    });
    expect(visits).toHaveLength(3);
    expect(dateOnlyInOslo(visits[0].startsAt)).toBe("2026-12-10");
    expect(dateOnlyInOslo(visits[0].endsAt)).toBe("2026-12-11");
    expect(visits[0].status).toBe("DONE");
    expect(visits[0].doneAt).not.toBeNull();
    expect(visits[0].id).toBe(multiDayVisitId);

    for (const day of visits.slice(1)) {
      expect(day.status).toBe("PLANNED");
      expect(day.enRouteAt).toBeNull();
      expect(day.onSiteAt).toBeNull();
      expect(day.doneAt).toBeNull();
      expect(day.travelFromEndedAt).toBeNull();
      expect(day.technicians.map((technician) => technician.userId)).toEqual([
        technicianId,
      ]);
    }

    // Idempotent: andre kjøring deler ingenting på nytt.
    const second = await splitMultiDayAllDayVisits(prisma);
    expect(second.created).toBe(0);
    expect(
      await prisma.visit.count({ where: { workOrderId } }),
    ).toBe(3);
  });
});
