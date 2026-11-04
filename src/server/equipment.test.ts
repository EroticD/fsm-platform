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
    equipmentQrCode: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    upload: { findMany: vi.fn() },
    customer: { findFirst: vi.fn(), findMany: vi.fn() },
    customerSite: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    workOrder: { findMany: vi.fn() },
    reportUnit: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  notifyUser: vi.fn(),
  searchNormalizedIds: vi.fn(async () => [] as Array<{ id: string; score: number; total: number }>),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/server/notifications", () => ({ notifyUser: mocks.notifyUser }));
vi.mock("@/lib/search-sql", () => ({
  searchNormalizedIds: mocks.searchNormalizedIds,
}));

import {
  addEquipmentQrCode,
  buildCategoryTree,
  buildEquipmentTree,
  createEquipment,
  deleteEquipmentQrCode,
  equipmentScopeFor,
  getCustomerEquipmentOptions,
  getEquipmentFormOptions,
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
  mocks.prisma.equipmentQrCode.create.mockResolvedValue({ id: "qr-new" });
  mocks.prisma.equipmentQrCode.delete.mockResolvedValue({ id: "qr-new" });
  mocks.prisma.user.findMany.mockResolvedValue([{ id: "user-1" }]);
  mocks.searchNormalizedIds.mockResolvedValue([]);
});

describe("utstyrsvalg per kunde", () => {
  it("returnerer ikke steder eller enheter i de globale skjemavalgene", async () => {
    mocks.prisma.customer.findMany.mockResolvedValue([
      { id: "cust-1", name: "Kunde A" },
    ]);
    mocks.prisma.equipmentCategory.findMany.mockResolvedValue([]);

    const result = await getEquipmentFormOptions(actor());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data).sort()).toEqual(["categories", "customers"]);
    expect(mocks.prisma.product.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.customerSite.findMany).not.toHaveBeenCalled();
  });

  it("avgrenser overordnede enheter til kunden", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" });
    mocks.prisma.product.findMany.mockResolvedValue([
      { id: "p1", customerId: "cust-1", model: "Pumpe", serialNumber: null, location: null },
    ]);

    const result = await getCustomerEquipmentOptions(actor(), "cust-1");

    expect(result.ok).toBe(true);
    expect(mocks.prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { customer: { deletedAt: null } },
            { customerId: "cust-1" },
          ],
        },
      }),
    );
  });

  it("søker bare i kundens enheter med normalisert søk", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" });
    mocks.prisma.product.findMany.mockResolvedValue([]);
    mocks.searchNormalizedIds.mockResolvedValue([
      { id: "p1", score: 1, total: 1 },
    ]);

    await getCustomerEquipmentOptions(actor(), "cust-1", {
      query: "årlig service",
      excludeId: "p9",
    });

    expect(mocks.searchNormalizedIds).toHaveBeenCalledWith(
      "Product",
      "årlig service",
      200,
      undefined,
      false,
      { customerId: "cust-1" },
    );
    expect(mocks.prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { customer: { deletedAt: null } },
            { customerId: "cust-1" },
            { id: { in: ["p1"] } },
            { id: { not: "p9" } },
          ],
        },
      }),
    );
  });

  it("nekter enheter uten equipment.view", async () => {
    const result = await getCustomerEquipmentOptions(
      actor({ permissions: ["workorders.view"] }),
      "cust-1",
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.product.findMany).not.toHaveBeenCalled();
  });
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

describe("utstyrets sted", () => {
  beforeEach(() => {
    mocks.prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" });
  });

  it("lagrer sted når det tilhører kunden", async () => {
    mocks.prisma.customerSite.findFirst.mockResolvedValue({ id: "site-1" });

    const result = await createEquipment(actor(), {
      customerId: "cust-1",
      model: "Pumpe",
      siteId: "site-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.customerSite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "site-1", customerId: "cust-1" },
      }),
    );
    expect(mocks.prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ siteId: "site-1" }),
      }),
    );
  });

  it("avviser sted fra en annen kunde", async () => {
    mocks.prisma.customerSite.findFirst.mockResolvedValue(null);

    const result = await createEquipment(actor(), {
      customerId: "cust-1",
      model: "Pumpe",
      siteId: "annens-sted",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.product.create).not.toHaveBeenCalled();
  });

  it("oppdaterer stedet på enheten", async () => {
    mocks.prisma.product.findFirst.mockResolvedValue({
      id: "product-1",
      model: "Pumpe",
      customerId: "cust-1",
      parentId: null,
      siteId: null,
      categoryId: null,
      installDate: null,
      warrantyUntil: null,
      status: "ACTIVE",
      criticality: 2,
      meterUnit: null,
      serialNumber: null,
      location: null,
    });
    mocks.prisma.customerSite.findFirst.mockResolvedValue({ id: "site-1" });

    const result = await updateEquipment(actor(), {
      id: "product-1",
      siteId: "site-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: expect.objectContaining({
        site: { connect: { id: "site-1" } },
      }),
    });
  });
});

