import { beforeEach, describe, expect, it, vi } from "vitest";
import { osloWallTimeToUtc } from "@/lib/business-hours";
import { parseDateOnly } from "@/lib/dates";
import type { ServiceActor } from "./actor";

const DATE = "2026-11-10";

const mocks = vi.hoisted(() => ({
  prisma: {
    bookingRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    user: { findMany: vi.fn() },
    visit: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({
        _min: { startsAt: null },
        _max: { endsAt: null },
      })),
      create: vi.fn(),
    },
    trackingLink: { updateMany: vi.fn(async () => ({ count: 0 })) },
    slaClock: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    visitTechnician: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    workOrder: { updateMany: vi.fn(), update: vi.fn() },
    bookingRequestEvent: { create: vi.fn() },
  },
  runSerializable: vi.fn(),
  lockTechnicians: vi.fn(),
  assertTechnicianSlotAvailable: vi.fn(),
  listAvailableTechniciansForWindow: vi.fn(),
  audit: vi.fn(),
  notifyWorkOrderEvent: vi.fn(),
  trySendBookingConfirmedSms: vi.fn(),
  enqueueBookingEmail: vi.fn(),
  recomputeWorkOrderSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("./availability", () => ({
  runSerializable: mocks.runSerializable,
  lockTechnicians: mocks.lockTechnicians,
  assertTechnicianSlotAvailable: mocks.assertTechnicianSlotAvailable,
  listAvailableTechniciansForWindow: mocks.listAvailableTechniciansForWindow,
}));
vi.mock("./visits", () => ({
  recomputeWorkOrderSchedule: mocks.recomputeWorkOrderSchedule,
}));
vi.mock("./notifications", () => ({
  notifyWorkOrderEvent: mocks.notifyWorkOrderEvent,
}));
vi.mock("./sms-events", () => ({
  trySendBookingConfirmedSms: mocks.trySendBookingConfirmedSms,
}));
vi.mock("./email-outbox", () => ({
  enqueueBookingEmail: mocks.enqueueBookingEmail,
}));

import { cancelBookingFromOffice, confirmBooking, listBookingQueue } from "./bookings";

const office = (overrides: Partial<ServiceActor> = {}): ServiceActor => ({
  id: "office-1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
  customerId: null,
  contactId: null,
  permissions: ["workorders.view", "workorders.edit", "workorders.assign"],
  permissionsCustomized: true,
  roleDefinition: null,
  ...overrides,
});

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "br-1",
    reference: "B-TEST-1",
    status: "PENDING",
    requestedDate: parseDateOnly(DATE)!,
    requestedFrom: "",
    requestedTo: "",
    visitId: null,
    workOrder: {
      id: "wo-1",
      title: "Årlig service",
      status: "OPEN",
      departmentId: "dep-1",
      deletedAt: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runSerializable.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) =>
      callback(mocks.prisma),
  );
  mocks.prisma.bookingRequest.findFirst.mockResolvedValue(booking());
  mocks.prisma.bookingRequest.findUnique.mockResolvedValue({
    workOrderId: "wo-1",
    reference: "B-TEST-1",
    customerId: "cust-1",
    requestedDate: parseDateOnly(DATE)!,
    requestedFrom: "09:00",
    requestedTo: "10:30",
    customer: { name: "Kunde AS" },
    workOrder: { title: "Årlig service", contactId: null },
  });
  mocks.prisma.bookingRequest.update.mockResolvedValue({ id: "br-1" });
  mocks.prisma.user.findMany.mockResolvedValue([
    { id: "tech-1", name: "Tina Tekniker" },
  ]);
  mocks.prisma.visit.findMany.mockResolvedValue([]);
  mocks.prisma.visit.create.mockResolvedValue({ id: "visit-1" });
  mocks.prisma.visit.update.mockResolvedValue({ id: "visit-1" });
  mocks.prisma.visitTechnician.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.visitTechnician.create.mockResolvedValue({});
  mocks.prisma.workOrder.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.bookingRequestEvent.create.mockResolvedValue({ id: "event-1" });
  mocks.assertTechnicianSlotAvailable.mockResolvedValue({ ok: true });
  mocks.lockTechnicians.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.notifyWorkOrderEvent.mockResolvedValue(1);
  mocks.trySendBookingConfirmedSms.mockResolvedValue(undefined);
  mocks.enqueueBookingEmail.mockResolvedValue({
    queued: true,
    id: "em-1",
    reason: "queued",
  });
  mocks.recomputeWorkOrderSchedule.mockResolvedValue(undefined);
});

