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
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    bookingRequest: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    bookingRequestEvent: { create: vi.fn() },
    report: { update: vi.fn(), updateMany: vi.fn() },
    visit: { findMany: vi.fn(), update: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  allowRequestDb: vi.fn(),
  notifyWorkOrderEvent: vi.fn(),
  createDefaultVisit: vi.fn(),
  recomputeWorkOrderSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("./visits", () => ({
  createDefaultVisit: mocks.createDefaultVisit,
  recomputeWorkOrderSchedule: mocks.recomputeWorkOrderSchedule,
}));
vi.mock("./notifications", () => ({
  notifyUser: vi.fn(),
  notifyWorkOrderEvent: mocks.notifyWorkOrderEvent,
}));

import {
  acknowledgeReport,
  cancelBooking,
  getPortalBookingRequests,
  getPortalReportHistory,
  portalUpcomingWhere,
  rescheduleBooking,
} from "./portal";

const customer = (overrides: Partial<ServiceActor> = {}): ServiceActor => ({
  id: "u1",
  name: "Kunde",
  email: "kunde@example.test",
  role: "CUSTOMER",
  isActive: true,
  departmentId: null,
  customerId: "cust-1",
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.workOrder.findMany.mockResolvedValue([]);
  mocks.prisma.workOrder.count.mockResolvedValue(0);
  mocks.prisma.workOrder.findUnique.mockResolvedValue(null);
  mocks.prisma.workOrder.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.bookingRequest.findFirst.mockResolvedValue(null);
  mocks.prisma.bookingRequest.count.mockResolvedValue(0);
  mocks.prisma.bookingRequest.findMany.mockResolvedValue([]);
  mocks.prisma.bookingRequest.update.mockResolvedValue({});
  mocks.prisma.bookingRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.bookingRequestEvent.create.mockResolvedValue({ id: "ev-1" });
  mocks.prisma.report.update.mockResolvedValue({});
  mocks.prisma.report.updateMany.mockResolvedValue({ count: 1 });
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.notifyWorkOrderEvent.mockResolvedValue(1);
  mocks.createDefaultVisit.mockResolvedValue(undefined);
  mocks.recomputeWorkOrderSchedule.mockResolvedValue(undefined);
  mocks.prisma.visit.findMany.mockResolvedValue([
    { id: "visit-1", status: "PLANNED" },
  ]);
  mocks.prisma.visit.update.mockResolvedValue({});
});

const requestedDate = addDaysUtc(parseDateOnly(todayInOslo())!, 7);

function ownBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "br-1",
    reference: "B-1",
    customerId: "cust-1",
    status: "PENDING",
    requestedDate,
    requestedFrom: "08:00",
    requestedTo: "12:00",
    workOrder: {
      id: "wo1",
      title: "Service",
      status: "OPEN",
      customerId: "cust-1",
      deletedAt: null,
    },
    ...overrides,
  };
}

