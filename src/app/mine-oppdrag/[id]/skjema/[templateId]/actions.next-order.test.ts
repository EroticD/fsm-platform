import { beforeEach, describe, expect, it, vi } from "vitest";

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
    reportDraft: { deleteMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    product: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  nextOrder: { id: "wo2" } as { id: string } | null,
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

function formData(returnTo: string) {
  const data = new FormData();
  data.set("workOrderId", "wo1");
  data.set("templateId", "tpl1");
  data.set("unitsJson", JSON.stringify([
    { key: "unit-0", label: "Pumpe", productId: "", serialNumber: "", location: "" },
  ]));
  data.set("status__unit-0", "GODKJENT");
  data.set("answer__unit-0__f1", "OK");
  data.set("notes", "Alt i orden");
  data.set("returnTo", returnTo);
  return data;
}

describe("submitReport – neste oppdrag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
    );
    mocks.prisma.report.update.mockResolvedValue({});
    mocks.prisma.report.create.mockResolvedValue({ id: "r1" });
    mocks.prisma.reportDraft.deleteMany.mockResolvedValue({});
    mocks.prisma.auditLog.create.mockResolvedValue({});
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    // Første oppslag gjelder oppdraget som sendes inn; oppslaget med en AND-liste
    // er beregningen av neste tildelte oppdrag.
    mocks.prisma.workOrder.findFirst.mockImplementation(
      async (args: { where?: { AND?: unknown[] } }) =>
        Array.isArray(args?.where?.AND) ? mocks.nextOrder : {
          id: "wo1",
          customerId: null,
          status: "OPEN",
          templates: [template],
        },
    );
  });

  it("sender montøren til neste tildelte oppdrag med kvittering", async () => {
    mocks.nextOrder = { id: "wo2" };

    await expect(submitReport(formData("/mine-oppdrag/wo1"))).rejects.toThrow(
      "NEXT_REDIRECT:/mine-oppdrag/wo2?status=rapport-sendt&sent=wo1&sentTemplate=tpl1",
    );
  });

  it("beholder dagens retur når det ikke finnes flere oppdrag", async () => {
    mocks.nextOrder = null;

    await expect(submitReport(formData("/mine-oppdrag/wo1"))).rejects.toThrow(
      "NEXT_REDIRECT:/mine-oppdrag/wo1?reportSubmitted=tpl1",
    );
  });

  it("endrer ikke kontorets retur", async () => {
    mocks.nextOrder = { id: "wo2" };

    await expect(submitReport(formData("/oppdrag/wo1"))).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1?reportSubmitted=tpl1",
    );
  });
});
