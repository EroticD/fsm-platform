import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    maintenancePlan: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    maintenancePlanOccurrence: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    product: { findFirst: vi.fn(), findMany: vi.fn() },
    customer: { findFirst: vi.fn(), findMany: vi.fn() },
    department: { findFirst: vi.fn() },
    template: { findUnique: vi.fn() },
    meterReading: { findFirst: vi.fn(), findMany: vi.fn() },
    workOrder: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
  audit: vi.fn(),
  createDefaultVisit: vi.fn(),
  getDefaultDepartmentId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/visits", () => ({
  createDefaultVisit: mocks.createDefaultVisit,
}));
vi.mock("@/lib/departments", () => ({
  getDefaultDepartmentId: mocks.getDefaultDepartmentId,
}));

import {
  createMaintenancePlan,
  evaluateMeterMaintenance,
  generateDueMaintenanceWorkOrders,
  updateMaintenancePlan,
} from "./maintenance";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "user-1",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissionsCustomized: true,
    permissions: ["equipment.view", "equipment.manage"],
    roleDefinition: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.$queryRaw.mockResolvedValue([]);
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.audit.mockResolvedValue(undefined);
  mocks.createDefaultVisit.mockResolvedValue(undefined);
  mocks.getDefaultDepartmentId.mockResolvedValue("dep-a");
  mocks.prisma.maintenancePlan.create.mockResolvedValue({ id: "plan-new" });
  mocks.prisma.maintenancePlan.update.mockResolvedValue({});
  mocks.prisma.maintenancePlanOccurrence.create.mockResolvedValue({
    id: "occ-new",
  });
  mocks.prisma.workOrder.create.mockResolvedValue({ id: "wo-new" });
});

describe("vedlikeholdsplaner – validering", () => {
  it("krever enhet for målerbaserte planer", async () => {
    const result = await createMaintenancePlan(actor(), {
      title: "Målerservice",
      trigger: "METER",
      meterInterval: 100,
      customerId: "cust",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      details: { code: "maintenance.errors.productRequired" },
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("krever neste forfall for kalenderplaner", async () => {
    const result = await createMaintenancePlan(actor(), {
      title: "Årlig service",
      trigger: "CALENDAR",
      intervalMonths: 12,
      customerId: "cust",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      details: { code: "maintenance.errors.invalidDueDate" },
    });
  });

  it("nekter planendring uten equipment.manage", async () => {
    const result = await updateMaintenancePlan(
      actor({ permissions: ["equipment.view"] }),
      { id: "plan-1", isActive: false },
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("målerplan", () => {
  it("lager ett oppdrag når terskelen passeres", async () => {
    mocks.prisma.maintenancePlan.findMany.mockResolvedValue([{ id: "plan-1" }]);
    mocks.prisma.maintenancePlan.findUnique.mockResolvedValue({
      id: "plan-1",
      title: "Service hver 100. time",
      trigger: "METER",
      isActive: true,
      customerId: "cust",
      departmentId: "dep-a",
      productId: "product-1",
      templateId: null,
      meterInterval: { toString: () => "100" },
      lastMeterValue: { toString: () => "1000" },
      customer: { deletedAt: null },
      product: {
        id: "product-1",
        model: "Pumpe",
        meterUnit: "timer",
        customer: { deletedAt: null },
      },
    });
    mocks.prisma.maintenancePlanOccurrence.findUnique.mockResolvedValue(null);

    const result = await evaluateMeterMaintenance(mocks.prisma as never, {
      productId: "product-1",
      value: 1100,
      readAt: new Date("2026-10-30T10:00:00.000Z"),
      actor: actor(),
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.maintenancePlanOccurrence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planId: "plan-1",
          status: "GENERATED",
          workOrderId: "wo-new",
        }),
      }),
    );
    expect(mocks.createDefaultVisit).toHaveBeenCalledTimes(1);
  });

  it("lager ikke oppdrag under terskelen", async () => {
    mocks.prisma.maintenancePlan.findMany.mockResolvedValue([{ id: "plan-1" }]);
    mocks.prisma.maintenancePlan.findUnique.mockResolvedValue({
      id: "plan-1",
      title: "Service",
      trigger: "METER",
      isActive: true,
      customerId: "cust",
      departmentId: "dep-a",
      productId: "product-1",
      templateId: null,
      meterInterval: { toString: () => "100" },
      lastMeterValue: { toString: () => "1000" },
      customer: { deletedAt: null },
      product: {
        id: "product-1",
        model: "Pumpe",
        meterUnit: "timer",
        customer: { deletedAt: null },
      },
    });

    const result = await evaluateMeterMaintenance(mocks.prisma as never, {
      productId: "product-1",
      value: 1050,
      readAt: new Date("2026-10-30T10:00:00.000Z"),
      actor: actor(),
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("setter utgangspunkt uten oppdrag på første måling", async () => {
    mocks.prisma.maintenancePlan.findMany.mockResolvedValue([{ id: "plan-1" }]);
    mocks.prisma.maintenancePlan.findUnique.mockResolvedValue({
      id: "plan-1",
      title: "Service",
      trigger: "METER",
      isActive: true,
      customerId: "cust",
      departmentId: "dep-a",
      productId: "product-1",
      templateId: null,
      meterInterval: { toString: () => "100" },
      lastMeterValue: null,
      customer: { deletedAt: null },
      product: {
        id: "product-1",
        model: "Pumpe",
        meterUnit: "timer",
        customer: { deletedAt: null },
      },
    });

    await evaluateMeterMaintenance(mocks.prisma as never, {
      productId: "product-1",
      value: 1000,
      readAt: new Date("2026-10-30T10:00:00.000Z"),
      actor: actor(),
    });

    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
    expect(mocks.prisma.maintenancePlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { lastMeterValue: expect.anything() },
    });
  });
});

describe("kalendergenerering", () => {
  it("hopper over planer utenfor ledetiden", async () => {
    mocks.prisma.maintenancePlan.findMany.mockResolvedValue([
      {
        id: "plan-1",
        nextDueDate: new Date("2027-01-01T00:00:00.000Z"),
        leadDays: 14,
      },
    ]);

    const result = await generateDueMaintenanceWorkOrders(
      new Date("2026-10-30T08:00:00.000Z"),
    );

    expect(result).toEqual([]);
    expect(mocks.prisma.maintenancePlan.findUnique).not.toHaveBeenCalled();
  });
});