describe("kundeportaltjenesten", () => {
  it("avviser historikk for andre enn kundeportalen", async () => {
    const result = await getPortalReportHistory(
      customer({ role: "TECHNICIAN", customerId: null }),
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("returnerer avgrenset rapporthistorikk for egen kunde", async () => {
    mocks.prisma.workOrder.findMany.mockResolvedValue([{ id: "wo1" }]);
    mocks.prisma.workOrder.count.mockResolvedValue(1);

    const result = await getPortalReportHistory(customer(), { page: 1 });
    expect(result).toEqual({
      ok: true,
      data: {
        items: [{ id: "wo1" }],
        total: 1,
        page: 1,
        totalPages: 1,
      },
    });
    expect(mocks.prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        skip: 0,
        where: {
          customerId: "cust-1",
          deletedAt: null,
          status: { in: ["COMPLETED", "CANCELLED"] },
        },
        select: expect.objectContaining({
          reports: expect.objectContaining({
            where: { deletedAt: null },
            select: expect.objectContaining({ name: true }),
          }),
        }),
      }),
    );
  });

  it("henter alle rapporter per oppdrag og paginerer historikken", async () => {
    mocks.prisma.workOrder.findMany.mockResolvedValue([]);
    mocks.prisma.workOrder.count.mockResolvedValue(45);

    const result = await getPortalReportHistory(customer(), { page: 2 });
    expect(result).toMatchObject({
      ok: true,
      data: { page: 2, totalPages: 3 },
    });

    const query = mocks.prisma.workOrder.findMany.mock.calls[0]?.[0];
    expect(query?.skip).toBe(20);
    expect(query?.select?.reports?.take).toBeUndefined();
  });

  it("avviser kvittering for en annen kundes oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      customerId: "cust-2",
      reports: [{ id: "r1", customerAcknowledgedAt: null }],
    });

    const result = await acknowledgeReport(customer(), { workOrderId: "wo1" });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it("kvitterer for egen rapport og logger det", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [{ id: "r1", isLocked: true, customerAcknowledgedAt: null }],
    });

    const result = await acknowledgeReport(customer(), {
      workOrderId: "wo1",
      comment: "Mottatt",
    });

    expect(mocks.prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wo1", customerId: "cust-1", deletedAt: null },
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.report.updateMany).toHaveBeenCalledWith({
      where: {
        id: "r1",
        deletedAt: null,
        isLocked: true,
        customerAcknowledgedAt: null,
      },
      data: expect.objectContaining({
        customerAcknowledgedBy: "Kunde",
        customerAcknowledgedComment: "Mottatt",
      }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "Report",
        entityId: "r1",
        action: "Kunden kvitterte for rapporten",
        metadata: { workOrderId: "wo1", reportId: "r1" },
      }),
    );
  });

  it("kvitterer for en bestemt eldre rapport, ikke bare den nyeste", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [
        { id: "r2", isLocked: true, customerAcknowledgedAt: null },
        { id: "r1", isLocked: true, customerAcknowledgedAt: null },
      ],
    });

    const result = await acknowledgeReport(customer(), {
      workOrderId: "wo1",
      reportId: "r1",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.report.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "r1", customerAcknowledgedAt: null }),
      data: expect.objectContaining({ customerAcknowledgedBy: "Kunde" }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({ entityId: "r1" }),
    );
  });

  it("avviser kvittering for en opplåst rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [{ id: "r1", isLocked: false, customerAcknowledgedAt: null }],
    });

    const result = await acknowledgeReport(customer(), {
      workOrderId: "wo1",
      reportId: "r1",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it("avviser kvittering for en slettet rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [],
    });

    const result = await acknowledgeReport(customer(), {
      workOrderId: "wo1",
      reportId: "slettet",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it("er idempotent når rapporten allerede er kvittert", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [{ id: "r1", isLocked: true, customerAcknowledgedAt: new Date() }],
    });

    const result = await acknowledgeReport(customer(), { workOrderId: "wo1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it("skriver bare én revisjonsrad når to forespørsler kvitterer samtidig", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [{ id: "r1", isLocked: true, customerAcknowledgedAt: null }],
    });
    // Den andre samtidige forespørselen tapte race-en.
    mocks.prisma.report.updateMany.mockResolvedValue({ count: 0 });

    const result = await acknowledgeReport(customer(), {
      workOrderId: "wo1",
      reportId: "r1",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.report.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("inkluderer bare bekreftede og ikke-past-daterte oppdrag som kommende", () => {
    const today = parseDateOnly("2026-10-29")!;
    const where = portalUpcomingWhere("cust-1", today);

    expect(where).toEqual({
      customerId: "cust-1",
      deletedAt: null,
      status: { in: ["PLANNED", "WAITING", "IN_PROGRESS"] },
      OR: [
        { scheduledFor: { gte: today } },
        { scheduledTo: { gte: today } },
      ],
    });
    expect(
      (where.status as { in: string[] }).in,
    ).not.toEqual(expect.arrayContaining(["OPEN", "PENDING"]));
  });

  it("henter bare egne bestillinger med status og historikk", async () => {
    mocks.prisma.bookingRequest.count.mockResolvedValue(1);
    mocks.prisma.bookingRequest.findMany.mockResolvedValue([
      {
        id: "br-1",
        reference: "B-1",
        status: "PENDING",
        requestedDate,
        requestedFrom: "08:00",
        requestedTo: "12:00",
        equipmentLabel: "Pumpe",
        preferredTechnicianName: "Tekniker",
        contactName: "Kari",
        contactPhone: "12345678",
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
        workOrder: {
          id: "wo1",
          title: "Service",
          status: "OPEN",
          scheduledFor: requestedDate,
          scheduledTo: requestedDate,
        },
        events: [],
      },
    ]);

    const result = await getPortalBookingRequests(customer());

    expect(result).toMatchObject({
      ok: true,
      data: {
        total: 1,
        page: 1,
        totalPages: 1,
        items: [
          {
            reference: "B-1",
            displayStatus: "pending",
            canCancel: true,
            canReschedule: true,
            workOrder: {
              status: "OPEN",
              scheduledFor: toDateOnly(requestedDate),
            },
          },
        ],
      },
    });
    expect(mocks.prisma.bookingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId: "cust-1",
          workOrder: { deletedAt: null },
        },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("paginerer bestillingshistorikken med synlig total", async () => {
    mocks.prisma.bookingRequest.count.mockResolvedValue(45);
    mocks.prisma.bookingRequest.findMany.mockResolvedValue([]);

    const result = await getPortalBookingRequests(customer(), { page: 2 });

    expect(result).toMatchObject({
      ok: true,
      data: { total: 45, page: 2, totalPages: 3, items: [] },
    });
    expect(mocks.prisma.bookingRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });

  it("avviser endring av en bestilling som tilhører en annen kunde", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(null);

    const result = await cancelBooking(customer(), { bookingId: "br-1" });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.bookingRequest.updateMany).not.toHaveBeenCalled();
  });

  it("kansellerer egen ubekreftet bestilling og avlyser det åpne oppdraget", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(ownBooking());

    const result = await cancelBooking(customer(), { bookingId: "br-1" });

    expect(result).toEqual({
      ok: true,
      data: {
        status: "cancelled",
        reference: "B-1",
        workOrderCancelled: true,
        visitInProgress: false,
      },
    });
    expect(mocks.prisma.bookingRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "br-1",
          customerId: "cust-1",
          workOrder: { customerId: "cust-1" },
        },
      }),
    );
    expect(mocks.prisma.bookingRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "br-1", customerId: "cust-1", status: "PENDING" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo1",
        customerId: "cust-1",
        status: { in: ["OPEN", "PENDING", "PLANNED", "WAITING"] },
      },
      data: { status: "CANCELLED" },
    });
    expect(mocks.prisma.bookingRequestEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "CANCELLED" }),
    });
  });

  it("kansellerer en bekreftet PLANNED-avtale og avlyser oppdraget", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(
      ownBooking({
        workOrder: {
          id: "wo1",
          title: "Service",
          status: "PLANNED",
          customerId: "cust-1",
          deletedAt: null,
        },
      }),
    );

    const result = await cancelBooking(customer(), { bookingId: "br-1" });

    expect(result).toEqual({
      ok: true,
      data: {
        status: "cancelled",
        reference: "B-1",
        workOrderCancelled: true,
        visitInProgress: false,
      },
    });
    expect(mocks.prisma.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo1",
        customerId: "cust-1",
        status: { in: ["OPEN", "PENDING", "PLANNED", "WAITING"] },
      },
      data: { status: "CANCELLED" },
    });
  });

  it("lar et IN_PROGRESS-oppdrag stå og varsler kontoret", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(
      ownBooking({
        workOrder: {
          id: "wo1",
          title: "Service",
          status: "IN_PROGRESS",
          customerId: "cust-1",
          deletedAt: null,
        },
      }),
    );

    const result = await cancelBooking(customer(), { bookingId: "br-1" });

    expect(result).toEqual({
      ok: true,
      data: {
        status: "cancelled",
        reference: "B-1",
        workOrderCancelled: false,
        visitInProgress: true,
      },
    });
    expect(mocks.prisma.bookingRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "br-1", customerId: "cust-1", status: "PENDING" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
    expect(mocks.prisma.workOrder.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledWith(
      "wo1",
      "BOOKING",
      "Kunde kansellerte – oppdraget er i gang",
      expect.stringContaining("allerede i gang"),
      "/oppdrag/wo1",
      "booking-cancel:br-1",
    );
  });

  it("avviser kansellering når oppdraget er flyttet til en annen kunde", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(
      ownBooking({
        workOrder: {
          id: "wo1",
          title: "Service",
          status: "OPEN",
          customerId: "cust-2",
          deletedAt: null,
        },
      }),
    );

    const result = await cancelBooking(customer(), { bookingId: "br-1" });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.bookingRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingRequestEvent.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("kansellerer en ubekreftet forespørsel selv innenfor 24-timersvinduet", async () => {
    // Dagens dato gjør endringsfristen (24 timer før ønsket start) passert,
    // uavhengig av når på døgnet testen kjøres. En ubekreftet forespørsel
    // skal likevel kunne kanselleres.
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(
      ownBooking({
        requestedDate: parseDateOnly(todayInOslo())!,
        requestedFrom: "08:00",
      }),
    );

    const result = await cancelBooking(customer(), { bookingId: "br-1" });

    expect(result).toMatchObject({
      ok: true,
      data: { status: "cancelled", reference: "B-1" },
    });
    expect(mocks.prisma.bookingRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "br-1", customerId: "cust-1", status: "PENDING" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
  });

  it("oppdaterer ønsket tid og skriver historikk ved ny-tid-forespørsel", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(ownBooking());
    const newDate = toDateOnly(
      addDaysUtc(parseDateOnly(todayInOslo())!, 10),
    );

    const result = await rescheduleBooking(customer(), {
      bookingId: "br-1",
      requestedDate: newDate,
      requestedFrom: "09:00",
      requestedTo: "11:00",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        status: "rescheduled",
        reference: "B-1",
        requestedDate: newDate,
        requestedFrom: "09:00",
        requestedTo: "11:00",
      },
    });
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "booking-reschedule:u1:br-1",
      5,
      15 * 60_000,
    );
    expect(mocks.prisma.bookingRequest.update).toHaveBeenCalledWith({
      where: { id: "br-1" },
      data: expect.objectContaining({ requestedFrom: "09:00", requestedTo: "11:00" }),
    });
    expect(mocks.prisma.workOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "wo1", customerId: "cust-1", status: "OPEN" },
      data: {
        scheduledFor: expect.any(Date),
        scheduledTo: expect.any(Date),
      },
    });

    // Standardvisitten flyttes til det nye ønskede tidsvinduet.
    const dayStart = osloDayStart(newDate);
    expect(mocks.prisma.visit.update).toHaveBeenCalledWith({
      where: { id: "visit-1" },
      data: {
        startsAt: new Date(dayStart.getTime() + 9 * 60 * 60_000),
        endsAt: new Date(dayStart.getTime() + 11 * 60 * 60_000),
        allDay: false,
      },
    });
    expect(mocks.recomputeWorkOrderSchedule).toHaveBeenCalledWith(
      mocks.prisma,
      "wo1",
    );
    expect(mocks.prisma.bookingRequestEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "RESCHEDULED" }),
    });
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledWith(
      "wo1",
      "BOOKING",
      "Kunde ba om ny tid",
      expect.any(String),
      "/oppdrag/wo1",
      `booking-reschedule:br-1:${newDate}:09:00:11:00`,
    );
  });

  it("avviser ny tid som starter innenfor minste ledetid", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(ownBooking());

    const result = await rescheduleBooking(customer(), {
      bookingId: "br-1",
      requestedDate: todayInOslo(),
      requestedFrom: "23:00",
      requestedTo: "23:59",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.bookingRequest.update).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingRequestEvent.create).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("er en no-op når tidsvinduet er uendret", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(ownBooking());
    const sameDate = toDateOnly(requestedDate);

    const result = await rescheduleBooking(customer(), {
      bookingId: "br-1",
      requestedDate: sameDate,
      requestedFrom: "08:00",
      requestedTo: "12:00",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        status: "rescheduled",
        reference: "B-1",
        requestedDate: sameDate,
        requestedFrom: "08:00",
        requestedTo: "12:00",
      },
    });
    expect(mocks.prisma.bookingRequest.update).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingRequestEvent.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("avviser ny-tid-forespørsler over rate-grensen", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(ownBooking());
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 600,
    });
    const newDate = toDateOnly(
      addDaysUtc(parseDateOnly(todayInOslo())!, 10),
    );

    const result = await rescheduleBooking(customer(), {
      bookingId: "br-1",
      requestedDate: newDate,
      requestedFrom: "09:00",
      requestedTo: "11:00",
    });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(mocks.prisma.bookingRequest.update).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingRequestEvent.create).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });

  it("avviser ny tid når oppdraget er flyttet til en annen kunde", async () => {
    mocks.prisma.bookingRequest.findFirst.mockResolvedValue(
      ownBooking({
        workOrder: {
          id: "wo1",
          title: "Service",
          status: "OPEN",
          customerId: "cust-2",
          deletedAt: null,
        },
      }),
    );
    const newDate = toDateOnly(
      addDaysUtc(parseDateOnly(todayInOslo())!, 10),
    );

    const result = await rescheduleBooking(customer(), {
      bookingId: "br-1",
      requestedDate: newDate,
      requestedFrom: "09:00",
      requestedTo: "11:00",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.bookingRequest.update).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.bookingRequestEvent.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.notifyWorkOrderEvent).not.toHaveBeenCalled();
  });
});
