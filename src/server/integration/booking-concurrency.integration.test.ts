import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import {
  addDaysUtc,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { osloWallTimeToUtc } from "@/lib/business-hours";
import { createBooking } from "@/server/portal";
import {
  getCustomerAvailability,
  holdBookingSlot,
} from "@/server/availability";
import { expireBookingHolds } from "@/lib/job-worker";
import { confirmBooking } from "@/server/bookings";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const CUSTOMER_COUNT = 20;

let departmentId = "";
let technicianId = "";
const customerIds: string[] = [];
const portalUsers: ServiceActor[] = [];
let requestedDate = "";
let startsAt: Date;
let endsAt: Date;

function actor(row: {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
  departmentId: string | null;
  customerId: string | null;
}): ServiceActor {
  return {
    ...row,
    contactId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: null,
  };
}

function officeActor(): ServiceActor {
  return {
    id: "it-office",
    name: "Kontoret",
    email: "office@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId,
    customerId: null,
    contactId: null,
    permissions: ["workorders.view", "workorders.assign", "workorders.edit"],
    permissionsCustomized: true,
    roleDefinition: null,
  };
}

beforeAll(async () => {
  departmentId = unique("IT-avdeling");
  await prisma.department.create({
    data: { id: departmentId, name: departmentId, isActive: true },
  });
  await prisma.businessHours.createMany({
    data: Array.from({ length: 5 }, (_, weekday) => ({
      departmentId,
      weekday,
      openMinute: 8 * 60,
      closeMinute: 16 * 60,
    })),
  });

  const technician = await prisma.user.create({
    data: {
      name: "IT-tekniker",
      email: `${unique("it-tech")}@example.test`,
      role: "TECHNICIAN",
      departmentId,
      isActive: true,
    },
    select: { id: true },
  });
  technicianId = technician.id;
  await prisma.userAvailability.createMany({
    data: Array.from({ length: 5 }, (_, weekday) => ({
      userId: technicianId,
      weekday,
      startMinute: 8 * 60,
      endMinute: 16 * 60,
    })),
  });

  for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
    const customer = await prisma.customer.create({
      data: { name: unique(`IT-kunde-${index}`), departmentId },
      select: { id: true },
    });
    customerIds.push(customer.id);
    const user = await prisma.user.create({
      data: {
        name: `IT-kunde ${index}`,
        email: `${unique(`it-portal-${index}`)}@example.test`,
        role: "CUSTOMER",
        customerId: customer.id,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        departmentId: true,
        customerId: true,
      },
    });
    portalUsers.push(actor(user));
  }

  let date = addDaysUtc(parseDateOnly(todayInOslo())!, 7);
  while ([5, 6].includes((date.getUTCDay() + 6) % 7)) {
    date = addDaysUtc(date, 1);
  }
  requestedDate = toDateOnly(date);
  startsAt = osloWallTimeToUtc(requestedDate, 9 * 60);
  endsAt = osloWallTimeToUtc(requestedDate, 9 * 60 + 30);
});

afterAll(async () => {
  if (!departmentId) return;
  await prisma.bookingHold.deleteMany({
    where: { OR: [{ technicianId }, { customerId: { in: customerIds } }] },
  });
  await prisma.workOrder.deleteMany({
    where: { departmentId },
  });
  await prisma.user.deleteMany({
    where: {
      OR: [{ departmentId }, { customerId: { in: customerIds } }],
    },
  });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.businessHours.deleteMany({ where: { departmentId } });
  await prisma.department.deleteMany({ where: { id: departmentId } });
});

