import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    capacityPlan: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    department: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/routing", () => ({
  getRoutingProvider: () => ({
    matrix: vi.fn(async () => []),
    route: vi.fn(async () => ({ distanceKm: 0, durationMinutes: 0 })),
  }),
}));
vi.mock("@/server/business-hours", () => ({
  loadBusinessCalendar: vi.fn(async () => ({ windows: [] })),
}));
vi.mock("./visits", () => ({ assignVisitInTransaction: vi.fn() }));

import {
  deleteCapacityPlan,
  listCapacityPlans,
  upsertCapacityPlan,
} from "./dispatch";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    contactId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: ["dispatch.configure", "workorders.view"],
    },
    ...overrides,
  };
}

const noConfig = () =>
  actor({ roleDefinition: { permissions: ["workorders.view"] } });
const admin = () => actor({ role: "ADMIN" });

const planRow = (overrides: Record<string, unknown> = {}) => ({
  id: "plan-1",
  departmentId: "dep-a",
  date: new Date("2026-11-02T00:00:00.000Z"),
  technicianId: null,
  capacityMinutes: 480,
  department: { name: "Hovedavdelning" },
  technician: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.capacityPlan.findFirst.mockResolvedValue(null);
  mocks.prisma.capacityPlan.findUnique.mockResolvedValue(null);
  mocks.prisma.capacityPlan.findMany.mockResolvedValue([]);
  mocks.prisma.capacityPlan.create.mockResolvedValue({
    id: "plan-new",
    capacityMinutes: 480,
  });
  mocks.prisma.capacityPlan.update.mockResolvedValue({
    id: "plan-1",
    capacityMinutes: 420,
  });
  mocks.prisma.capacityPlan.delete.mockResolvedValue({});
  mocks.prisma.department.findFirst.mockResolvedValue({
    id: "dep-a",
    name: "Hovedavdelning",
  });
  mocks.prisma.user.findFirst.mockResolvedValue({
    id: "tech-1",
    name: "Ola Montør",
  });
  mocks.audit.mockResolvedValue(undefined);
});

