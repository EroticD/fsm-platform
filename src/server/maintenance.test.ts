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
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/server/visits", () => ({
  createDefaultVisit: mocks.createDefaultVisit,
}));
vi.mock("@/lib/departments", () => ({
  getDefaultDepartmentId: mocks.getDefaultDepartmentId,
}));

import {
  createMaintenancePlan,
  deleteMaintenancePlan,
  evaluateMeterMaintenance,
  generateDueMaintenanceWorkOrders,
  maintenanceConcurrency,
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

describe("redigering og sletting av vedlikeholdsplan", () => {
  it("oppdaterer alle redigerbare felter og revisjonslogger", async () => {
    mocks.prisma.maintenancePlan.findUnique.mockResolvedValue({
      id: "plan-1",
      title: "Gammel tittel",
      trigger: "CALENDAR",
      intervalMonths: 12,
      meterInterval: null,
      nextDueDate: null,
    });

    const result = await updateMaintenancePlan(actor(), {
      id: "plan-1",
      title: "Ny tittel",
      isActive: false,
      intervalMonths: "6",
      meterInterval: "250",
      leadDays: "30",
      nextDueDate: "2027-01-15",
    });

    expect(result).toEqual({ ok: true, data: { id: "plan-1" } });
    expect(mocks.prisma.maintenancePlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: expect.objectContaining({
        title: "Ny tittel",
        isActive: false,
        intervalMonths: 6,
        leadDays: 30,
      }),
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({ entityType: "MaintenancePlan", entityId: "plan-1" }),
    );
  });

  it("sletter en plan uten forekomster", async () => {
    mocks.prisma.maintenancePlan.findUnique.mockResolvedValue({
      id: "plan-1",
      title: "Årlig service",
      _count: { occurrences: 0 },
    });

    const result = await deleteMaintenancePlan(actor(), "plan-1");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.maintenancePlan.delete).toHaveBeenCalledWith({
      where: { id: "plan-1" },
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("blokkerer sletting når planen har forekomster", async () => {
    mocks.prisma.maintenancePlan.findUnique.mockResolvedValue({
      id: "plan-1",
      title: "Årlig service",
      _count: { occurrences: 2 },
    });

    const result = await deleteMaintenancePlan(actor(), "plan-1");

    expect(result).toEqual({
      ok: false,
      reason: "in_use",
      details: {
        code: "maintenance.errors.planInUse",
        occurrences: 2,
      },
    });
    expect(mocks.prisma.maintenancePlan.delete).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("krever equipment.manage for sletting", async () => {
    const result = await deleteMaintenancePlan(
      actor({ permissions: ["equipment.view"] }),
      "plan-1",
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.maintenancePlan.findUnique).not.toHaveBeenCalled();
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
    expect(mocks.prisma.workOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reference: expect.stringMatching(/^O-\d{6}-[A-Z0-9]{8}$/),
      }),
      select: { id: true },
    });
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

  it("behandler alle planer med begrenset parallellitet, beholder rekkefølgen og teller feil", async () => {
    const now = new Date("2026-10-30T08:00:00.000Z");
    const due = new Date("2026-10-29T00:00:00.000Z");
    const duePlans = Array.from({ length: 7 }, (_, index) => ({
      id: `plan-${index + 1}`,
      nextDueDate: due,
      leadDays: 14,
    }));
    mocks.prisma.maintenancePlan.findMany.mockResolvedValue([
      ...duePlans.slice(0, 3),
      // Utenfor ledetiden: skal verken behandles eller telle med i resultatet.
      {
        id: "plan-framtid",
        nextDueDate: new Date("2027-06-01T00:00:00.000Z"),
        leadDays: 14,
      },
      ...duePlans.slice(3),
    ]);

    let active = 0;
    let maxActive = 0;
    mocks.prisma.maintenancePlan.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (where.id === "plan-5") throw new Error("plan feilet");
        return {
          id: where.id,
          title: `Plan ${where.id}`,
          trigger: "CALENDAR",
          isActive: true,
          customerId: "cust",
          departmentId: "dep-a",
          productId: null,
          templateId: null,
          nextDueDate: due,
          intervalMonths: 12,
          leadDays: 14,
          customer: { id: "cust", name: "Kunde", deletedAt: null },
        };
      },
    );

    const result = await generateDueMaintenanceWorkOrders(now, {
      concurrency: 3,
    });

    // Samme rekkefølge som planene ble hentet, uavhengig av hvem som ble
    // ferdig først.
    expect(result.map((item) => item.planId)).toEqual(
      duePlans.map((plan) => plan.id),
    );
    expect(result.filter((item) => item.skipped === "error")).toEqual([
      { planId: "plan-5", skipped: "error", error: "plan feilet" },
    ]);
    // Feilen stoppet ikke de andre planene.
    expect(
      result.filter((item) => item.workOrderId === "wo-new"),
    ).toHaveLength(6);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(7);
    // Aldri over grensen, men faktisk mer enn én om gangen.
    expect(maxActive).toBe(3);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "maintenance: generation finished with errors",
      { failed: 1, processed: 7, concurrency: 3 },
    );
  });

  it("leser MAINTENANCE_CONCURRENCY med standard 3 og tak på 8", () => {
    expect(maintenanceConcurrency({})).toBe(3);
    expect(maintenanceConcurrency({ MAINTENANCE_CONCURRENCY: "2" })).toBe(2);
    expect(maintenanceConcurrency({ MAINTENANCE_CONCURRENCY: "0" })).toBe(3);
    expect(maintenanceConcurrency({ MAINTENANCE_CONCURRENCY: "tull" })).toBe(3);
    expect(maintenanceConcurrency({ MAINTENANCE_CONCURRENCY: "99" })).toBe(8);
  });
});