describeIntegration("booking: samtidighet og reservasjoner", () => {
  it("oppretter bare ubekreftede forespørsler selv når 20 kunder sender samme tid", async () => {
    const results = await Promise.all(
      portalUsers.map((user, index) =>
        createBooking(user, {
          title: `IT-samtidig-${index}-${unique("b")}`,
          description: "Samtidighetstest",
          requestedDate,
          requestedFrom: "09:00",
          requestedTo: "09:30",
          contactName: `Kunde ${index}`,
          contactPhone: "12345678",
          technicianId,
          serviceType: "general",
        }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.flatMap((result) => (result.ok ? [result.data.status] : [])),
    ).toEqual(Array(CUSTOMER_COUNT).fill("PENDING"));

    const bookings = await prisma.bookingRequest.count({
      where: { requestedDate: parseDateOnly(requestedDate)! },
    });
    expect(bookings).toBe(CUSTOMER_COUNT);

    expect(
      await prisma.bookingRequest.count({
        where: { status: "CONFIRMED", requestedDate: parseDateOnly(requestedDate)! },
      }),
    ).toBe(0);
    expect(
      await prisma.visit.count({
        where: {
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          workOrder: { departmentId },
        },
      }),
    ).toBe(0);
  });

  it("krever eksplisitt planlegging for en datoforespørsel uten kundens tidsblokk", async () => {
    const customer = portalUsers[1];
    const pending = await createBooking(customer, {
      title: `IT-pending-${unique("b")}`,
      description: "Ønsker helst formiddag",
      requestedDate,
      requestedFrom: "11:00",
      requestedTo: "12:00",
      contactName: "Kunde",
      contactPhone: "12345678",
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.data.status).toBe("PENDING");

    const booking = await prisma.bookingRequest.findUniqueOrThrow({
      where: { workOrderId: pending.data.id },
      select: {
        id: true,
        requestedFrom: true,
        requestedTo: true,
        visitId: true,
        workOrder: { select: { status: true, scheduledFor: true } },
      },
    });
    expect(booking.requestedFrom).toBe("");
    expect(booking.requestedTo).toBe("");
    expect(booking.visitId).toBeNull();
    expect(booking.workOrder.status).toBe("OPEN");
    expect(booking.workOrder.scheduledFor).toEqual(parseDateOnly(requestedDate));

    const notConfirmed = await confirmBooking(officeActor(), {
      bookingId: booking.id,
      technicianId,
    });
    expect(notConfirmed).toEqual({
      ok: false,
      reason: "conflict",
      details: { code: "needs_planning" },
    });
    expect(
      await prisma.visit.count({ where: { workOrderId: pending.data.id } }),
    ).toBe(0);
  });

  it("planlegger og bekrefter en datoforespørsel fra bookingkøen", async () => {
    const pending = await createBooking(portalUsers[2], {
      title: `IT-plan-${unique("b")}`,
      description: "Ønsker helst formiddag",
      requestedDate,
      requestedFrom: "11:00",
      requestedTo: "12:00",
      contactName: "Kunde",
      contactPhone: "12345678",
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;

    const booking = await prisma.bookingRequest.findUniqueOrThrow({
      where: { workOrderId: pending.data.id },
      select: { id: true },
    });
    const plannedStartsAt = osloWallTimeToUtc(requestedDate, 11 * 60);
    const plannedEndsAt = osloWallTimeToUtc(requestedDate, 12 * 60);

    const confirmed = await confirmBooking(officeActor(), {
      bookingId: booking.id,
      technicianId,
      date: requestedDate,
      from: "11:00",
      to: "12:00",
    });
    expect(confirmed.ok).toBe(true);

    const stored = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: booking.id },
      select: {
        status: true,
        confirmedAt: true,
        visitId: true,
        preferredTechnicianId: true,
        workOrder: { select: { status: true, scheduledFor: true } },
        visit: {
          select: {
            status: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            technicians: { select: { userId: true } },
          },
        },
      },
    });
    expect(stored.status).toBe("CONFIRMED");
    expect(stored.confirmedAt).not.toBeNull();
    expect(stored.visitId).not.toBeNull();
    expect(stored.preferredTechnicianId).toBe(technicianId);
    expect(stored.workOrder.status).toBe("PLANNED");
    expect(stored.workOrder.scheduledFor).toEqual(parseDateOnly(requestedDate));
    expect(stored.visit).toMatchObject({
      status: "PLANNED",
      startsAt: plannedStartsAt,
      endsAt: plannedEndsAt,
      allDay: false,
      technicians: [{ userId: technicianId }],
    });
  });

  it("kan bekrefte alle ventende datoforespørsler med kontorets planlegging", async () => {
    const windows = [
      { from: "15:00", to: "15:30" },
      { from: "15:30", to: "16:00" },
    ];
    const created = await Promise.all(
      windows.map((window, index) =>
        createBooking(portalUsers[index], {
          title: `IT-kø-${index}-${unique("b")}`,
          description: "Datoforespørsel uten tidsblokk",
          requestedDate,
          contactName: "Kunde",
          contactPhone: "12345678",
        }),
      ),
    );
    expect(created.every((result) => result.ok)).toBe(true);

    for (const [index, window] of windows.entries()) {
      const booking = created[index];
      if (!booking.ok) return;
      const row = await prisma.bookingRequest.findUniqueOrThrow({
        where: { workOrderId: booking.data.id },
        select: { id: true, status: true, requestedFrom: true },
      });
      expect(row.status).toBe("PENDING");
      expect(row.requestedFrom).toBe("");

      const confirmed = await confirmBooking(officeActor(), {
        bookingId: row.id,
        technicianId,
        date: requestedDate,
        ...window,
      });
      expect(confirmed.ok).toBe(true);
    }
  });

  it("gjenbruker lagret tidsvindu for eldre forespørsler", async () => {
    const pending = await createBooking(portalUsers[3], {
      title: `IT-legacy-${unique("b")}`,
      description: "Eldre bestilling med tid",
      requestedDate,
      requestedFrom: "09:00",
      requestedTo: "10:00",
      contactName: "Kunde",
      contactPhone: "12345678",
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;

    const booking = await prisma.bookingRequest.findUniqueOrThrow({
      where: { workOrderId: pending.data.id },
      select: { id: true, workOrderId: true },
    });
    // Simulerer en eldre rad som ble lagret før portalen sluttet å ta imot tid.
    await prisma.bookingRequest.update({
      where: { id: booking.id },
      data: {
        requestedFrom: "09:00",
        requestedTo: "10:00",
      },
    });

    const confirmed = await confirmBooking(officeActor(), {
      bookingId: booking.id,
      technicianId,
    });
    expect(confirmed.ok).toBe(true);

    const stored = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: booking.id },
      select: {
        status: true,
        visitId: true,
        visit: { select: { startsAt: true, endsAt: true } },
      },
    });
    expect(stored.status).toBe("CONFIRMED");
    expect(stored.visit).toMatchObject({
      startsAt: osloWallTimeToUtc(requestedDate, 9 * 60),
      endsAt: osloWallTimeToUtc(requestedDate, 10 * 60),
    });
  });

  it("tillater bevisst overlapp ved kontorets bekreftelse", async () => {
    const first = await createBooking(portalUsers[4], {
      title: `IT-overlap-a-${unique("b")}`,
      description: "Første oppdrag",
      requestedDate,
      requestedFrom: "13:00",
      requestedTo: "14:00",
      contactName: "Kunde",
      contactPhone: "12345678",
    });
    const second = await createBooking(portalUsers[5], {
      title: `IT-overlap-b-${unique("b")}`,
      description: "Andre oppdrag",
      requestedDate,
      requestedFrom: "13:00",
      requestedTo: "14:00",
      contactName: "Kunde",
      contactPhone: "12345678",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const bookings = await prisma.bookingRequest.findMany({
      where: { workOrderId: { in: [first.data.id, second.data.id] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    expect(bookings).toHaveLength(2);

    const planned = await confirmBooking(officeActor(), {
      bookingId: bookings[0].id,
      technicianId,
      date: requestedDate,
      from: "13:00",
      to: "14:00",
    });
    expect(planned.ok).toBe(true);

    // Overlapp er en opptatt-markering, ikke en hard sperre. Kontoret kan
    // bevisst bekrefte to oppdrag samtidig på samme montør.
    const overlapping = await confirmBooking(officeActor(), {
      bookingId: bookings[1].id,
      technicianId,
      date: requestedDate,
      from: "13:30",
      to: "14:30",
    });
    expect(overlapping.ok).toBe(true);
    expect(
      await prisma.bookingRequest.findUniqueOrThrow({
        where: { id: bookings[1].id },
        select: { status: true, visitId: true },
      }),
    ).toMatchObject({ status: "CONFIRMED", visitId: expect.any(String) });
    expect(
      await prisma.visit.count({
        where: {
          workOrderId: { in: [first.data.id, second.data.id] },
        },
      }),
    ).toBe(2);
  });

  it("frigjør timen når reservasjonen utløper, og blokkerer en aktiv reservasjon", async () => {
    const user = portalUsers[0];
    const site = await prisma.customerSite.create({
      data: {
        customerId: user.customerId!,
        name: unique("IT-sted"),
      },
      select: { id: true },
    });

    const hold = await holdBookingSlot(user, {
      date: requestedDate,
      from: "10:00",
      to: "10:30",
      technicianId,
      siteId: site.id,
    });
    expect(hold.ok).toBe(true);

    const whileHeld = await getCustomerAvailability(user, {
      date: requestedDate,
    });
    expect(whileHeld.ok).toBe(true);
    if (whileHeld.ok) {
      expect(
        whileHeld.data.slots.some(
          (slot) =>
            slot.technicianId === technicianId && slot.from === "10:00",
        ),
      ).toBe(false);
    }

    const deleted = await expireBookingHolds(
      new Date(Date.now() + 10 * 60_000),
    );
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.bookingHold.count({
        where: {
          technicianId,
          startsAt: osloWallTimeToUtc(requestedDate, 10 * 60),
          endsAt: osloWallTimeToUtc(requestedDate, 10 * 60 + 30),
        },
      }),
    ).toBe(0);
  });
});
