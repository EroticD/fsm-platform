import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    report: { update: vi.fn() },
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
      expect.objectContaining({ take: 20, skip: 0 }),
    );
  });

  it("avviser kvittering for en annen kundes oppdrag", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo1",
      customerId: "cust-2",
      reports: [{ id: "r1", customerAcknowledgedAt: null }],
    });

    const result = await acknowledgeReport(customer(), { workOrderId: "wo1" });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.report.update).not.toHaveBeenCalled();
  });

  it("kvitterer for egen rapport og logger det", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [{ id: "r1", customerAcknowledgedAt: null }],
    });

    const result = await acknowledgeReport(customer(), {
      workOrderId: "wo1",
      comment: "Mottatt",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.report.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({
        customerAcknowledgedBy: "Kunde",
        customerAcknowledgedComment: "Mottatt",
      }),
    });
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("er idempotent når rapporten allerede er kvittert", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo1",
      customerId: "cust-1",
      reports: [{ id: "r1", customerAcknowledgedAt: new Date() }],
    });

    const result = await acknowledgeReport(customer(), { workOrderId: "wo1" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.report.update).not.toHaveBeenCalled();
  });
});
