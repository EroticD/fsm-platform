import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  user: {
    id: "u1",
    name: "Kari",
    email: "kari@example.com",
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
  },
  prisma: {
    workOrder: { findFirst: vi.fn() },
    report: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    reportDraft: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    product: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => mocks.user),
  actorName: vi.fn(async () => "Kari"),
  isOffice: (role: string) => role === "ADMIN" || role === "OFFICE",
}));
vi.mock("@/lib/access", () => ({
  workOrderScope: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { submitReport } from "./actions";

const template = {
  id: "tpl1",
  title: "Sjekkliste",
  fieldsJson: JSON.stringify([
    { id: "f1", type: "TEXT", label: "Tilstand", required: false },
  ]),
};

function formData() {
  const data = new FormData();
  data.set("workOrderId", "wo1");
  data.set("templateId", "tpl1");
  data.set("unitsJson", JSON.stringify([
    { key: "unit-0", label: "Pumpe", productId: "", serialNumber: "", location: "" },
  ]));
  data.set("status__unit-0", "GODKJENT");
  data.set("answer__unit-0__f1", "OK");
  data.set("notes", "Alt i orden");
  data.set("returnTo", "/oppdrag/wo1");
  return data;
}

function workOrder() {
  return {
    id: "wo1",
    customerId: null,
    status: "OPEN",
    templates: [template],
  };
}

describe("submitReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
    );
    mocks.prisma.report.update.mockResolvedValue({});
    mocks.prisma.report.create.mockResolvedValue({ id: "r1" });
    mocks.prisma.reportDraft.deleteMany.mockResolvedValue({});
    mocks.prisma.auditLog.create.mockResolvedValue({});
  });

  it("avviser en mal som ikke hører til oppdraget", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(null);

    await submitReport(formData());

    expect(mocks.prisma.report.create).not.toHaveBeenCalled();
    expect(mocks.prisma.report.update).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("kan ikke sende inn på nytt når rapporten er låst", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({ id: "r1", isLocked: true });

    await expect(submitReport(formData())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1?error=locked",
    );

    expect(mocks.prisma.report.update).not.toHaveBeenCalled();
    expect(mocks.prisma.report.create).not.toHaveBeenCalled();
  });

  it("lagrer malens tittel og innhold som øyeblikksbilde", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);

    await expect(submitReport(formData())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1",
    );

    expect(mocks.prisma.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderId: "wo1",
        templateId: "tpl1",
        templateTitle: "Sjekkliste",
        templateSnapshotJson: template.fieldsJson,
        isLocked: true,
      }),
      select: { id: true },
    });

    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo1",
      }),
    });
  });

  it("håndterer samtidig innsending som duplikat", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(submitReport(formData())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1?error=locked",
    );
  });
});
