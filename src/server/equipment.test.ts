import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    product: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    equipmentCategory: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    meterReading: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    upload: { findMany: vi.fn() },
    customer: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    workOrder: { findMany: vi.fn() },
    reportUnit: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/notifications", () => ({ notifyUser: mocks.notifyUser }));

import {
  buildCategoryTree,
  buildEquipmentTree,
  createEquipment,
  equipmentScopeFor,
  listExpiringWarranties,
  resolveEquipmentQrToken,
  updateEquipment,
  updateEquipmentCategory,
  type EquipmentForestItem,
} from "./equipment";

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
  mocks.audit.mockResolvedValue(undefined);
  mocks.notifyUser.mockResolvedValue({ id: "notification-1" });
  mocks.prisma.product.create.mockResolvedValue({ id: "product-new" });
  mocks.prisma.product.update.mockResolvedValue({});
  mocks.prisma.product.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.equipmentCategory.create.mockResolvedValue({ id: "cat-new" });
  mocks.prisma.meterReading.create.mockResolvedValue({ id: "reading-1" });
  mocks.prisma.user.findMany.mockResolvedValue([{ id: "user-1" }]);
});

describe("utstyrstre", () => {
  const base = {
    id: "a",
    model: "Bygg A",
    serialNumber: null,
    location: null,
    parentId: null,
    customerId: "cust",
    customer: { id: "cust", name: "Kunde" },
    category: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { children: 1 },
  } as unknown as EquipmentForestItem;

  it("bygger et dypt tre uten å miste foreldreløse noder", () => {
    const child = {
      ...base,
      id: "b",
      model: "System",
      parentId: "a",
      _count: { children: 1 },
    } as EquipmentForestItem;
    const leaf = {
      ...base,
      id: "c",
      model: "Enhet",
      parentId: "b",
      _count: { children: 0 },
    } as EquipmentForestItem;
    const orphan = {
      ...base,
      id: "d",
      model: "Foreldreløs",
      parentId: "missing",
      _count: { children: 0 },
    } as EquipmentForestItem;

    const tree = buildEquipmentTree([leaf, child, base, orphan]);
    expect(tree.map((node) => node.id).sort()).toEqual(["a", "d"]);
    expect(tree.find((node) => node.id === "a")?.children[0].children[0].id).toBe(
      "c",
    );
  });

  it("summerer enheter oppover i kategoritreet", () => {
    const tree = buildCategoryTree([
      {
        id: "cat-a",
        name: "Bygg",
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        productCount: 2,
      },
      {
        id: "cat-b",
        name: "Ventilasjon",
        parentId: "cat-a",
        createdAt: new Date(),
        updatedAt: new Date(),
        productCount: 3,
      },
    ]);
    expect(tree[0].productCount).toBe(5);
    expect(tree[0].children[0].productCount).toBe(3);
  });
});

describe("hierarki og autorisasjon", () => {
  it("avviser flytting som lager en syklus", async () => {
    mocks.prisma.product.findFirst
      .mockResolvedValueOnce({
        id: "a",
        model: "A",
        customerId: "cust",
        parentId: null,
        categoryId: null,
        installDate: null,
        warrantyUntil: null,
        status: "ACTIVE",
        criticality: 2,
        meterUnit: null,
        serialNumber: null,
        location: null,
      })
      .mockResolvedValueOnce({ id: "b", customerId: "cust" });
    mocks.prisma.product.findUnique.mockResolvedValueOnce({ parentId: "a" });

    const result = await updateEquipment(actor(), { id: "a", parentId: "b" });

    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.hierarchyCycle" },
    });
    expect(mocks.prisma.product.update).not.toHaveBeenCalled();
  });

  it("avviser forelder hos en annen kunde", async () => {
    mocks.prisma.product.findFirst
      .mockResolvedValueOnce({
        id: "a",
        model: "A",
        customerId: "cust-a",
        parentId: null,
        categoryId: null,
        installDate: null,
        warrantyUntil: null,
        status: "ACTIVE",
        criticality: 2,
        meterUnit: null,
        serialNumber: null,
        location: null,
      })
      .mockResolvedValueOnce({ id: "b", customerId: "cust-b" });

    const result = await updateEquipment(actor(), { id: "a", parentId: "b" });
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.customerMismatch" },
    });
  });

  it("nekter mutasjon uten equipment.manage før databasen røres", async () => {
    const result = await updateEquipment(
      actor({ permissions: ["equipment.view"] }),
      { id: "a", model: "A" },
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser kategori som flyttes under sin egen etterkommer", async () => {
    mocks.prisma.equipmentCategory.findUnique
      .mockResolvedValueOnce({ id: "cat-a", name: "A" })
      .mockResolvedValueOnce({ id: "cat-b" })
      .mockResolvedValueOnce({ parentId: "cat-a" });

    const result = await updateEquipmentCategory(actor(), {
      id: "cat-a",
      name: "A",
      parentId: "cat-b",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.categoryCycle" },
    });
    expect(mocks.prisma.equipmentCategory.update).not.toHaveBeenCalled();
  });

  it("begrenser kundeaktører til egne enheter", () => {
    expect(
      equipmentScopeFor(actor({ role: "CUSTOMER", customerId: "cust-1" })),
    ).toEqual({
      customerId: "cust-1",
      customer: { deletedAt: null },
    });
    expect(equipmentScopeFor(actor({ isActive: false }))).toEqual({
      id: { in: [] },
    });
  });
});

describe("opprettelse og QR", () => {
  it("utsteder en unik QR-token ved opprettelse", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue({ id: "cust" });

    const result = await createEquipment(actor(), {
      customerId: "cust",
      model: "Pumpe",
      serialNumber: "SN-1",
      criticality: 1,
    });

    expect(result).toEqual({ ok: true, data: { id: "product-new" } });
    const data = mocks.prisma.product.create.mock.calls[0][0].data;
    expect(data.qrToken).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(data.status).toBe("ACTIVE");
    expect(data.criticality).toBe(1);
  });

  it("avviser ugyldig QR-token uten databaseoppslag", async () => {
    await expect(resolveEquipmentQrToken("kort")).resolves.toBeNull();
    expect(mocks.prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it("slår opp en gyldig QR-token", async () => {
    mocks.prisma.product.findFirst.mockResolvedValue({
      id: "product-1",
      model: "Pumpe",
    });
    await expect(
      resolveEquipmentQrToken("abcdefghijklmnopqrstuvwx"),
    ).resolves.toEqual({ id: "product-1", model: "Pumpe" });
  });
});

describe("garanti", () => {
  it("filtrerer på garantiutløp og ignorerer utfasede enheter", async () => {
    mocks.prisma.product.findMany.mockResolvedValue([]);
    const result = await listExpiringWarranties(actor(), 30);

    expect(result.ok).toBe(true);
    const where = mocks.prisma.product.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "RETIRED" });
    expect(where.warrantyUntil.gte).toBeInstanceOf(Date);
    expect(where.warrantyUntil.lte).toBeInstanceOf(Date);
    expect(mocks.prisma.product.findMany.mock.calls[0][0].take).toBe(100);
  });
});
