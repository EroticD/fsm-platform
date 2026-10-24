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
    report: { updateMany: vi.fn(async () => ({ count: 0 })) },
    upload: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
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
  cloneWorkOrder,
  createWorkOrder,
  deleteWorkOrder,
  restoreWorkOrder,
  setWorkOrderLegalHold,
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
    report: { updateMany: vi.fn(async () => ({ count: 0 })) },
    upload: { updateMany: vi.fn(async () => ({ count: 0 })) },
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

  it("lar alle åpne statuser velges fritt uten grunn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });
    withTransaction();

    const result = await changeWorkOrderStatus(
      actor({ role: "TECHNICIAN" }),
      "wo-1",
      "IN_PROGRESS",
      "field",
    );

    expect(result).toEqual({ ok: true });
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
      orderNumber: "K-1001",
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
        orderNumber: "K-1001",
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
        metadata: { customerId: null },
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
      deletedAt: null,
      legalHold: false,
      status: "OPEN",
      customer: { name: "Kunde AS" },
      reports: [],
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
        action: "Slettet oppdraget «Testoppdrag» (Kunde AS) (myk sletting – kan gjenopprettes)",
      }),
    });
    // Myk sletting: raden og rapportene beholdes, filene frigjøres ikke.
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { deletedAt: expect.any(Date), deletedBy: "Kari" },
    });
    expect(tx.workOrder.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.upload.findMany).not.toHaveBeenCalled();
  });

  it("avviser sletting av et allerede mykt slettet oppdrag", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      title: "Testoppdrag",
      deletedAt: new Date(),
      customer: null,
    });
    withTransaction();
    // requireAccess får ingen treff fordi scope utelukker slettede rader.
    mocks.prisma.workOrder.findFirst.mockResolvedValue(null);

    const result = await deleteWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser sletting når oppdraget har bevaringsplikt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      title: "Testoppdrag",
      deletedAt: null,
      legalHold: true,
      status: "OPEN",
      customer: null,
      reports: [],
    });

    const result = await deleteWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
    );

    expect(result).toEqual({ ok: false, error: "legal-hold" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser sletting når en rapport har bevaringsplikt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      title: "Testoppdrag",
      deletedAt: null,
      legalHold: false,
      status: "OPEN",
      customer: null,
      reports: [{ legalHold: false }, { legalHold: true }],
    });

    const result = await deleteWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
    );

    expect(result).toEqual({ ok: false, error: "legal-hold" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser sletting av et lukket oppdrag for ikke-admin", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "COMPLETED",
    });
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      title: "Testoppdrag",
      deletedAt: null,
      legalHold: false,
      status: "COMPLETED",
      customer: null,
      reports: [],
    });

    const result = await deleteWorkOrder(
      actor({
        role: "OFFICE",
        permissionsCustomized: true,
        permissions: ["workorders.delete"],
      }),
      "wo-1",
    );

    expect(result).toEqual({ ok: false, error: "workorder-locked" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lar administrator slette et lukket oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "CANCELLED",
    });
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      title: "Testoppdrag",
      deletedAt: null,
      legalHold: false,
      status: "CANCELLED",
      customer: null,
      reports: [],
    });
    const tx = withTransaction();

    const result = await deleteWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { deletedAt: expect.any(Date), deletedBy: "Kari" },
    });
    // Myk sletting frigjør aldri filene.
    expect(mocks.prisma.upload.findMany).not.toHaveBeenCalled();
  });

  it("avviser bevaringsplikt for andre enn administrator", async () => {
    const result = await setWorkOrderLegalHold(
      actor({ role: "OFFICE" }),
      "wo-1",
      "true",
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("slår på bevaringsplikt for oppdraget og alle rapportene og logger det", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo-1",
      title: "Testoppdrag",
      legalHold: false,
      _count: { reports: 2 },
    });
    const tx = withTransaction();

    const result = await setWorkOrderLegalHold(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "true",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { legalHold: true },
    });
    expect(tx.report.updateMany).toHaveBeenCalledWith({
      where: { workOrderId: "wo-1" },
      data: { legalHold: true },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-1",
        action: expect.stringContaining("bevaringsplikt"),
        actorId: "u1",
        metadata: { legalHold: true, reportCount: 2 },
      }),
    });
  });

  it("slår av bevaringsplikt og logger metadata", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo-1",
      title: "Testoppdrag",
      legalHold: true,
      _count: { reports: 1 },
    });
    const tx = withTransaction();

    const result = await setWorkOrderLegalHold(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      false,
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { legalHold: false },
    });
    expect(tx.report.updateMany).toHaveBeenCalledWith({
      where: { workOrderId: "wo-1" },
      data: { legalHold: false },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { legalHold: false, reportCount: 1 },
      }),
    });
  });

  it("lar bare administrator gjenopprette et slettet oppdrag", async () => {
    const result = await restoreWorkOrder(
      actor({ role: "OFFICE", permissionsCustomized: true, permissions: null }),
      "wo-1",
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.workOrder.findUnique).not.toHaveBeenCalled();
  });

  it("gjenoppretter et mykt slettet oppdrag og logger det", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo-1",
      title: "Testoppdrag",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const tx = withTransaction();

    const result = await restoreWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { deletedAt: null, deletedBy: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-1",
        action: "Gjenopprettet oppdraget «Testoppdrag»",
      }),
    });
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

  it("avviser redigering av et fullført oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      status: "COMPLETED",
    });

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "workorder-locked" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lar et ikke-fullført oppdrag redigeres selv om rapporten er låst", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      status: "IN_PROGRESS",
    });
    const tx = withTransaction();

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      orderNumber: "K-1002",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: expect.objectContaining({ orderNumber: "K-1002" }),
    });
  });

  it("oppdaterer fil-ACL når oppdraget flyttes til ny avdeling og kunde", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
    });
    mocks.prisma.department.findFirst.mockResolvedValue({ id: "dep-b" });
    const tx = withTransaction();

    const result = await updateWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      {
        title: "Ny tittel",
        description: "",
        departmentId: "dep-b",
        customerId: "cust-2",
        contactId: "",
        scheduledFor: "2026-10-24",
        scheduledTo: "",
        technicianIds: [],
        tagNames: [],
      },
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: expect.objectContaining({
        departmentId: "dep-b",
        customerId: "cust-2",
      }),
    });
    expect(tx.upload.updateMany).toHaveBeenCalledWith({
      where: { ownerType: "WORK_ORDER", ownerId: "wo-1" },
      data: { departmentId: "dep-b", customerId: "cust-2" },
    });
  });

  it("låst sjekkliste blokkerer ikke redigering av et ikke-fullført oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      status: "IN_PROGRESS",
      reports: [{ isLocked: true }],
    });
    withTransaction();

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: true });
  });

  it("låst sjekkliste blokkerer ikke lovlig statusendring", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "PENDING",
      reports: [{ isLocked: true }],
    });
    withTransaction();

    const result = await changeWorkOrderStatus(
      actor(),
      "wo-1",
      "PLANNED",
      "office",
    );

    expect(result).toEqual({ ok: true });
  });

  it("avviser statusendring på et fullført oppdrag for ikke-admin", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "COMPLETED",
    });

    const result = await changeWorkOrderStatus(
      actor(),
      "wo-1",
      "IN_PROGRESS",
      "office",
    );

    expect(result).toEqual({ ok: false, error: "workorder-locked" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("krever grunn når administrator gjenåpner et fullført oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "COMPLETED",
    });

    const result = await changeWorkOrderStatus(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "IN_PROGRESS",
      "office",
    );

    expect(result).toEqual({ ok: false, error: "reason-required" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lar administrator gjenåpne et fullført oppdrag med grunn og logger grunnen", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "COMPLETED",
    });
    const tx = withTransaction();

    const result = await changeWorkOrderStatus(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "IN_PROGRESS",
      "office",
      "Kunden oppdaget mangler ved signeringen",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: expect.stringContaining(
          "Grunn: Kunden oppdaget mangler ved signeringen",
        ),
        metadata: {
          from: "COMPLETED",
          to: "IN_PROGRESS",
          reason: "Kunden oppdaget mangler ved signeringen",
          reopened: true,
        },
      }),
    });
  });

  it("krever grunn når administrator gjenåpner et kansellert oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "CANCELLED",
    });

    const result = await changeWorkOrderStatus(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "IN_PROGRESS",
      "office",
    );

    expect(result).toEqual({ ok: false, error: "reason-required" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("krever ikke grunn når en åpen status endres", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "PENDING",
    });
    const tx = withTransaction();

    const result = await changeWorkOrderStatus(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "IN_PROGRESS",
      "office",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ metadata: expect.anything() }),
    });
  });

  it("kloner et oppdrag uten rapporter, kommentarer eller vedlegg", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      description: "Beskrivelse",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "contact-1",
      scheduledFor: new Date("2026-10-24"),
      scheduledTo: null,
      technicians: [{ id: "tech-1" }],
      templates: [{ id: "tpl-1" }],
      tags: [{ name: "service" }],
    });
    const tx = withTransaction();

    const result = await cloneWorkOrder(actor(), "wo-1");

    expect(result).toEqual({ ok: true, id: "wo-new" });
    expect(tx.workOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Service",
        description: "Beskrivelse",
        departmentId: "dep-a",
        customerId: "cust-1",
        contactId: "contact-1",
        status: "PENDING",
        technicians: { connect: [{ id: "tech-1" }] },
        templates: { connect: [{ id: "tpl-1" }] },
        tags: {
          connectOrCreate: [
            { where: { name: "service" }, create: { name: "service" } },
          ],
        },
      }),
      select: { id: true },
    });
  });
});
