import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    department: { findMany: vi.fn() },
    workOrder: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    capacityPlan: { findMany: vi.fn() },
    businessHours: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import {
  exportProfitabilityCsv,
  getProfitability,
  internalCostRateOrePerHour,
} from "./bi";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "office-1",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: ["reports.view"] },
    ...overrides,
  };
}

function admin() {
  return actor({ id: "admin-1", role: "ADMIN", departmentId: null });
}

function workOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    reference: "O-1",
    title: "Service",
    status: "COMPLETED",
    scheduledFor: new Date("2026-11-02T00:00:00.000Z"),
    departmentId: "dep-a",
    department: { name: "Hovedavdeling" },
    customerId: "cust-1",
    customer: { name: "Kunde AS" },
    deviationSourceKey: null,
    technicians: [{ id: "tech-1", name: "Ola Montør" }],
    contract: {
      priceList: {
        items: [{ code: "TIME", unit: "time", amount: "1000.00" }],
      },
    },
    reports: [{ dataJson: '{"status":"GODKJENT"}' }],
    visits: [
      {
        startsAt: new Date("2026-11-02T08:00:00.000Z"),
        status: "DONE",
        enRouteAt: new Date("2026-11-02T08:00:00.000Z"),
        onSiteAt: new Date("2026-11-02T08:10:00.000Z"),
        doneAt: new Date("2026-11-02T09:10:00.000Z"),
        travelFromEndedAt: new Date("2026-11-02T09:25:00.000Z"),
        technicians: [{ userId: "tech-1" }],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BI_INTERNAL_COST_RATE_NOK;
  mocks.prisma.department.findMany.mockResolvedValue([
    { id: "dep-a", name: "Hovedavdeling" },
  ]);
  mocks.prisma.workOrder.findMany.mockResolvedValue([workOrderRow()]);
  mocks.prisma.user.findMany.mockResolvedValue([
    {
      id: "tech-1",
      name: "Ola Montør",
      departmentId: "dep-a",
      availability: [],
    },
  ]);
  mocks.prisma.capacityPlan.findMany.mockResolvedValue([]);
  mocks.prisma.businessHours.findMany.mockResolvedValue([]);
  mocks.prisma.customer.findMany.mockResolvedValue([
    { id: "cust-1", name: "Kunde AS" },
  ]);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.audit.mockResolvedValue(undefined);
});

describe("lønnsomhetstjenesten – tilgang og omfang", () => {
  it("nekter montør og kundeportalbruker", async () => {
    expect(
      (await getProfitability(actor({ role: "TECHNICIAN" }), {})).ok,
    ).toBe(false);
    expect(
      (await getProfitability(actor({ role: "CUSTOMER" }), {})).ok,
    ).toBe(false);
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it("nekter kontor uten reports.view", async () => {
    const result = await getProfitability(
      actor({ roleDefinition: { permissions: [] } }),
      {},
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it("begrenser kontor til egen avdeling", async () => {
    await getProfitability(actor(), {
      from: "2026-11-01",
      to: "2026-11-30",
    });

    expect(mocks.prisma.department.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "dep-a", isActive: true }),
      }),
    );
    expect(mocks.prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: { in: ["dep-a"] },
          deletedAt: null,
        }),
      }),
    );
  });

  it("nekter kontor å filtrere på en annen avdeling", async () => {
    const result = await getProfitability(actor(), {
      departmentId: "dep-b",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.department.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it("lar administrator velge avdeling", async () => {
    mocks.prisma.department.findMany.mockResolvedValue([
      { id: "dep-b", name: "Avdeling B" },
    ]);
    mockDepartmentScopedEmpty();

    await getProfitability(admin(), {
      from: "2026-11-01",
      to: "2026-11-30",
      departmentId: "dep-b",
    });

    expect(mocks.prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: { in: ["dep-b"] },
        }),
      }),
    );
  });

  it("gir tomt datasett når avdelingen mangler", async () => {
    mocks.prisma.department.findMany.mockResolvedValue([]);

    const result = await getProfitability(actor(), {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.orders.total).toBe(0);
    expect(result.data.perTechnician).toEqual([]);
    expect(result.data.revenue.actualAvailable).toBe(false);
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });
});

