import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: { findFirst: vi.fn() },
    material: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
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
  addMaterial,
  deleteMaterial,
  getMaterialTotals,
  listMaterials,
  updateMaterial,
} from "./materials";

const admin = (overrides: Partial<ServiceActor> = {}): ServiceActor => ({
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: "dep-a",
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
  ...overrides,
});

const noAccess = () =>
  admin({
    role: "USER",
    permissionsCustomized: true,
    permissions: [],
    roleDefinition: { permissions: [] },
  });

const technician = (overrides: Partial<ServiceActor> = {}) =>
  admin({
    id: "tech",
    name: "Montør",
    email: "montor@example.test",
    role: "TECHNICIAN",
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.workOrder.findFirst.mockResolvedValue({ id: "wo1" });
  mocks.prisma.material.findMany.mockResolvedValue([]);
  mocks.prisma.material.create.mockResolvedValue({ id: "mat1" });
  mocks.prisma.material.update.mockResolvedValue({});
  mocks.prisma.material.delete.mockResolvedValue({});
});

describe("material-tjenesten", () => {
  it("avviser tillegg uten workorders.update", async () => {
    const result = await addMaterial(noAccess(), {
      workOrderId: "wo1",
      name: "Pumpe",
      quantity: 1,
      unitPrice: 100,
    });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.material.create).not.toHaveBeenCalled();
  });

  it("legger til materiale og logger det", async () => {
    const result = await addMaterial(admin(), {
      workOrderId: "wo1",
      name: "Pumpe",
      quantity: 2,
      unit: "stk",
      unitPrice: 1250.5,
    });
    expect(result).toEqual({ ok: true, data: { id: "mat1" } });
    expect(mocks.prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Pumpe",
          quantity: 2,
          unitPrice: 1250.5,
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("tekniker kan ikke sette materialpris, selv med håndlaget forespørsel", async () => {
    const result = await addMaterial(technician(), {
      workOrderId: "wo1",
      name: "Pumpe",
      quantity: 1,
      unitPrice: 1,
    });
    expect(result).toEqual({ ok: true, data: { id: "mat1" } });
    expect(mocks.prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitPrice: null }),
      }),
    );
  });

  it("godtar materiale uten pris fra feltbruker", async () => {
    const result = await addMaterial(technician(), {
      workOrderId: "wo1",
      name: "Pakning",
      quantity: 2,
    });
    expect(result).toEqual({ ok: true, data: { id: "mat1" } });
    expect(mocks.prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitPrice: null }),
      }),
    );
  });

  it("kontoret kan lagre materiale uten pris", async () => {
    const result = await addMaterial(admin({ role: "OFFICE" }), {
      workOrderId: "wo1",
      name: "Slitedel",
      quantity: 1,
      unitPrice: null,
    });
    expect(result).toEqual({ ok: true, data: { id: "mat1" } });
    expect(mocks.prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitPrice: null }),
      }),
    );
  });

  it("avviser ugyldig materiale", async () => {
    const result = await addMaterial(admin(), {
      workOrderId: "wo1",
      name: "",
      quantity: 0,
      unitPrice: -1,
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("oppdaterer materiale i egen avdeling", async () => {
    mocks.prisma.material.findUnique.mockResolvedValue({
      id: "mat1",
      workOrderId: "wo1",
    });

    const result = await updateMaterial(admin(), {
      id: "mat1",
      quantity: 3,
    });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.material.update).toHaveBeenCalled();
  });

  it("tekniker kan ikke overstyre materialpris ved oppdatering", async () => {
    mocks.prisma.material.findUnique.mockResolvedValue({
      id: "mat1",
      workOrderId: "wo1",
      unitPrice: 100,
    });

    const result = await updateMaterial(technician(), {
      id: "mat1",
      name: "Pumpe",
      unitPrice: 1,
    });

    expect(result).toEqual({ ok: true, data: undefined });
    const updateData = mocks.prisma.material.update.mock.calls[0]?.[0]?.data;
    expect(updateData).not.toHaveProperty("unitPrice");
    const auditMetadata = mocks.audit.mock.calls.at(-1)?.[1]?.metadata;
    expect(auditMetadata).not.toHaveProperty("unitPrice");
  });

  it("kontoret kan overstyre materialpris med før/etter i loggen", async () => {
    mocks.prisma.material.findUnique.mockResolvedValue({
      id: "mat1",
      workOrderId: "wo1",
      unitPrice: 100,
    });

    const result = await updateMaterial(admin({ role: "OFFICE" }), {
      id: "mat1",
      unitPrice: 250,
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.material.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitPrice: 250 }),
      }),
    );
    const auditMetadata = mocks.audit.mock.calls.at(-1)?.[1]?.metadata;
    expect(auditMetadata).toMatchObject({
      unitPrice: { before: 100, after: 250 },
    });
  });

  it("avviser sletting uten workorders.edit", async () => {
    mocks.prisma.material.findUnique.mockResolvedValue({
      id: "mat1",
      workOrderId: "wo1",
    });

    const result = await deleteMaterial(
      admin({
        role: "TECHNICIAN",
        roleDefinition: { permissions: ["workorders.view", "workorders.update"] },
      }),
      { id: "mat1" },
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.material.delete).not.toHaveBeenCalled();
  });

  it("summerer antall og beløp", async () => {
    mocks.prisma.material.findMany.mockResolvedValue([
      { quantity: 2, unitPrice: 100 },
      { quantity: 1.5, unitPrice: 200 },
    ]);

    const result = await getMaterialTotals(admin(), "wo1");
    expect(result).toEqual({
      ok: true,
      data: { count: 2, quantity: 3.5, amount: 500 },
    });
  });

  it("regner materiale uten pris som null i summen", async () => {
    mocks.prisma.material.findMany.mockResolvedValue([
      { quantity: 2, unitPrice: null },
      { quantity: 1, unitPrice: 100 },
    ]);

    const result = await getMaterialTotals(admin(), "wo1");
    expect(result).toEqual({
      ok: true,
      data: { count: 2, quantity: 3, amount: 100 },
    });
  });

  it("lister materiale for et oppdrag", async () => {
    mocks.prisma.material.findMany.mockResolvedValue([{ id: "mat1" }]);
    const result = await listMaterials(admin(), "wo1");
    expect(result).toEqual({ ok: true, data: [{ id: "mat1" }] });
  });
});