describe("cancelBookingFromOffice", () => {
  it("avlyser oppdraget og rydder livssyklusen, ikke bare statusen", async () => {
    const result = await cancelBookingFromOffice(office(), { bookingId: "br-1" });

    expect(result).toEqual({ ok: true, data: { reference: "B-TEST-1" } });
    expect(mocks.prisma.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo-1",
        status: { in: ["OPEN", "PENDING", "PLANNED", "WAITING"] },
      },
      data: { status: "CANCELLED" },
    });
    expect(mocks.prisma.slaClock.updateMany).toHaveBeenCalled();
    expect(mocks.prisma.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { workOrderId: "wo-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.prisma.bookingRequestEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "CANCELLED" }),
    });
  });
});

describe("confirmBooking", () => {
  it("avviser kontor uten tildelingsrett", async () => {
    const result = await confirmBooking(
      office({ permissions: ["workorders.view"], permissionsCustomized: true }),
      {
        bookingId: "br-1",
        technicianId: "tech-1",
        date: DATE,
        from: "09:00",
        to: "10:00",
      },
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.runSerializable).not.toHaveBeenCalled();
  });

  it("planlegger og bekrefter en datoforespørsel med valgt tid og montør", async () => {
    const result = await confirmBooking(office(), {
      bookingId: "br-1",
      technicianId: "tech-1",
      date: DATE,
      from: "09:00",
      to: "10:30",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        reference: "B-TEST-1",
        technicianName: "Tina Tekniker",
        already: false,
      },
    });

    const startsAt = osloWallTimeToUtc(DATE, 9 * 60);
    const endsAt = osloWallTimeToUtc(DATE, 10 * 60 + 30);
    expect(mocks.prisma.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderId: "wo-1",
        startsAt,
        endsAt,
        allDay: false,
        status: "PLANNED",
        technicians: { create: { userId: "tech-1" } },
      }),
      select: { id: true },
    });
    expect(mocks.prisma.bookingRequest.update).toHaveBeenCalledWith({
      where: { id: "br-1" },
      data: expect.objectContaining({
        status: "CONFIRMED",
        confirmedAt: expect.any(Date),
        visitId: "visit-1",
        preferredTechnicianId: "tech-1",
        preferredTechnicianName: "Tina Tekniker",
      }),
    });
    expect(mocks.prisma.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo-1",
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      data: { status: "PLANNED" },
    });
    expect(mocks.prisma.bookingRequestEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingRequestId: "br-1",
        type: "CONFIRMED",
        requestedDate: parseDateOnly(DATE),
        requestedFrom: "09:00",
        requestedTo: "10:30",
      }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "BookingRequest",
        entityId: "br-1",
        metadata: expect.objectContaining({
          plannedDate: DATE,
          plannedFrom: "09:00",
          plannedTo: "10:30",
        }),
      }),
    );
    expect(mocks.trySendBookingConfirmedSms).toHaveBeenCalledWith(
      expect.objectContaining({ id: "office-1" }),
      "wo-1",
      expect.objectContaining({
        reference: "B-TEST-1",
        date: DATE,
        time: "09:00–10:30",
        technicianName: "Tina Tekniker",
      }),
      mocks.prisma,
    );
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledWith(
      "wo-1",
      "BOOKING",
      expect.any(String),
      expect.any(String),
      "/oppdrag/wo-1",
      "booking-confirm:br-1",
    );
    expect(mocks.enqueueBookingEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "bookingConfirmed",
        bookingId: "br-1",
        customerId: "cust-1",
        title: "Årlig service",
        reference: "B-TEST-1",
        technicianName: "Tina Tekniker",
      }),
    );
  });

  it("beholder lagret tidsvindu for eldre forespørsler", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(
      booking({ requestedFrom: "08:00", requestedTo: "12:00" }),
    );

    const result = await confirmBooking(office(), {
      bookingId: "br-1",
      technicianId: "tech-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startsAt: osloWallTimeToUtc(DATE, 8 * 60),
        endsAt: osloWallTimeToUtc(DATE, 12 * 60),
      }),
      select: { id: true },
    });
    expect(mocks.trySendBookingConfirmedSms).toHaveBeenCalledWith(
      expect.anything(),
      "wo-1",
      expect.objectContaining({ date: DATE, time: "08:00–12:00" }),
      expect.anything(),
    );
  });

  it("krever et konkret tidsrom når forespørselen bare har dato", async () => {
    const result = await confirmBooking(office(), {
      bookingId: "br-1",
      technicianId: "tech-1",
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      details: { code: "needs_planning" },
    });
    expect(mocks.prisma.visit.create).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingRequest.update).not.toHaveBeenCalled();
  });

  it("avviser et tidsrom der slutt er før start", async () => {
    const result = await confirmBooking(office(), {
      bookingId: "br-1",
      technicianId: "tech-1",
      date: DATE,
      from: "12:00",
      to: "09:00",
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      details: { code: "invalid_time" },
    });
    expect(mocks.runSerializable).not.toHaveBeenCalled();
  });

  it("avviser en montør som er opptatt eller utilgjengelig", async () => {
    mocks.assertTechnicianSlotAvailable.mockResolvedValue({
      ok: false,
      reason: "conflict",
    });

    const result = await confirmBooking(office(), {
      bookingId: "br-1",
      technicianId: "tech-1",
      date: DATE,
      from: "09:00",
      to: "10:00",
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      details: { code: "technician_unavailable" },
    });
    expect(mocks.prisma.visit.create).not.toHaveBeenCalled();
    expect(mocks.prisma.visit.update).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingRequest.update).not.toHaveBeenCalled();
  });

  it("avviser når ingen montør i avdelingen kan velges", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.listAvailableTechniciansForWindow.mockResolvedValue([]);

    const result = await confirmBooking(office(), {
      bookingId: "br-1",
      date: DATE,
      from: "09:00",
      to: "10:00",
    });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      details: { code: "no_technician" },
    });
    expect(mocks.assertTechnicianSlotAvailable).not.toHaveBeenCalled();
  });

  it("er idempotent når bookingen allerede er bekreftet", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(
      booking({ status: "CONFIRMED", visitId: "visit-1" }),
    );

    const result = await confirmBooking(office(), {
      bookingId: "br-1",
      technicianId: "tech-1",
      date: DATE,
      from: "09:00",
      to: "10:00",
    });

    expect(result).toEqual({
      ok: true,
      data: { reference: "B-TEST-1", technicianName: null, already: true },
    });
    expect(mocks.prisma.bookingRequest.update).not.toHaveBeenCalled();
    expect(mocks.prisma.visit.create).not.toHaveBeenCalled();
    expect(mocks.trySendBookingConfirmedSms).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });
});

