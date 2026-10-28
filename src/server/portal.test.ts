import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    report: { update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { acknowledgeReport, getPortalReportHistory } from "./portal";

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
  mocks.prisma.report.update.mockResolvedValue({});
  mocks.prisma.report.updateMany.mockResolvedValue({ count: 1 });
});

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
});
