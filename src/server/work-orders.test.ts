import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "@/lib/access";
import { osloDayStart } from "@/lib/dates";

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
      count: vi.fn(),
    },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    contact: { findUnique: vi.fn(), create: vi.fn() },
    customer: { findUnique: vi.fn(async () => null) },
    department: { findFirst: vi.fn() },
    comment: { create: vi.fn() },
    report: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(), update: vi.fn() },
    upload: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  getDefaultDepartmentId: vi.fn(),
  createDefaultVisit: vi.fn(),
  recomputeWorkOrderSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("./visits", () => ({
  createDefaultVisit: mocks.createDefaultVisit,
  recomputeWorkOrderSchedule: mocks.recomputeWorkOrderSchedule,
}));
vi.mock("./sla", () => ({
  startClock: vi.fn(async () => null),
  markResponded: vi.fn(async () => undefined),
  markResolved: vi.fn(async () => undefined),
  cancelClocks: vi.fn(async () => undefined),
}));
vi.mock("@/lib/access", () => ({
  workOrderScope: vi.fn(() => ({})),
  staffForDepartment: vi.fn(() => ({})),
}));
vi.mock("@/lib/departments", () => ({
  getDefaultDepartmentId: mocks.getDefaultDepartmentId,
}));

import {
  addComment,
  addContactToCustomer,
  addTechnician,
  addTemplate,
  assignTechnician,
  changeWorkOrderStatus,
  cloneWorkOrder,
  createWorkOrder,
  deleteWorkOrder,
  moveTechnician,
  removeTechnician,
  restoreWorkOrder,
  setContact,
  setReportLegalHold,
  setTags,
  setWorkOrderLegalHold,
  updateWorkOrderDate,
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
      findFirst: vi.fn(
        async (): Promise<Record<string, unknown> | null> => ({
          id: "wo-1",
          status: "OPEN",
          legalHold: false,
        }),
      ),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      delete: vi.fn(async () => ({})),
    },
    contact: { create: vi.fn(async () => ({ id: "contact-new" })) },
    comment: { create: vi.fn(async () => ({ id: "comment-1" })) },
    visit: {
      findMany: vi.fn(
        async (): Promise<Array<{ id: string; status: string }>> => [],
      ),
      create: vi.fn(async () => ({ id: "visit-new" })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    visitTechnician: {
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    report: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(), update: vi.fn() },
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
    mocks.createDefaultVisit.mockResolvedValue(undefined);
    mocks.recomputeWorkOrderSchedule.mockResolvedValue(undefined);
    mocks.prisma.workOrder.count.mockResolvedValue(0);
    mocks.prisma.workOrder.create.mockResolvedValue({ id: "wo-new" });
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

  it("lar et åpent oppdrag fullføres direkte", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
    });
    const tx = withTransaction();

    const result = await changeWorkOrderStatus(
      actor(),
      "wo-1",
      "COMPLETED",
      "office",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "wo-1", status: "OPEN" },
      data: { status: "COMPLETED" },
    });
  });

  it("lar en åpen status endres fritt uten grunn", async () => {
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

  it("avviser opprettelse når sluttdato er før startdato", async () => {
    const result = await createWorkOrder(actor(), {
      title: "Service",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "2026-10-23",
      technicianIds: [],
      templateIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "sluttdato-for-startdato" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.create).not.toHaveBeenCalled();
  });

  it("avviser opprettelse med ugyldig sluttdato", async () => {
    const result = await createWorkOrder(actor(), {
      title: "Service",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "2026-02-31",
      technicianIds: [],
      templateIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "ugyldig-sluttdato" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
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
        orderNumberNormalized: "K1001",
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
        metadata: {
          customerId: null,
          orderNumber: "K-1001",
          orderNumberNormalized: "K1001",
        },
      }),
    });
  });

  it("avviser duplikat ordrenummer ved opprettelse med forståelig feil", async () => {
    mocks.prisma.workOrder.count.mockResolvedValue(1);

    const result = await createWorkOrder(actor(), {
      title: "Service",
      orderNumber: "k-1001",
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

    expect(result).toEqual({ ok: false, error: "duplikat-ordrenummer" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser duplikat ordrenummer ved oppdatering", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      orderNumber: "K-1001",
      orderNumberNormalized: "K1001",
    });
    mocks.prisma.workOrder.count.mockResolvedValue(1);

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Service",
      orderNumber: "K 1001",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "duplikat-ordrenummer" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lagrer normalisert ordrenummer og logger før/etter ved oppdatering", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      orderNumber: "K-1001",
      orderNumberNormalized: "K1001",
    });
    const tx = withTransaction();

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Service",
      orderNumber: "K. 1002",
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
      data: expect.objectContaining({
        orderNumber: "K. 1002",
        orderNumberNormalized: "K1002",
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          orderNumber: { from: "K-1001", to: "K. 1002" },
          orderNumberNormalized: "K1002",
        }),
      }),
    });
  });

  it("kan redigere et internt oppdrag uten kunde", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      orderNumber: null,
      orderNumberNormalized: null,
    });
    const tx = withTransaction();

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Internt vedlikehold",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: expect.objectContaining({
        customerId: null,
        contactId: null,
      }),
    });
    expect(tx.upload.updateMany).toHaveBeenCalledWith({
      where: { ownerType: "WORK_ORDER", ownerId: "wo-1" },
      data: { departmentId: "dep-a", customerId: null },
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
      reports: [
        { id: "r1", legalHold: false },
        { id: "r2", legalHold: false },
      ],
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

  it("slår av bevaringsplikt med grunn uten å frigjøre rapportenes egne hold", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: "wo-1",
      title: "Testoppdrag",
      legalHold: true,
      reports: [{ id: "r1", legalHold: true }],
    });
    const tx = withTransaction();

    const result = await setWorkOrderLegalHold(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      false,
      "Saken er avsluttet",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { legalHold: false },
    });
    // Rapporternes hold skal ikke frigjøres i det stille.
    expect(tx.report.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          legalHold: false,
          reportCount: 1,
          reason: "Saken er avsluttet",
          retainedReportIds: ["r1"],
        },
      }),
    });
  });

  it("krever grunn for å slå av bevaringsplikt", async () => {
    const result = await setWorkOrderLegalHold(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      false,
    );

    expect(result).toEqual({ ok: false, error: "reason-required" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("frigjør bevaringsplikt for én rapport eksplisitt med grunn og logger rapport-id", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue({
      id: "r1",
      name: "Servicerapport",
      templateTitle: "Sjekkliste",
      legalHold: true,
    });
    const tx = withTransaction();

    const result = await setReportLegalHold(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "r1",
      false,
      "Frigitt etter pålegg",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.report.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { legalHold: false },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Report",
        entityId: "r1",
        metadata: {
          legalHold: false,
          workOrderId: "wo-1",
          reportId: "r1",
          reason: "Frigitt etter pålegg",
        },
      }),
    });
  });

  it("krever grunn for å frigjøre bevaringsplikt på en rapport", async () => {
    const result = await setReportLegalHold(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      "r1",
      false,
    );

    expect(result).toEqual({ ok: false, error: "reason-required" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
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

  it("avviser redigering når sluttdato er før startdato", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      status: "IN_PROGRESS",
    });

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "2026-10-23",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "sluttdato-for-startdato" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser redigering med ugyldig sluttdato", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      status: "IN_PROGRESS",
    });

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "2026-13-01",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "ugyldig-sluttdato" });
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

  it("avviser kundebytte når oppdraget har en rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      orderNumber: null,
      orderNumberNormalized: null,
      reports: [{ id: "r1" }],
      bookingRequest: null,
    });

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-2",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "kunde-last" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.workOrder.update).not.toHaveBeenCalled();
    expect(mocks.prisma.upload.updateMany).not.toHaveBeenCalled();
  });

  it("avviser kundebytte selv når rapporten er mykt slettet", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      orderNumber: null,
      orderNumberNormalized: null,
      reports: [{ id: "r-slettet", deletedAt: new Date("2026-01-01") }],
      bookingRequest: null,
    });

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-2",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: false, error: "kunde-last" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.upload.updateMany).not.toHaveBeenCalled();
  });

  it("avviser kundebytte når oppdraget har en bestilling – også for administrator", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "OPEN",
      orderNumber: null,
      orderNumberNormalized: null,
      reports: [],
      bookingRequest: { id: "br-1" },
    });

    const result = await updateWorkOrder(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo-1",
      {
        title: "Ny tittel",
        description: "",
        departmentId: "dep-a",
        customerId: "cust-2",
        contactId: "",
        scheduledFor: "2026-10-24",
        scheduledTo: "",
        technicianIds: [],
        tagNames: [],
      },
    );

    expect(result).toEqual({ ok: false, error: "kunde-last" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.upload.updateMany).not.toHaveBeenCalled();
  });

  it("flytter kunden og oppdaterer fil-ACL når det ikke finnes rapporter eller bestilling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      orderNumber: null,
      orderNumberNormalized: null,
      reports: [],
      bookingRequest: null,
    });
    const tx = withTransaction();

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Ny tittel",
      description: "",
      departmentId: "dep-a",
      customerId: "cust-2",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: expect.objectContaining({ customerId: "cust-2" }),
    });
    expect(tx.upload.updateMany).toHaveBeenCalledWith({
      where: { ownerType: "WORK_ORDER", ownerId: "wo-1" },
      data: { departmentId: "dep-a", customerId: "cust-2" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          customerId: { from: "cust-1", to: "cust-2" },
        }),
      }),
    });
  });

  it("låst sjekkliste blokkerer ikke redigering av et ikke-fullført oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: "cust-1",
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

  it("låst rapport blokkerer ikke statusendring på oppdraget", async () => {
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
      "IN_PROGRESS",
      "office",
    );

    expect(result).toEqual({ ok: true });
    // Statusflyten skal ikke lese rapporten i det hele tatt.
    expect(mocks.prisma.report.findFirst).not.toHaveBeenCalled();
  });

  it("låst rapport blokkerer ikke at oppdraget fullføres", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "IN_PROGRESS",
      reports: [{ isLocked: true }],
    });
    const tx = withTransaction();

    const result = await changeWorkOrderStatus(
      actor(),
      "wo-1",
      "COMPLETED",
      "office",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "wo-1", status: "IN_PROGRESS" },
      data: { status: "COMPLETED" },
    });
    expect(mocks.prisma.report.findFirst).not.toHaveBeenCalled();
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
      "PLANNED",
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
        orderNumber: null,
        orderNumberNormalized: null,
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
    // Kilden mangler visitt, men har dato: klonen får én all-day-visitt.
    expect(mocks.createDefaultVisit).toHaveBeenCalledWith(tx, {
      workOrderId: "wo-new",
      startsAt: osloDayStart("2026-10-24"),
      endsAt: osloDayStart("2026-10-25"),
      allDay: true,
      technicianIds: ["tech-1"],
    });
    expect(mocks.recomputeWorkOrderSchedule).toHaveBeenCalledWith(tx, "wo-new");
  });

  it("avviser alle metadataendringer når oppdraget har bevaringsplikt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      legalHold: true,
      orderNumber: null,
      orderNumberNormalized: null,
      reports: [],
      bookingRequest: null,
    });

    const office = actor();
    const technician = actor({ role: "TECHNICIAN" });

    await expect(
      updateWorkOrder(office, "wo-1", {
        title: "Ny tittel",
        description: "",
        departmentId: "dep-a",
        customerId: "cust-1",
        contactId: "",
        scheduledFor: "2026-10-24",
        scheduledTo: "",
        technicianIds: [],
        tagNames: [],
      }),
    ).resolves.toEqual({ ok: false, error: "legal-hold" });

    await expect(
      updateWorkOrderDate(office, "wo-1", { newDate: "2026-10-25" }),
    ).resolves.toEqual({ ok: false, error: "legal-hold" });

    await expect(
      addTemplate(office, "wo-1", "tpl-1", "workorders.edit"),
    ).resolves.toEqual({ ok: false, error: "legal-hold" });

    await expect(setTags(office, "wo-1", ["service"])).resolves.toEqual({
      ok: false,
      error: "legal-hold",
    });

    await expect(setContact(office, "wo-1", "")).resolves.toEqual({
      ok: false,
      error: "legal-hold",
    });

    await expect(
      addContactToCustomer(office, "wo-1", {
        name: "Kari",
        email: "",
        phone: "",
        role: "",
      }),
    ).resolves.toEqual({ ok: false, error: "legal-hold" });

    await expect(
      assignTechnician(office, "wo-1", "tech-1"),
    ).resolves.toEqual({ ok: false, error: "legal-hold" });
    await expect(
      addTechnician(technician, "wo-1", "tech-1"),
    ).resolves.toEqual({ ok: false, error: "legal-hold" });
    await expect(
      removeTechnician(technician, "wo-1", "tech-1"),
    ).resolves.toEqual({ ok: false, error: "legal-hold" });

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lar additive kommentarer være lov under bevaringsplikt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      legalHold: true,
    });
    const tx = withTransaction();

    const result = await addComment(actor(), "wo-1", "Kunden ringte");

    expect(result).toEqual({ ok: true });
    expect(tx.comment.create).toHaveBeenCalled();
  });

  it("avviser tildeling og fjerning på lukkede oppdrag for kontor og montør", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: null,
      status: "COMPLETED",
      legalHold: false,
    });

    await expect(
      assignTechnician(actor(), "wo-1", "tech-1"),
    ).resolves.toEqual({ ok: false, error: "workorder-locked" });
    await expect(
      addTechnician(actor({ role: "TECHNICIAN" }), "wo-1", "tech-1"),
    ).resolves.toEqual({ ok: false, error: "workorder-locked" });

    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: null,
      status: "CANCELLED",
      legalHold: false,
    });
    await expect(
      removeTechnician(actor(), "wo-1", "tech-1"),
    ).resolves.toEqual({ ok: false, error: "workorder-locked" });

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("sjekker lukket status på nytt i transaksjonen ved tildeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      legalHold: false,
    });
    mocks.prisma.user.findFirst.mockResolvedValue({ id: "tech-1", name: "Tore" });
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      status: "COMPLETED",
      legalHold: false,
    });

    const result = await assignTechnician(actor(), "wo-1", "tech-1");

    expect(result).toEqual({ ok: false, error: "workorder-locked" });
    expect(tx.workOrder.update).not.toHaveBeenCalled();
  });
});

