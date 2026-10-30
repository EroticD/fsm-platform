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
    workOrder: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    customer: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    bookingRequest: { create: vi.fn() },
    bookingRequestEvent: { create: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  allowRequestDb: vi.fn(),
  getDefaultDepartmentId: vi.fn(),
  notifyWorkOrderEvent: vi.fn(),
  trySendBookingConfirmedSms: vi.fn(),
  notifyUser: vi.fn(),
  createDefaultVisit: vi.fn(),
  recomputeWorkOrderSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("./visits", () => ({
  createDefaultVisit: mocks.createDefaultVisit,
  recomputeWorkOrderSchedule: mocks.recomputeWorkOrderSchedule,
}));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/lib/departments", () => ({
  getDefaultDepartmentId: mocks.getDefaultDepartmentId,
}));
vi.mock("./notifications", () => ({
  notifyWorkOrderEvent: mocks.notifyWorkOrderEvent,
  notifyUser: mocks.notifyUser,
}));
vi.mock("./sms-events", () => ({
  trySendBookingConfirmedSms: mocks.trySendBookingConfirmedSms,
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

const booking = {
  title: "Årlig service",
  description: "Trenger service på anlegget.",
  requestedDate,
  requestedFrom: "08:00",
  requestedTo: "12:00",
  contactName: "Kari Kunde",
  contactPhone: "12345678",
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.workOrder.findFirst.mockResolvedValue(null);
  mocks.prisma.workOrder.count.mockResolvedValue(0);
  mocks.prisma.workOrder.create.mockResolvedValue({ id: "wo-1" });
  mocks.prisma.customer.findFirst.mockResolvedValue({
    id: "cust-1",
    departmentId: null,
  });
  mocks.prisma.product.findFirst.mockResolvedValue(null);
  mocks.prisma.user.findFirst.mockResolvedValue({ name: "Tekniker" });
  mocks.prisma.bookingRequest.create.mockResolvedValue({
    id: "br-1",
    reference: "B-TEST-1",
  });
  mocks.prisma.bookingRequestEvent.create.mockResolvedValue({ id: "ev-1" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.getDefaultDepartmentId.mockResolvedValue("dep-1");
  mocks.notifyWorkOrderEvent.mockResolvedValue(1);
  mocks.trySendBookingConfirmedSms.mockResolvedValue(undefined);
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.createDefaultVisit.mockResolvedValue(undefined);
  mocks.recomputeWorkOrderSchedule.mockResolvedValue(undefined);
});

describe("createBooking", () => {
  it("avviser andre enn en innlogget kunde", async () => {
    await expect(
      createBooking(customer({ role: "OFFICE", customerId: null }), booking),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(
      createBooking(customer({ isActive: false }), booking),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });

    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
  });

  it("avviser bestilling når kunden er mykt slettet", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue(null);

    await expect(createBooking(customer(), booking)).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });

    expect(mocks.prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: "cust-1", deletedAt: null },
      select: { id: true },
    });
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("avviser bestilling som starter innenfor minste ledetid", async () => {
    const result = await createBooking(customer(), {
      ...booking,
      // Dagens dato kl. 23:00 er alltid mindre enn 24 timer fram, uansett
      // når på døgnet testen kjøres.
      requestedDate: todayInOslo(),
      requestedFrom: "23:00",
      requestedTo: "23:59",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("avviser den sjette bestillingen innenfor en time", async () => {
    let customerAttempts = 0;
    mocks.allowRequestDb.mockImplementation(async (key: string) => {
      if (key === "booking:customer:cust-1") {
        customerAttempts += 1;
        return {
          allowed: customerAttempts <= 5,
          retryAfterSeconds: customerAttempts <= 5 ? 0 : 3600,
        };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      mocks.prisma.workOrder.create.mockResolvedValueOnce({
        id: `wo-${attempt}`,
      });
      await expect(
        createBooking(customer(), {
          ...booking,
          title: `Bestilling ${attempt}`,
          ip: "10.0.0.1",
        }),
      ).resolves.toEqual({
        ok: true,
        data: { id: `wo-${attempt}`, reference: "B-TEST-1", status: "PENDING" },
      });
    }

    const sixth = await createBooking(customer(), {
      ...booking,
      title: "Bestilling 6",
      ip: "10.0.0.1",
    });

    expect(sixth).toEqual({ ok: false, reason: "rate_limited" });
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledTimes(5);
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledTimes(5);
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "booking:customer:cust-1",
      5,
      60 * 60_000,
    );
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "booking:ip:10.0.0.1",
      10,
      60 * 60_000,
    );
  });

  it("avviser når IP-grensen er brukt opp", async () => {
    mocks.allowRequestDb.mockImplementation(async (key: string) =>
      key.startsWith("booking:ip:")
        ? { allowed: false, retryAfterSeconds: 120 }
        : { allowed: true, retryAfterSeconds: 0 },
    );

    const result = await createBooking(customer(), {
      ...booking,
      ip: "10.0.0.9",
    });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("avviser når kunden har fem åpne bestillinger fra før", async () => {
    mocks.prisma.workOrder.count.mockResolvedValue(5);

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mocks.prisma.workOrder.count).toHaveBeenCalledWith({
      where: {
        customerId: "cust-1",
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        deletedAt: null,
      },
    });
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("returnerer eksisterende sak for lik bestilling og varsler ikke på nytt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-existing",
      bookingRequest: { reference: "B-EXISTING" },
    });

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({
      ok: true,
      data: {
        id: "wo-existing",
        reference: "B-EXISTING",
        duplicate: true,
        status: "PENDING",
      },
    });
    expect(mocks.prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: "cust-1",
          title: booking.title,
          description: booking.description,
          deletedAt: null,
        }),
      }),
    );
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("oppretter oppdrag og revisjonslogg i samme transaksjon", async () => {
    const result = await createBooking(customer(), {
      ...booking,
      ip: "10.0.0.2",
    });

    expect(result).toEqual({
      ok: true,
      data: { id: "wo-1", reference: "B-TEST-1", status: "PENDING" },
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: booking.title,
        description: booking.description,
        departmentId: "dep-1",
        customerId: "cust-1",
        status: "OPEN",
        creatorName: "Kunde",
      }),
      select: { id: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-1",
      }),
    );

    // Bestillingens ønskede tidsvindu blir oppdragets første visitt.
    const dayStart = osloDayStart(requestedDate);
    expect(mocks.createDefaultVisit).toHaveBeenCalledWith(mocks.prisma, {
      workOrderId: "wo-1",
      startsAt: new Date(dayStart.getTime() + 8 * 60 * 60_000),
      endsAt: new Date(dayStart.getTime() + 12 * 60 * 60_000),
      allDay: false,
    });
    expect(mocks.recomputeWorkOrderSchedule).toHaveBeenCalledWith(
      mocks.prisma,
      "wo-1",
    );
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledWith(
      "wo-1",
      "BOOKING",
      expect.any(String),
      expect.any(String),
      "/oppdrag/wo-1",
      "booking:wo-1",
    );
  });

  it("nøytraliserer lenker i bestillingsvarselet", async () => {
    await createBooking(customer(), {
      ...booking,
      title: "Se https://phish.test",
    });

    const body = mocks.notifyWorkOrderEvent.mock.calls[0][3] as string;
    expect(body).not.toContain("phish.test");
    expect(body).toContain("[lenke fjernet]");
  });

  it("ruller tilbake begge skrivingene når revisjonsloggen feiler", async () => {
    mocks.audit.mockRejectedValue(new Error("audit feilet"));

    const result = await createBooking(customer(), booking);

    expect(result).toEqual({ ok: false, reason: "error" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("bruker alltid aktørens egen customerId", async () => {
    const result = await createBooking(customer(), {
      ...booking,
      // Ondsinnet klient kan sende et ekstra felt; det skal ignoreres.
      customerId: "cust-2",
    } as typeof booking & { customerId: string });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: "cust-1" }),
      }),
    );
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "cust-1" }),
      }),
    );
  });
});