function mockDepartmentScopedEmpty() {
  mocks.prisma.workOrder.findMany.mockResolvedValue([]);
  mocks.prisma.user.findMany.mockResolvedValue([]);
  mocks.prisma.customer.findMany.mockResolvedValue([]);
}

describe("lønnsomhetstjenesten – tall", () => {
  it("regner tid med reise, first-time-fix og estimert inntekt", async () => {
    const result = await getProfitability(actor(), {
      from: "2026-11-02",
      to: "2026-11-02",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;

    expect(data.orders.total).toBe(1);
    expect(data.time.totalMinutes).toBe(85);
    expect(data.time.travelMinutes).toBe(25);
    expect(data.firstTimeFix).toMatchObject({ eligible: 1, fixed: 1, rate: 100 });
    expect(data.revenue.estimatedRevenueOre).toBe(100_000);
    expect(data.revenue.actualAvailable).toBe(false);
    expect(data.revenue.actualRevenueOre).toBeNull();
    expect(data.revenue.basis).toBe("contract_price_list");
    expect(data.perOrder[0]).toMatchObject({
      reference: "O-1",
      totalMinutes: 85,
      estimatedRevenueOre: 100_000,
    });
  });

  it("bruker intern kostnadssats fra miljøet når den er satt", async () => {
    process.env.BI_INTERNAL_COST_RATE_NOK = "500";

    const result = await getProfitability(actor(), {
      from: "2026-11-02",
      to: "2026-11-02",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.revenue.costBasis).toBe("internal_rate");
    expect(result.data.revenue.estimatedCostOre).toBe(70_833);
    expect(result.data.revenue.estimatedProfitOre).toBe(29_167);
  });

  it("sender kunde- og montørfilter videre", async () => {
    await getProfitability(actor(), {
      from: "2026-11-01",
      to: "2026-11-30",
      customerId: "cust-1",
      technicianId: "tech-1",
    });

    expect(mocks.prisma.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: "cust-1",
          technicians: { some: { id: "tech-1" } },
        }),
      }),
    );
  });

  it("avviser datasett over taket", async () => {
    mocks.prisma.workOrder.findMany.mockResolvedValue(
      Array.from({ length: 5_001 }, (_, index) =>
        workOrderRow({ id: `wo-${index}`, reference: `O-${index}` }),
      ),
    );

    const result = await getProfitability(actor(), {
      from: "2026-11-01",
      to: "2026-11-30",
    });

    expect(result).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("lønnsomhetseksport", () => {
  it("eksporterer deterministisk CSV og reviderer eksporten", async () => {
    const first = await exportProfitabilityCsv(actor(), {
      from: "2026-11-02",
      to: "2026-11-02",
    });
    const second = await exportProfitabilityCsv(actor(), {
      from: "2026-11-02",
      to: "2026-11-02",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.data.csv).toBe(second.data.csv);
    expect(first.data.checksum).toBe(second.data.checksum);
    expect(first.data.fileName).toBe("lonnsomhet-2026-11-02-2026-11-02.csv");
    expect(first.data.csv).toContain("Estimert inntekt");
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "ProfitabilityExport",
        entityId: first.data.checksum,
        departmentId: "dep-a",
      }),
    );
  });

  it("nekter eksport på tvers av avdeling", async () => {
    const result = await exportProfitabilityCsv(actor(), {
      departmentId: "dep-b",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("leser kostnadssats robust", () => {
    expect(internalCostRateOrePerHour({ BI_INTERNAL_COST_RATE_NOK: "450,5" })).toBe(
      45_050,
    );
    expect(internalCostRateOrePerHour({ BI_INTERNAL_COST_RATE_NOK: "-1" })).toBeNull();
    expect(internalCostRateOrePerHour({})).toBeNull();
  });
});