describe("kapasitetsplaner", () => {
  it("krever dispatch.configure for lesing og skriving", async () => {
    await expect(
      listCapacityPlans(noConfig(), { departmentId: "dep-a" }),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    await expect(
      upsertCapacityPlan(noConfig(), {
        departmentId: "dep-a",
        date: "2026-11-02",
        capacityMinutes: 480,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    await expect(
      deleteCapacityPlan(noConfig(), "plan-1"),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.capacityPlan.create).not.toHaveBeenCalled();
  });

  it("oppretter en avdelingsrad når ingen rad finnes", async () => {
    const result = await upsertCapacityPlan(actor(), {
      departmentId: "dep-a",
      date: "2026-11-02",
      capacityMinutes: "480",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: "plan-new",
        departmentId: "dep-a",
        date: "2026-11-02",
        technicianId: null,
        capacityMinutes: 480,
      },
    });
    expect(mocks.prisma.capacityPlan.create).toHaveBeenCalledWith({
      data: {
        departmentId: "dep-a",
        date: new Date("2026-11-02T00:00:00.000Z"),
        technicianId: null,
        capacityMinutes: 480,
      },
      select: { id: true, capacityMinutes: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "Department",
        entityId: "dep-a",
        action: "Oppdaterte kapasitetsplan for Hovedavdelning: 2026-11-02",
      }),
    );
  });

  it("oppdaterer eksisterende rad i stedet for å lage duplikat", async () => {
    mocks.prisma.capacityPlan.findFirst.mockResolvedValue({ id: "plan-1" });

    const result = await upsertCapacityPlan(actor(), {
      departmentId: "dep-a",
      date: "2026-11-02",
      technicianId: "tech-1",
      capacityMinutes: 420,
    });

    expect(result).toMatchObject({ ok: true, data: { id: "plan-1" } });
    expect(mocks.prisma.capacityPlan.findFirst).toHaveBeenCalledWith({
      where: {
        departmentId: "dep-a",
        date: new Date("2026-11-02T00:00:00.000Z"),
        technicianId: "tech-1",
      },
      select: { id: true },
    });
    expect(mocks.prisma.capacityPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { capacityMinutes: 420 },
      select: { id: true, capacityMinutes: true },
    });
  });

  it("avviser minutter utenfor 0–1440 og ugyldige datoer", async () => {
    for (const capacityMinutes of [-1, 1441, 1.5, "abc"]) {
      await expect(
        upsertCapacityPlan(actor(), {
          departmentId: "dep-a",
          date: "2026-11-02",
          capacityMinutes,
        }),
      ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    }
    for (const date of ["2026-02-30", "02.11.2026", ""]) {
      await expect(
        upsertCapacityPlan(actor(), {
          departmentId: "dep-a",
          date,
          capacityMinutes: 480,
        }),
      ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(mocks.prisma.capacityPlan.create).not.toHaveBeenCalled();
  });

  it("godtar 0 og 1440 som bevisste ytterpunkter", async () => {
    await expect(
      upsertCapacityPlan(actor(), {
        departmentId: "dep-a",
        date: "2026-11-02",
        capacityMinutes: 0,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      upsertCapacityPlan(actor(), {
        departmentId: "dep-a",
        date: "2026-11-02",
        capacityMinutes: 1440,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("avviser tekniker utenfor avdelingen", async () => {
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      upsertCapacityPlan(actor(), {
        departmentId: "dep-a",
        date: "2026-11-02",
        technicianId: "tech-other",
        capacityMinutes: 480,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.capacityPlan.create).not.toHaveBeenCalled();
  });

  it("hindrer at en avdelingsansvarlig skriver i en annen avdeling", async () => {
    await expect(
      upsertCapacityPlan(actor(), {
        departmentId: "dep-b",
        date: "2026-11-02",
        capacityMinutes: 480,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    await expect(
      listCapacityPlans(actor(), { departmentId: "dep-b" }),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(admin().role).toBe("ADMIN");
  });

  it("oversetter en samtidig unikhetskollisjon til conflict", async () => {
    mocks.prisma.capacityPlan.create.mockRejectedValue(
      Object.assign(new Error("unik"), { code: "P2002" }),
    );

    await expect(
      upsertCapacityPlan(actor(), {
        departmentId: "dep-a",
        date: "2026-11-02",
        capacityMinutes: 480,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "conflict" });
  });

  it("lister planer med periode og avdelingssperre", async () => {
    mocks.prisma.capacityPlan.findMany.mockResolvedValue([
      planRow(),
      planRow({
        id: "plan-2",
        technicianId: "tech-1",
        capacityMinutes: 420,
        technician: { name: "Ola Montør" },
      }),
    ]);

    const result = await listCapacityPlans(actor(), {
      departmentId: "dep-a",
      from: "2026-11-02",
      to: "2026-11-08",
    });

    expect(result).toMatchObject({
      ok: true,
      data: [
        { id: "plan-1", date: "2026-11-02", technicianName: null },
        {
          id: "plan-2",
          technicianId: "tech-1",
          technicianName: "Ola Montør",
        },
      ],
    });
    expect(mocks.prisma.capacityPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: "dep-a",
          date: {
            gte: new Date("2026-11-02T00:00:00.000Z"),
            lte: new Date("2026-11-08T00:00:00.000Z"),
          },
        },
      }),
    );
  });

  it("sletter plan innenfor avdelingen og logger det", async () => {
    mocks.prisma.capacityPlan.findUnique.mockResolvedValue(
      planRow({ technicianId: "tech-1", technician: { name: "Ola Montør" } }),
    );

    await expect(deleteCapacityPlan(actor(), "plan-1")).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.prisma.capacityPlan.delete).toHaveBeenCalledWith({
      where: { id: "plan-1" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        action:
          "Slettet kapasitetsplan for Hovedavdelning: 2026-11-02 (Ola Montør)",
      }),
    );
  });

  it("avviser sletting av plan i en annen avdeling", async () => {
    mocks.prisma.capacityPlan.findUnique.mockResolvedValue(
      planRow({ departmentId: "dep-b" }),
    );

    await expect(
      deleteCapacityPlan(actor(), "plan-1"),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.capacityPlan.delete).not.toHaveBeenCalled();
  });
});
