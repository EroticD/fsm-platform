import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  getPortalReportOverview,
  PORTAL_REPORT_PAGE_SIZE,
} from "./portal-report-overview";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "kunde-1",
    name: "Kunde",
    email: "kunde@example.com",
    role: "CUSTOMER",
    isActive: true,
    departmentId: "dep-a",
    customerId: "cust-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.workOrder.findMany.mockResolvedValue([]);
  mocks.prisma.workOrder.count.mockResolvedValue(0);
});

describe("getPortalReportOverview", () => {
  it("henter alle rapporter på hvert oppdrag, ikke bare den nyeste", async () => {
    mocks.prisma.workOrder.findMany.mockResolvedValue([
      {
        id: "wo1",
        title: "Service",
        orderNumber: "ORD-1",
        scheduledFor: new Date("2026-01-02T00:00:00Z"),
        reports: [
          { id: "rep1", name: "Rapport 1", completedAt: new Date() },
          { id: "rep2", name: "Rapport 2", completedAt: new Date() },
        ],
      },
    ]);
    mocks.prisma.workOrder.count.mockResolvedValue(1);

    const result = await getPortalReportOverview(actor(), { page: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      items: Array<{ reports: unknown[] }>;
      totalPages: number;
    };
    expect(data.items[0].reports).toHaveLength(2);
    expect(mocks.prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: "cust-1" }),
        skip: 0,
        take: PORTAL_REPORT_PAGE_SIZE,
        select: expect.objectContaining({
          reports: expect.not.objectContaining({ take: expect.anything() }),
        }),
      }),
    );
  });

  it("paginerer oppdragene", async () => {
    mocks.prisma.workOrder.count.mockResolvedValue(
      PORTAL_REPORT_PAGE_SIZE * 2 + 1,
    );

    const result = await getPortalReportOverview(actor(), { page: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { page: number; totalPages: number };
    expect(data.page).toBe(2);
    expect(data.totalPages).toBe(3);
    expect(mocks.prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: PORTAL_REPORT_PAGE_SIZE }),
    );
  });

  it("nekter ansatte og kunder uten kundetilknytning", async () => {
    expect(
      await getPortalReportOverview(actor({ role: "OFFICE" })),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      await getPortalReportOverview(actor({ customerId: null })),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });
});
