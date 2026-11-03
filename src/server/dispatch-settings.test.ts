import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    department: { findFirst: vi.fn() },
    assignmentPolicy: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    territory: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import {
  saveAssignmentPolicy,
  saveTerritory,
  deleteTerritory,
} from "./dispatch";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "office-1",
    name: "Ola Kontor",
    email: "ola@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissions: ["dispatch.configure"],
    permissionsCustomized: true,
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
  mocks.prisma.department.findFirst.mockResolvedValue({
    id: "dep-a",
    name: "Avdeling A",
  });
  mocks.prisma.assignmentPolicy.findFirst.mockResolvedValue(null);
  mocks.prisma.assignmentPolicy.findMany.mockResolvedValue([]);
  mocks.prisma.assignmentPolicy.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "policy-new",
      ...data,
    }),
  );
  mocks.prisma.assignmentPolicy.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "policy-1",
      ...data,
    }),
  );
  mocks.prisma.territory.findFirst.mockResolvedValue(null);
  mocks.prisma.territory.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "territory-new",
      ...data,
    }),
  );
  mocks.prisma.territory.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "territory-1",
      ...data,
    }),
  );
  mocks.audit.mockResolvedValue(undefined);
});

describe("dispatch-policyer", () => {
  it("oppretter flere policyer for samme avdeling og revisjonslogger", async () => {
    const first = await saveAssignmentPolicy(actor(), {
      departmentId: "dep-a",
      mode: "SKILLS",
      weights: { skills: 30 },
    });
    const second = await saveAssignmentPolicy(actor(), {
      departmentId: "dep-a",
      mode: "DISTANCE",
      weights: { distance: 40 },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(mocks.prisma.assignmentPolicy.create).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
  });

  it("avviser identisk aktiv policy i samme avdeling", async () => {
    mocks.prisma.assignmentPolicy.findMany.mockResolvedValue([
      { id: "policy-1", mode: "SKILLS", weights: {} },
    ]);

    const result = await saveAssignmentPolicy(actor(), {
      departmentId: "dep-a",
      mode: "SKILLS",
      weights: {},
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "dispatch.errors.conflict" },
    });
    expect(mocks.prisma.assignmentPolicy.create).not.toHaveBeenCalled();
  });

  it("redigerer og deaktiverer en eksisterende policy", async () => {
    mocks.prisma.assignmentPolicy.findFirst.mockResolvedValue({ id: "policy-1" });

    const result = await saveAssignmentPolicy(actor(), {
      id: "policy-1",
      departmentId: "dep-a",
      mode: "CUSTOM",
      weights: { skills: 70 },
      isActive: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.assignmentPolicy.update).toHaveBeenCalledWith({
      where: { id: "policy-1" },
      data: expect.objectContaining({ mode: "CUSTOM", isActive: false }),
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("lar ikke en kontorbruker endre en annen avdeling", async () => {
    const result = await saveAssignmentPolicy(actor(), {
      departmentId: "dep-b",
      mode: "SKILLS",
      weights: {},
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.assignmentPolicy.create).not.toHaveBeenCalled();
  });
});

describe("territorier", () => {
  it("redigerer alle feltene og aktivstatus", async () => {
    mocks.prisma.territory.findFirst.mockResolvedValue({ id: "territory-1" });

    const result = await saveTerritory(actor(), {
      id: "territory-1",
      departmentId: "dep-a",
      name: "Oslo vest",
      postalPrefixes: "02, 03",
      municipalityCodes: "0301",
      radiusKm: 25,
      centerLat: 59.91,
      centerLng: 10.75,
      isActive: false,
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.territory.update).toHaveBeenCalledWith({
      where: { id: "territory-1" },
      data: expect.objectContaining({
        name: "Oslo vest",
        postalPrefixes: ["02", "03"],
        municipalityCodes: ["0301"],
        radiusKm: 25,
        isActive: false,
      }),
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("avviser territorium i en annen avdeling for ikke-admin", async () => {
    const result = await saveTerritory(actor(), {
      departmentId: "dep-b",
      name: "Bergen",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.territory.create).not.toHaveBeenCalled();
  });

  it("sletter bare territorium i egen avdeling", async () => {
    mocks.prisma.territory.findFirst.mockResolvedValue({
      id: "territory-1",
      departmentId: "dep-a",
      name: "Oslo",
    });

    const result = await deleteTerritory(actor(), "territory-1");

    expect(result.ok).toBe(true);
    expect(mocks.prisma.territory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "territory-1", departmentId: "dep-a" },
      }),
    );
    expect(mocks.prisma.territory.delete).toHaveBeenCalledWith({
      where: { id: "territory-1" },
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