describe("moveTechnician – flytting i dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      legalHold: false,
    });
  });

  it("fjerner kildemontøren og legger til målmontøren i samme transaksjon", async () => {
    mocks.prisma.user.findFirst
      .mockResolvedValueOnce({ id: "tech-2", name: "Tore" })
      .mockResolvedValueOnce({ id: "tech-1", name: "Kari" });
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      status: "OPEN",
      legalHold: false,
      technicians: [{ id: "tech-1" }],
    });

    const result = await moveTechnician(actor(), "wo-1", "tech-1", "tech-2");

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: {
        technicians: {
          disconnect: { id: "tech-1" },
          connect: { id: "tech-2" },
        },
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-1",
        action: "Flyttet Kari til Tore",
      }),
    });
  });

  it("avviser samme kolonne som no-op uten å skrive", async () => {
    const result = await moveTechnician(actor(), "wo-1", "tech-1", "tech-1");

    expect(result).toEqual({ ok: false, error: "ingen-endring" });
    expect(mocks.prisma.user.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser flytting på et lukket oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: null,
      status: "COMPLETED",
      legalHold: false,
    });

    const result = await moveTechnician(actor(), "wo-1", "tech-1", "tech-2");

    expect(result).toEqual({ ok: false, error: "workorder-locked" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("fjerner bare kildemontøren når kortet slippes på uten montør", async () => {
    mocks.prisma.user.findFirst.mockResolvedValueOnce({
      id: "tech-1",
      name: "Kari",
    });
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      status: "OPEN",
      legalHold: false,
      technicians: [{ id: "tech-1" }, { id: "tech-2" }],
    });

    const result = await moveTechnician(actor(), "wo-1", "tech-1", "");

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo-1" },
      data: { technicians: { disconnect: { id: "tech-1" } } },
    });
  });

  it("avviser en utdatert kilde som ikke lenger står på oppdraget", async () => {
    mocks.prisma.user.findFirst.mockResolvedValue({
      id: "tech-1",
      name: "Kari",
    });
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      status: "OPEN",
      legalHold: false,
      technicians: [{ id: "tech-2" }],
    });

    const result = await moveTechnician(actor(), "wo-1", "tech-1", "");

    expect(result).toEqual({ ok: false, error: "ingen-endring" });
    expect(tx.workOrder.update).not.toHaveBeenCalled();
  });
});

