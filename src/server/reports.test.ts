import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "@/lib/access";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: { findFirst: vi.fn(), findUnique: vi.fn() },
    report: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    reportDraft: { deleteMany: vi.fn(), upsert: vi.fn() },
    product: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    upload: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  storeDataImage: vi.fn(),
  deleteUploadIfOwned: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/access", () => ({
  workOrderScope: vi.fn(() => ({})),
}));
vi.mock("@/lib/session", () => ({
  isOffice: (role: string) => role === "ADMIN" || role === "OFFICE",
}));
vi.mock("@/lib/upload-store", () => ({
  storeDataImage: mocks.storeDataImage,
  deleteUploadIfOwned: mocks.deleteUploadIfOwned,
}));

import {
  getReportPdfForViewer,
  saveDraft,
  setReportLock,
  submitReport,
} from "./reports";

const template = {
  id: "tpl1",
  title: "Sjekkliste",
  fieldsJson: JSON.stringify([
    { id: "f1", type: "TEXT", label: "Tilstand", required: false },
  ]),
};

function actor(overrides: Record<string, unknown> = {}): AccessUser {
  return {
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
    ...overrides,
  } as unknown as AccessUser;
}

function workOrder() {
  return {
    id: "wo1",
    customerId: null,
    departmentId: "dep-a",
    status: "OPEN",
    templates: [template],
  };
}

function formData(overrides: { workOrderId?: string; templateId?: string } = {}) {
  const data = new FormData();
  data.set("workOrderId", overrides.workOrderId ?? "wo1");
  data.set("templateId", overrides.templateId ?? "tpl1");
  data.set(
    "unitsJson",
    JSON.stringify([
      { key: "unit-0", label: "Pumpe", productId: "", serialNumber: "", location: "" },
    ]),
  );
  data.set("status__unit-0", "GODKJENT");
  data.set("answer__unit-0__f1", "OK");
  data.set("notes", "Alt i orden");
  data.set("returnTo", "/oppdrag/wo1");
  return data;
}

function txClient(overrides: Record<string, unknown> = {}) {
  return {
    report: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: "r1" })),
    },
    reportDraft: { deleteMany: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
    ...overrides,
  };
}

function withTransaction(tx = txClient()) {
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (client: typeof tx) => unknown) => callback(tx),
  );
  return tx;
}

describe("reports-tjenesten", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeDataImage.mockResolvedValue("/uploads/signatur.png");
    mocks.deleteUploadIfOwned.mockResolvedValue(undefined);
  });

  it("avviser innsending med ugyldige id-er før databasen røres", async () => {
    const result = await submitReport(
      actor(),
      formData({ workOrderId: "", templateId: "" }),
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser innsending uten reports.write", async () => {
    const result = await submitReport(
      actor({ permissionsCustomized: true, permissions: [] }),
      formData(),
    );

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
  });

  it("lagrer malens tittel og innhold som øyeblikksbilde og logger signeringen", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderId: "wo1",
        templateId: "tpl1",
        templateTitle: "Sjekkliste",
        templateSnapshotJson: template.fieldsJson,
        isLocked: true,
      }),
      select: { id: true },
    });
    expect(tx.reportDraft.deleteMany).toHaveBeenCalledWith({
      where: { workOrderId: "wo1", templateId: "tpl1", userId: "u1" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo1",
        metadata: { reportId: "r1", templateId: "tpl1" },
      }),
    });
  });

  it("kan ikke overskrive en låst rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: true,
      technicianSignatureUrl: null,
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({ ok: false, error: "locked", returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("ruller tilbake rapporten når revisjonsloggen feiler", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);

    let committed: string | null = null;
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => {
        let pending: string | null = null;
        const tx = txClient({
          report: {
            findUnique: vi.fn(async () => null),
            update: vi.fn(async () => ({})),
            create: vi.fn(async () => {
              pending = "r1";
              return { id: "r1" };
            }),
          },
          auditLog: {
            create: vi.fn(async () => {
              throw new Error("audit feilet");
            }),
          },
        });

        try {
          const result = await callback(tx);
          committed = pending;
          return result;
        } catch (error) {
          // Simulerer at databasetransaksjonen rulles tilbake.
          pending = null;
          throw error;
        }
      },
    );

    await expect(submitReport(actor(), formData())).rejects.toThrow("audit feilet");
    expect(committed).toBeNull();
  });

  it("lar bare administrator låse eller låse opp rapporten", async () => {
    const result = await setReportLock(actor(), "wo1", "r1", "0");

    expect(result).toEqual({ ok: false, error: "ikke-tilgang" });
    expect(mocks.prisma.report.findFirst).not.toHaveBeenCalled();
  });

  it("låser opp rapporten og logger det i samme transaksjon", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue({ id: "r1" });
    const tx = withTransaction();

    const result = await setReportLock(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo1",
      "r1",
      "0",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.report.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { isLocked: false, lockedAt: null, lockedByName: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo1",
        metadata: { reportId: "r1" },
      }),
    });
  });

  it("avviser kladd når kladden ikke får skrives", async () => {
    const result = await saveDraft(
      actor({ permissionsCustomized: true, permissions: [] }),
      formData(),
    );

    expect(result).toEqual({ ok: false });
    expect(mocks.prisma.reportDraft.upsert).not.toHaveBeenCalled();
  });

  it("lagrer kladden for en bruker med reports.write", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.upsert.mockResolvedValue({});

    const result = await saveDraft(actor(), formData());

    expect(result.ok).toBe(true);
    expect(mocks.prisma.reportDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workOrderId_templateId_userId: {
            workOrderId: "wo1",
            templateId: "tpl1",
            userId: "u1",
          },
        },
      }),
    );
  });

  it("avviser en samtidig innsending som taper låsekravet", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      technicianSignatureUrl: null,
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () => ({ id: "r1", isLocked: false })),
          updateMany: vi.fn(async () => ({ count: 0 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
      }),
    );

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({ ok: false, error: "locked", returnTo: "/oppdrag/wo1" });
    expect(tx.report.update).not.toHaveBeenCalled();
  });

  it("avviser en signaturfil som tilhører et annet oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      technicianSignatureUrl: null,
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "WORK_ORDER",
      ownerId: "annet-oppdrag",
      uploadedById: "u1",
    });
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () => ({ id: "r1", isLocked: false })),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
      }),
    );
    const data = formData();
    data.set("technicianSignature", "/uploads/fremmed.png");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ technicianSignatureUrl: null }),
      }),
    );
  });
});

describe("getReportPdfForViewer", () => {
  it("avviser CUSTOMER uten customerId selv om oppdraget mangler kunde", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      customerId: null,
      status: "OPEN",
      reports: [{ id: "r1" }],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "CUSTOMER", customerId: null }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("avviser CUSTOMER som prøver å hente en annen kundes rapport", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      customerId: "kunde-2",
      status: "OPEN",
      reports: [{ id: "r1" }],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "CUSTOMER", customerId: "kunde-1" }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("avviser montør på et kansellert oppdrag", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      customerId: "kunde-1",
      status: "CANCELLED",
      reports: [{ id: "r1" }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1");

    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
