import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "@/lib/access";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    contact: { findUnique: vi.fn(), create: vi.fn() },
    department: { findFirst: vi.fn() },
    comment: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  getDefaultDepartmentId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/access", () => ({
  workOrderScope: vi.fn(() => ({})),
  staffForDepartment: vi.fn(() => ({})),
}));
vi.mock("@/lib/departments", () => ({
  getDefaultDepartmentId: mocks.getDefaultDepartmentId,
}));

import {
  assignTechnician,
  changeWorkOrderStatus,
  createWorkOrder,
  deleteWorkOrder,
  updateWorkOrder,
} from "./work-orders";

function actor(overrides: Record<string, unknown> = {}): AccessUser {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.com",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
    ...overrides,
  } as unknown as AccessUser;
}

function txClient() {
  return {
    workOrder: {
      create: vi.fn(async () => ({ id: "wo-new" })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async () => ({})),
    },
    contact: { create: vi.fn(async () => ({ id: "contact-new" })) },
    comment: { create: vi.fn(async () => ({ id: "comment-1" })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
}

function withTransaction(tx = txClient()) {
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (client: typeof tx) => unknown) => callback(tx),
  );
  return tx;
}

describe("work-orders-tjenesten", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultDepartmentId.mockResolvedValue("dep-default");
  });

  it("avviser statusendring når aktøren mangler workorders.update", async () => {
    const result = await changeWorkOrderStatus(
      actor({ permissionsCustomized: true, permissions: [] }),
      "wo-1",
      "IN_PROGRESS",
      "office",
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser en ulovlig statustransisjon uten å skrive til databasen", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });

    const result = await changeWorkOrderStatus(
      actor({ role: "TECHNICIAN" }),
      "wo-1",
      "COMPLETED",
      "field",
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-status" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser kansellering fra en montør som mangler workorders.edit", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });

    const result = await changeWorkOrderStatus(
      actor({ role: "TECHNICIAN" }),
      "wo-1",
      "CANCELLED",
      "field",
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-status" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser et oppdrag utenfor brukerens avdeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(null);

    const result = await changeWorkOrderStatus(
      actor(),
      "wo-other-department",
      "IN_PROGRESS",
      "office",
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser ugyldige data før opprettelse", async () => {
    const result = await createWorkOrder(actor(), {
      title: "",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      templateIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("oppretter oppdraget og skriver revisjonsloggen i samme transaksjon", async () => {
    const tx = withTransaction();

    const result = await createWorkOrder(actor(), {
      title: "Service",
      description: "Sjekk pumpen",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      templateIds: [],
      tagNames: ["service"],
    });

    expect(result).toEqual({ ok: true, id: "wo-new" });
    expect(tx.workOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Service",
        departmentId: "dep-a",
        status: "PENDING",
      }),
      select: { id: true },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-new",
        action: "Kontoret opprettet nytt oppdrag: Service",
      }),
    });
  });

  it("avviser en montør fra en annen avdeling ved tildeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    const result = await assignTechnician(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "user-other-department",
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("oppdaterer og logger sletting av et oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      title: "Testoppdrag",
      customer: { name: "Kunde AS" },
    });
    const tx = withTransaction();

    const result = await deleteWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-1",
        action: "Slettet oppdraget «Testoppdrag» (Kunde AS) med tilhørende rapporter",
      }),
    });
    expect(tx.workOrder.delete).toHaveBeenCalledWith({ where: { id: "wo-1" } });
  });

  it("avviser redigering uten workorders.edit", async () => {
    const result = await updateWorkOrder(
      actor({ role: "TECHNICIAN" }),
      "wo-1",
      {
        title: "Ny tittel",
        description: "",
        departmentId: "dep-a",
        customerId: "cust-1",
        contactId: "",
        scheduledFor: "2026-10-24",
        scheduledTo: "",
        technicianIds: [],
        tagNames: [],
      },
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
