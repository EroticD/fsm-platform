import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  requireModule: vi.fn(async () => true),
  audit: vi.fn(),
  prisma: {
    purchaseOrder: { findMany: vi.fn() },
    supplier: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/modules", () => ({ requireModule: mocks.requireModule }));

import {
  createSupplier,
  listPurchaseOrders,
  listSuppliers,
  purchaseOrderScope,
  supplierScope,
} from "./purchasing";

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
  mocks.requireModule.mockResolvedValue(true);
  mocks.prisma.purchaseOrder.findMany.mockResolvedValue([]);
  mocks.prisma.supplier.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) => callback(mocks.prisma),
  );
});

describe("innkjøp – rettigheter og avdelingssperre", () => {
  it("avviser lesing uten equipment.view", async () => {
    const denied = await listPurchaseOrders(
      actor({ permissions: ["equipment.manage"] }),
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("forbidden");
  });

  it("gir 404 når inventory-modulen er av", async () => {
    mocks.requireModule.mockResolvedValue(false);
    const off = await listSuppliers(actor());
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toBe("not_found");
  });

  it("begrenser ordrer til egen avdeling, men administrator ser alt", () => {
    expect(purchaseOrderScope(actor())).toEqual({ departmentId: "dep-a" });
    expect(purchaseOrderScope(actor({ role: "ADMIN" }))).toEqual({});
    expect(
      purchaseOrderScope(actor({ departmentId: null })),
    ).toEqual({ id: { in: [] } });
  });

  it("lar ansatte se egne og felles leverandører", () => {
    expect(supplierScope(actor())).toEqual({
      OR: [{ departmentId: "dep-a" }, { departmentId: null }],
    });
    expect(supplierScope(actor({ role: "ADMIN" }))).toEqual({});
  });

  it("sender avdelingsfilteret videre til spørringen", async () => {
    await listPurchaseOrders(actor({ role: "ADMIN" }));
    const adminCall = mocks.prisma.purchaseOrder.findMany.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>;
    };
    expect(adminCall.where.departmentId).toBeUndefined();

    await listPurchaseOrders(actor());
    const call = mocks.prisma.purchaseOrder.findMany.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>;
    };
    expect(call.where.departmentId).toBe("dep-a");
  });

  it("avviser oppretting av leverandør uten equipment.manage", async () => {
    const denied = await createSupplier(
      actor({ permissions: ["equipment.view"] }),
      { name: "Nordisk Verktøy" },
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("forbidden");
    expect(mocks.prisma.supplier.create).not.toHaveBeenCalled();
  });

  it("setter egen avdeling på leverandøren og reviderer i samme transaksjon", async () => {
    mocks.prisma.supplier.create.mockResolvedValue({
      id: "supplier-1",
      name: "Nordisk Verktøy",
    });

    const created = await createSupplier(actor(), {
      name: "Nordisk Verktøy",
      orgNumber: "123 456 789",
    });
    expect(created.ok).toBe(true);
    expect(mocks.prisma.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Nordisk Verktøy",
          orgNumber: "123456789",
          departmentId: "dep-a",
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "Supplier",
        entityId: "supplier-1",
        departmentId: "dep-a",
      }),
    );
  });

  it("lar administrator opprette en felles leverandør uten avdeling", async () => {
    mocks.prisma.supplier.create.mockResolvedValue({
      id: "supplier-2",
      name: "Felles Leverandør",
    });
    const created = await createSupplier(
      actor({ role: "ADMIN", departmentId: null }),
      { name: "Felles Leverandør" },
    );
    expect(created.ok).toBe(true);
    expect(mocks.prisma.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ departmentId: null }),
      }),
    );
  });
});