describe("listBookingQueue", () => {
  it("viser alle avdelingens montører for en datoforespørsel uten tid", async () => {
    mocks.prisma.bookingRequest.count.mockResolvedValue(1);
    mocks.prisma.bookingRequest.findMany.mockResolvedValue([
      {
        ...booking(),
        serviceType: "general",
        preferredTechnicianName: null,
        confirmedAt: null,
        createdAt: new Date("2026-11-01T09:00:00.000Z"),
        site: { name: "Hovedanlegget" },
        customer: { name: "Kunde AS" },
        workOrder: {
          id: "wo-1",
          title: "Årlig service",
          status: "OPEN",
          departmentId: "dep-1",
        },
        visit: null,
      },
    ]);
    mocks.prisma.user.findMany.mockResolvedValue([
      { id: "tech-1", name: "Tina Tekniker" },
      { id: "tech-2", name: "Tom Tekniker" },
    ]);

    const result = await listBookingQueue(office(), { filter: "pending" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]).toMatchObject({
      requestedDate: DATE,
      requestedFrom: "",
      requestedTo: "",
      technicians: [
        { id: "tech-1", name: "Tina Tekniker" },
        { id: "tech-2", name: "Tom Tekniker" },
      ],
      availableTechnicians: [],
    });
    expect(mocks.listAvailableTechniciansForWindow).not.toHaveBeenCalled();
  });
});
