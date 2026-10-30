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
  it("gir nøyaktig én bekreftet booking når 20 kunder ber om samme time", async () => {
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

    const confirmed = results.filter((result) => result.ok);
    expect(confirmed).toHaveLength(1);
    if (confirmed[0]?.ok) {
      expect(confirmed[0].data.status).toBe("CONFIRMED");
    }
    expect(results.filter((result) => !result.ok)).toHaveLength(
      CUSTOMER_COUNT - 1,
    );

    const bookings = await prisma.bookingRequest.count({
      where: {
        status: "CONFIRMED",
        preferredTechnicianId: technicianId,
        requestedDate: parseDateOnly(requestedDate)!,
      },
    });
    expect(bookings).toBe(1);

    const visits = await prisma.visit.count({
      where: {
        status: { not: "CANCELLED" },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        technicians: { some: { userId: technicianId } },
        workOrder: { departmentId },
      },
    });
    expect(visits).toBe(1);
  });

  it("bevarer PENDING-køen og lar kontoret bekrefte den mot en montør", async () => {
    const customer = portalUsers[1];
    const pending = await createBooking(customer, {
      title: `IT-pending-${unique("b")}`,
      description: "Eldre forespørsel",
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
      select: { id: true },
    });

    const office: ServiceActor = {
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
    const confirmed = await confirmBooking(office, {
      bookingId: booking.id,
      technicianId,
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.data.already).toBe(false);
      expect(confirmed.data.technicianName).toBe("IT-tekniker");
    }

    const row = await prisma.bookingRequest.findUnique({
      where: { id: booking.id },
      select: {
        status: true,
        visit: {
          select: {
            status: true,
            technicians: { select: { userId: true } },
          },
        },
        workOrder: { select: { status: true } },
      },
    });
    expect(row?.status).toBe("CONFIRMED");
    expect(row?.visit?.status).toBe("PLANNED");
    expect(row?.visit?.technicians).toEqual([{ userId: technicianId }]);
    expect(row?.workOrder.status).toBe("PLANNED");
    expect(
      await prisma.visit.count({ where: { workOrderId: pending.data.id } }),
    ).toBe(1);
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