describe("eksisterende QR-koder", () => {
  it("registrerer en ekstern kode med normalisert verdi uten å røre qrToken", async () => {
    mocks.prisma.product.findFirst.mockResolvedValue({
      id: "product-1",
      model: "Port",
    });
    mocks.prisma.equipmentQrCode.findUnique.mockResolvedValue(null);

    const result = await addEquipmentQrCode(actor(), {
      equipmentId: "product-1",
      value: "\u200B  LEGACY-42 \uFEFF",
      label: "Gammel QR – port 3",
      source: "SCAN",
    });

    expect(result).toEqual({ ok: true, data: { id: "qr-new" } });
    expect(mocks.prisma.equipmentQrCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: "product-1",
        value: "LEGACY-42",
        normalizedValue: "LEGACY-42",
        label: "Gammel QR – port 3",
        source: "SCAN",
      }),
      select: { id: true },
    });
    expect(mocks.prisma.product.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "Product",
        entityId: "product-1",
        metadata: expect.objectContaining({
          qrPrefix: "LEGACY-4",
          source: "SCAN",
        }),
      }),
    );
    const metadata = mocks.audit.mock.calls.at(-1)?.[1]?.metadata;
    expect(JSON.stringify(metadata)).not.toContain("LEGACY-42");
  });

  it("avviser en duplikat og navngir bare en enhet aktøren kan se", async () => {
    mocks.prisma.product.findFirst
      .mockResolvedValueOnce({ id: "product-1", model: "Port" })
      .mockResolvedValueOnce({ id: "product-2", model: "Dør 3" });
    mocks.prisma.equipmentQrCode.findUnique.mockResolvedValue({
      id: "qr-other",
      productId: "product-2",
      product: { id: "product-2", model: "Dør 3" },
    });

    const result = await addEquipmentQrCode(actor(), {
      equipmentId: "product-1",
      value: "LEGACY-42",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: {
        code: "equipment.errors.qrDuplicate",
        equipmentModel: "Dør 3",
      },
    });
    expect(mocks.prisma.equipmentQrCode.create).not.toHaveBeenCalled();
  });

  it("skjuler navnet når den andre enheten er utenfor aktørens tilgang", async () => {
    mocks.prisma.product.findFirst
      .mockResolvedValueOnce({ id: "product-1", model: "Port" })
      .mockResolvedValueOnce(null);
    mocks.prisma.equipmentQrCode.findUnique.mockResolvedValue({
      id: "qr-other",
      productId: "product-skjult",
      product: { id: "product-skjult", model: "Hemmelig" },
    });

    const result = await addEquipmentQrCode(actor(), {
      equipmentId: "product-1",
      value: "LEGACY-42",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { equipmentModel: null },
    });
  });

  it("avviser tomme og for lange verdier", async () => {
    await expect(
      addEquipmentQrCode(actor(), { equipmentId: "product-1", value: "   " }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "invalid",
      details: { code: "equipment.errors.qrInvalid" },
    });
    await expect(
      addEquipmentQrCode(actor(), {
        equipmentId: "product-1",
        value: "x".repeat(2049),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "invalid",
      details: { code: "equipment.errors.qrInvalid" },
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser en enhet utenfor aktørens kundeskop", async () => {
    mocks.prisma.product.findFirst.mockResolvedValue(null);

    const result = await addEquipmentQrCode(actor(), {
      equipmentId: "product-other",
      value: "LEGACY-42",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.equipmentQrCode.create).not.toHaveBeenCalled();
  });

  it("sletter en kode som tilhører enheten og reviderer slettingen", async () => {
    mocks.prisma.equipmentQrCode.findFirst.mockResolvedValue({
      id: "qr-1",
      value: "LEGACY-42",
      source: "MANUAL",
    });

    const result = await deleteEquipmentQrCode(actor(), "product-1", "qr-1");

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.equipmentQrCode.delete).toHaveBeenCalledWith({
      where: { id: "qr-1" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "Product",
        entityId: "product-1",
        action: "Slettet eksisterende QR-kode",
      }),
    );
  });

  it("sletter ikke en kode på en annen enhet", async () => {
    mocks.prisma.equipmentQrCode.findFirst.mockResolvedValue(null);

    const result = await deleteEquipmentQrCode(actor(), "product-1", "qr-1");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.equipmentQrCode.delete).not.toHaveBeenCalled();
  });
});