describe("updateWorkOrderDate – flerdagsoppdrag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultDepartmentId.mockResolvedValue("dep-default");
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      status: "OPEN",
      title: "Service",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: new Date("2026-10-21T00:00:00.000Z"),
    });
  });

  it("beholder varigheten når bare startdatoen flyttes", async () => {
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: new Date("2026-10-21T00:00:00.000Z"),
    });

    const result = await updateWorkOrderDate(actor(), "wo-1", {
      newDate: "2026-11-02",
    });

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo-1",
        legalHold: false,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      data: {
        scheduledFor: new Date("2026-11-02T00:00:00.000Z"),
        scheduledTo: new Date("2026-11-04T00:00:00.000Z"),
      },
    });
  });

  it("fjerner sluttdatoen når newEnd sendes eksplisitt tom", async () => {
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: new Date("2026-10-21T00:00:00.000Z"),
    });

    const result = await updateWorkOrderDate(actor(), "wo-1", {
      newDate: "2026-11-02",
      newEnd: "",
    });

    expect(result).toEqual({ ok: true });
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo-1",
        legalHold: false,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      data: {
        scheduledFor: new Date("2026-11-02T00:00:00.000Z"),
        scheduledTo: null,
      },
    });
  });

  it("avviser sluttdato før startdato", async () => {
    const result = await updateWorkOrderDate(actor(), "wo-1", {
      newDate: "2026-11-02",
      newEnd: "2026-11-01",
    });

    expect(result).toEqual({ ok: false, error: "ugyldig-dato" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("visits – oppdrag og standardvisitt holdes i takt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultDepartmentId.mockResolvedValue("dep-default");
    mocks.createDefaultVisit.mockResolvedValue(undefined);
    mocks.recomputeWorkOrderSchedule.mockResolvedValue(undefined);
    mocks.prisma.workOrder.count.mockResolvedValue(0);
    mocks.prisma.workOrder.create.mockResolvedValue({ id: "wo-new" });
  });

  it("oppretter én all-day-visitt med montører når oppdraget får dato", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "tech-1" }]);
    const tx = withTransaction();

    const result = await createWorkOrder(actor(), {
      title: "Service",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "2026-10-25",
      technicianIds: ["tech-1"],
      templateIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: true, id: "wo-new" });
    expect(mocks.createDefaultVisit).toHaveBeenCalledWith(tx, {
      workOrderId: "wo-new",
      startsAt: osloDayStart("2026-10-24"),
      endsAt: osloDayStart("2026-10-26"),
      allDay: true,
      technicianIds: ["tech-1"],
    });
    expect(mocks.recomputeWorkOrderSchedule).toHaveBeenCalledWith(tx, "wo-new");
  });

  it("flytter den ene visiten når kalenderdatoen endres", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      status: "OPEN",
      title: "Service",
      legalHold: false,
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: new Date("2026-10-21T00:00:00.000Z"),
    });
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      status: "OPEN",
      legalHold: false,
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: new Date("2026-10-21T00:00:00.000Z"),
      technicians: [{ id: "tech-1" }],
    });
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "PLANNED" },
    ]);

    const result = await updateWorkOrderDate(actor(), "wo-1", {
      newDate: "2026-11-02",
    });

    expect(result).toEqual({ ok: true });
    expect(tx.visit.update).toHaveBeenCalledWith({
      where: { id: "visit-1" },
      data: {
        startsAt: osloDayStart("2026-11-02"),
        endsAt: osloDayStart("2026-11-05"),
        allDay: true,
      },
    });
    expect(mocks.recomputeWorkOrderSchedule).toHaveBeenCalledWith(tx, "wo-1");
  });

  it("avviser datoflytting når oppdraget har flere visiter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      status: "OPEN",
      title: "Service",
      legalHold: false,
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: null,
    });
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      status: "OPEN",
      legalHold: false,
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: null,
      technicians: [],
    });
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "PLANNED" },
      { id: "visit-2", status: "PLANNED" },
    ]);

    const result = await updateWorkOrderDate(actor(), "wo-1", {
      newDate: "2026-11-02",
    });

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-dato",
      detail: "visits.errors.multipleVisits",
    });
    expect(tx.workOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.visit.update).not.toHaveBeenCalled();
  });

  it("avviser datoflytting når en visitt er på vei eller på stedet", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      status: "OPEN",
      title: "Service",
      legalHold: false,
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: null,
    });
    const tx = withTransaction();
    tx.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      status: "OPEN",
      legalHold: false,
      scheduledFor: new Date("2026-10-19T00:00:00.000Z"),
      scheduledTo: null,
      technicians: [],
    });
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "EN_ROUTE" },
    ]);

    const result = await updateWorkOrderDate(actor(), "wo-1", {
      newDate: "2026-11-02",
    });

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-dato",
      detail: "visits.errors.visitInProgress",
    });
    expect(tx.workOrder.updateMany).not.toHaveBeenCalled();
  });

  it("speiler oppdragets montørliste på alle visiter ved redigering", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      legalHold: false,
      orderNumber: null,
      orderNumberNormalized: null,
      scheduledFor: new Date("2026-10-24T00:00:00.000Z"),
      scheduledTo: null,
      visits: [{ id: "visit-1", status: "PLANNED" }],
      reports: [],
      bookingRequest: null,
    });
    mocks.prisma.user.findMany.mockResolvedValue([
      { id: "tech-1" },
      { id: "tech-2" },
    ]);
    const tx = withTransaction();
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "PLANNED" },
    ]);

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Service",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-10-24",
      scheduledTo: "",
      technicianIds: ["tech-1", "tech-2"],
      tagNames: [],
    });

    expect(result).toEqual({ ok: true });
    expect(tx.visitTechnician.deleteMany).toHaveBeenCalledWith({
      where: {
        visitId: { in: ["visit-1"] },
        userId: { notIn: ["tech-1", "tech-2"] },
      },
    });
    expect(tx.visitTechnician.createMany).toHaveBeenCalledWith({
      data: [
        { visitId: "visit-1", userId: "tech-1" },
        { visitId: "visit-1", userId: "tech-2" },
      ],
      skipDuplicates: true,
    });
  });

  it("legger tildelt montør på alle visiter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      legalHold: false,
    });
    mocks.prisma.user.findFirst.mockResolvedValue({
      id: "tech-1",
      name: "Tore",
    });
    const tx = withTransaction();
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "PLANNED" },
      { id: "visit-2", status: "PLANNED" },
    ]);

    const result = await assignTechnician(actor(), "wo-1", "tech-1");

    expect(result).toEqual({ ok: true });
    expect(tx.visitTechnician.createMany).toHaveBeenCalledWith({
      data: [
        { visitId: "visit-1", userId: "tech-1" },
        { visitId: "visit-2", userId: "tech-1" },
      ],
      skipDuplicates: true,
    });
  });

  it("fjerner montøren fra alle visiter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      legalHold: false,
    });
    mocks.prisma.user.findFirst.mockResolvedValue({
      id: "tech-1",
      name: "Tore",
    });
    const tx = withTransaction();
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "PLANNED" },
    ]);

    const result = await removeTechnician(actor(), "wo-1", "tech-1");

    expect(result).toEqual({ ok: true });
    expect(tx.visitTechnician.deleteMany).toHaveBeenCalledWith({
      where: { visitId: { in: ["visit-1"] }, userId: "tech-1" },
    });
  });

  it("oppdaterer den ene visiten når redigeringen endrer datoene", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      legalHold: false,
      orderNumber: null,
      orderNumberNormalized: null,
      scheduledFor: new Date("2026-10-24T00:00:00.000Z"),
      scheduledTo: null,
      visits: [{ id: "visit-1", status: "PLANNED" }],
      reports: [],
      bookingRequest: null,
    });
    const tx = withTransaction();
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "PLANNED" },
    ]);

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Service",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-11-02",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({ ok: true });
    expect(tx.visit.update).toHaveBeenCalledWith({
      where: { id: "visit-1" },
      data: {
        startsAt: osloDayStart("2026-11-02"),
        endsAt: osloDayStart("2026-11-03"),
        allDay: true,
      },
    });
  });

  it("avviser datoredigering når oppdraget har flere visiter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      departmentId: "dep-a",
      customerId: null,
      status: "OPEN",
      legalHold: false,
      orderNumber: null,
      orderNumberNormalized: null,
      scheduledFor: new Date("2026-10-24T00:00:00.000Z"),
      scheduledTo: null,
      visits: [
        { id: "visit-1", status: "PLANNED" },
        { id: "visit-2", status: "PLANNED" },
      ],
      reports: [],
      bookingRequest: null,
    });
    const tx = withTransaction();
    tx.visit.findMany.mockResolvedValue([
      { id: "visit-1", status: "PLANNED" },
      { id: "visit-2", status: "PLANNED" },
    ]);

    const result = await updateWorkOrder(actor(), "wo-1", {
      title: "Service",
      description: "",
      departmentId: "dep-a",
      customerId: "",
      contactId: "",
      scheduledFor: "2026-11-02",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-data",
      detail: "visits.errors.multipleVisits",
    });
    expect(tx.workOrder.update).not.toHaveBeenCalled();
  });

  it("kopierer visiter og visittmontører ved kloning", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo-1",
      title: "Service",
      description: "Beskrivelse",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: null,
      scheduledFor: new Date("2026-10-24T00:00:00.000Z"),
      scheduledTo: null,
      technicians: [{ id: "tech-1" }],
      templates: [],
      tags: [],
      visits: [
        {
          sequence: 0,
          startsAt: new Date("2026-10-24T06:00:00.000Z"),
          endsAt: new Date("2026-10-24T10:00:00.000Z"),
          allDay: false,
          notes: "Port 2",
          technicians: [{ userId: "tech-1" }],
        },
      ],
    });
    const tx = withTransaction();

    const result = await cloneWorkOrder(actor(), "wo-1");

    expect(result).toEqual({ ok: true, id: "wo-new" });
    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderId: "wo-new",
        sequence: 0,
        startsAt: new Date("2026-10-24T06:00:00.000Z"),
        endsAt: new Date("2026-10-24T10:00:00.000Z"),
        allDay: false,
        notes: "Port 2",
        status: "PLANNED",
        technicians: { create: [{ userId: "tech-1" }] },
      }),
    });
    expect(mocks.recomputeWorkOrderSchedule).toHaveBeenCalledWith(tx, "wo-new");
  });
});
