import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";
import {
  addDaysUtc,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";

const mocks = vi.hoisted(() => ({
  prisma: {
    customer: { findFirst: vi.fn() },
    customerSite: { findFirst: vi.fn(), create: vi.fn() },
    product: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    workOrder: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
    visit: { create: vi.fn() },
    bookingRequest: { create: vi.fn() },
    bookingRequestEvent: { createMany: vi.fn(), create: vi.fn() },
    bookingHold: { findFirst: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
  },
  audit: vi.fn(),
  allowRequestDb: vi.fn(),
  getDefaultDepartmentId: vi.fn(),
  notifyWorkOrderEvent: vi.fn(),
  trySendBookingConfirmedSms: vi.fn(),
  createDefaultVisit: vi.fn(),
  recomputeWorkOrderSchedule: vi.fn(),
  runSerializable: vi.fn(),
  lockTechnicians: vi.fn(),
  assertTechnicianSlotAvailable: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/lib/departments", () => ({
  getDefaultDepartmentId: mocks.getDefaultDepartmentId,
}));
vi.mock("./visits", () => ({
  createDefaultVisit: mocks.createDefaultVisit,
  recomputeWorkOrderSchedule: mocks.recomputeWorkOrderSchedule,
}));
vi.mock("./notifications", () => ({
  notifyWorkOrderEvent: mocks.notifyWorkOrderEvent,
  notifyUser: vi.fn(),
}));
vi.mock("./sms-events", () => ({
  trySendBookingConfirmedSms: mocks.trySendBookingConfirmedSms,
}));
vi.mock("./availability", () => ({
  runSerializable: mocks.runSerializable,
  lockTechnicians: mocks.lockTechnicians,
  assertTechnicianSlotAvailable: mocks.assertTechnicianSlotAvailable,
  holdBookingSlot: vi.fn(),
}));

import { createBooking } from "./portal";

const customer = (overrides: Partial<ServiceActor> = {}): ServiceActor => ({
  id: "u1",
  name: "Kunde",
  email: "kunde@example.test",
  role: "CUSTOMER",
  isActive: true,
  departmentId: null,
  customerId: "cust-1",
  contactId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
  ...overrides,
});

const requestedDate = toDateOnly(
  addDaysUtc(parseDateOnly(todayInOslo())!, 7),
);
const startsAt = new Date(
  osloDayStart(requestedDate).getTime() + 8 * 60 * 60_000,
);
const endsAt = new Date(
  osloDayStart(requestedDate).getTime() + 8.5 * 60 * 60_000,
);

const booking = {
  title: "Årlig service",
  description: "Trenger service.",
  requestedDate,
  requestedFrom: "08:00",
  requestedTo: "08:30",
  contactName: "Kari Kunde",
  contactPhone: "12345678",
  technicianId: "tech-1",
  holdToken: "hold-token",
  siteId: "site-1",
  serviceType: "maintenance",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runSerializable.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.assertTechnicianSlotAvailable.mockResolvedValue({
    ok: true,
    technician: { id: "tech-1", name: "Tekniker" },
  });
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.getDefaultDepartmentId.mockResolvedValue("dep-1");
  mocks.notifyWorkOrderEvent.mockResolvedValue(1);
  mocks.trySendBookingConfirmedSms.mockResolvedValue(undefined);
  mocks.prisma.customer.findFirst.mockResolvedValue({
    id: "cust-1",
    departmentId: "dep-1",
    name: "Kunde AS",
    address: null,
    postalCode: null,
    city: null,
  });
  mocks.prisma.customerSite.findFirst.mockResolvedValue({
    id: "site-1",
    name: "Hovedanlegg",
    address: "Gate 1",
    postalCode: "0001",
    city: "Oslo",
  });
  mocks.prisma.user.findFirst.mockResolvedValue({ name: "Tekniker" });
  mocks.prisma.workOrder.findFirst.mockResolvedValue(null);
  mocks.prisma.workOrder.count.mockResolvedValue(0);
  mocks.prisma.workOrder.create.mockResolvedValue({ id: "wo-1" });
  mocks.prisma.visit.create.mockResolvedValue({ id: "visit-1" });
  mocks.prisma.bookingRequest.create.mockResolvedValue({
    id: "br-1",
    reference: "B-TEST-1",
  });
  mocks.prisma.bookingRequestEvent.createMany.mockResolvedValue({ count: 2 });
  mocks.prisma.bookingHold.findFirst.mockResolvedValue({
    id: "hold-1",
    startsAt,
    endsAt,
    technicianId: "tech-1",
    siteId: "site-1",
  });
  mocks.prisma.bookingHold.updateMany.mockResolvedValue({ count: 1 });
  mocks.audit.mockResolvedValue(undefined);
  mocks.recomputeWorkOrderSchedule.mockResolvedValue(undefined);
});

describe("createBooking med ledig time", () => {
  it("oppretter CONFIRMED bestilling og PLANNED visitt med valgt montør", async () => {
    const result = await createBooking(customer(), booking);

    expect(result).toEqual({
      ok: true,
      data: {
        id: "wo-1",
        reference: "B-TEST-1",
        status: "CONFIRMED",
        visitId: "visit-1",
        technicianName: "Tekniker",
      },
    });

    expect(mocks.lockTechnicians).toHaveBeenCalledWith(
      mocks.prisma,
      ["tech-1"],
    );
    expect(mocks.assertTechnicianSlotAvailable).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        departmentId: "dep-1",
        technicianId: "tech-1",
        date: requestedDate,
        startsAt,
        endsAt,
        excludeHoldId: "hold-1",
      }),
    );
    expect(mocks.prisma.visit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workOrderId: "wo-1",
          startsAt,
          endsAt,
          status: "PLANNED",
          technicians: { create: { userId: "tech-1" } },
        }),
      }),
    );
    expect(mocks.prisma.bookingRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONFIRMED",
          siteId: "site-1",
          visitId: "visit-1",
          serviceType: "maintenance",
          preferredTechnicianId: "tech-1",
        }),
      }),
    );
    expect(mocks.prisma.bookingHold.updateMany).toHaveBeenCalledWith({
      where: { id: "hold-1", consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(mocks.trySendBookingConfirmedSms).toHaveBeenCalledWith(
      expect.objectContaining({ role: "CUSTOMER", customerId: "cust-1" }),
      "wo-1",
      expect.objectContaining({
        reference: "B-TEST-1",
        date: requestedDate,
        technicianName: "Tekniker",
      }),
      mocks.prisma,
    );
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PLANNED",
          address: "Gate 1",
          scheduledFor: parseDateOnly(requestedDate),
        }),
      }),
    );
  });

  it("avviser en reservasjon som er utløpt eller tilhører en annen time", async () => {
    mocks.prisma.bookingHold.findFirst.mockResolvedValue(null);

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingHold.updateMany).not.toHaveBeenCalled();
  });

  it("avviser når timen er tatt i mellomtiden", async () => {
    mocks.assertTechnicianSlotAvailable.mockResolvedValue({
      ok: false,
      reason: "conflict",
    });

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });
});
