import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "@/lib/access";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: { findFirst: vi.fn(), findUnique: vi.fn() },
    report: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    reportDraft: { deleteMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() },
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
  canAccessWorkOrder: (
    user: { role?: string; customerId?: string | null; departmentId?: string | null },
    workOrder: { customerId?: string | null; departmentId?: string | null },
  ) => {
    if (user.role === "ADMIN") return true;
    if (user.role === "CUSTOMER") {
      return Boolean(user.customerId && workOrder.customerId === user.customerId);
    }
    return Boolean(
      user.departmentId && workOrder.departmentId === user.departmentId,
    );
  },
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
    reportRevision: { create: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
    ...overrides,
  };
}

function revisionSource(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    revision: 0,
    isLocked: false,
    dataJson: JSON.stringify({ status: "GODKJENT", unitCount: 1 }),
    templateSnapshotJson: template.fieldsJson,
    technicianSignatureUrl: "/uploads/tekniker-gammel.png",
    technicianName: "Kari",
    customerSignatureUrl: "/uploads/kunde-gammel.png",
    customerName: "Kunde",
    units: [
      {
        id: "unit-1",
        label: "Pumpe",
        serialNumber: "SN-1",
        location: "Kjeller",
        status: "GODKJENT",
        answersJson: "{}",
        comment: null,
        productId: null,
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
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

  it("låser opp rapporten, lagrer revisjon og logger årsaken", async () => {
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () => revisionSource({ revision: 3 })),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
      }),
    );

    const result = await setReportLock(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo1",
      "r1",
      "0",
      "Kunden oppdaget feil i sjekkpunkt 2",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.reportRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reportId: "r1",
        revision: 3,
        reason: "Kunden oppdaget feil i sjekkpunkt 2",
        createdById: "u1",
        unitsJson: expect.stringContaining("SN-1"),
        technicianSignatureUrl: "/uploads/tekniker-gammel.png",
      }),
    });
    expect(tx.report.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: {
        isLocked: false,
        lockedAt: null,
        lockedByName: null,
        revision: { increment: 1 },
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo1",
        metadata: {
          reportId: "r1",
          reason: "Kunden oppdaget feil i sjekkpunkt 2",
        },
      }),
    });
  });

  it("avviser opplåsing uten årsak", async () => {
    const result = await setReportLock(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo1",
      "r1",
      "0",
      "   ",
    );

    expect(result).toEqual({ ok: false, error: "ugyldig-data" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
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

  it("lagrer kladdesignaturer som filer og bare /uploads-URL-er i dataJson", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.upsert.mockResolvedValue({});
    mocks.storeDataImage
      .mockResolvedValueOnce("/uploads/tekniker.png")
      .mockResolvedValueOnce("/uploads/kunde.png");

    const data = formData();
    data.set("technicianSignature", "data:image/png;base64,AAAA");
    data.set("customerSignature", "data:image/png;base64,BBBB");

    const result = await saveDraft(actor(), data);

    expect(result.ok).toBe(true);
    expect(mocks.storeDataImage).toHaveBeenCalledWith(
      "data:image/png;base64,AAAA",
      expect.objectContaining({
        ownerType: "USER",
        ownerId: "u1",
        uploadedById: "u1",
      }),
    );

    const upsert = mocks.prisma.reportDraft.upsert.mock.calls[0][0] as {
      create: { dataJson: string };
    };
    expect(upsert.create.dataJson).toContain("/uploads/tekniker.png");
    expect(upsert.create.dataJson).toContain("/uploads/kunde.png");
    expect(upsert.create.dataJson).not.toContain("data:image");
  });

  it("beholder en eksisterende /uploads-signatur uten å laste den opp på nytt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.upsert.mockResolvedValue({});
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "USER",
      ownerId: "u1",
      uploadedById: "u1",
    });

    const data = formData();
    data.set("technicianSignature", "/uploads/finnes.png");

    const result = await saveDraft(actor(), data);

    expect(result.ok).toBe(true);
    expect(mocks.storeDataImage).not.toHaveBeenCalled();
    const upsert = mocks.prisma.reportDraft.upsert.mock.calls[0][0] as {
      create: { dataJson: string };
    };
    expect(upsert.create.dataJson).toContain("/uploads/finnes.png");
  });

  it("avviser en kladd som serialiseres til mer enn 1 MB", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.findUnique.mockResolvedValue(null);

    const data = formData();
    const units = Array.from({ length: 50 }, (_, index) => ({
      key: `unit-${index}`,
      label: "Pumpe",
      productId: "",
      serialNumber: "",
      location: "",
    }));
    data.set("unitsJson", JSON.stringify(units));
    for (const unit of units) {
      data.set(`status__${unit.key}`, "GODKJENT");
      data.set(`comment__${unit.key}`, "x".repeat(20_000));
    }

    const result = await saveDraft(actor(), data);

    expect(result).toEqual({ ok: false });
    expect(mocks.prisma.reportDraft.upsert).not.toHaveBeenCalled();
  });

  it("sletter en erstattet kladdesignatur etter vellykket lagring", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.findUnique.mockResolvedValue({
      dataJson: JSON.stringify({ technicianSignatureUrl: "/uploads/gammel.png" }),
    });
    mocks.prisma.reportDraft.upsert.mockResolvedValue({});
    mocks.storeDataImage.mockResolvedValue("/uploads/ny.png");

    const data = formData();
    data.set("technicianSignature", "data:image/png;base64,AAAA");

    const result = await saveDraft(actor(), data);

    expect(result.ok).toBe(true);
    expect(mocks.deleteUploadIfOwned).toHaveBeenCalledWith("/uploads/gammel.png", {
      ownerType: "USER",
      ownerId: "u1",
    });
  });

  it("avviser en rapport uten enheter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const data = formData();
    data.set("unitsJson", "[]");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-data",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser manglende påkrevd sjekkpunkt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      templates: [
        {
          ...template,
          fieldsJson: JSON.stringify([
            { id: "f1", type: "CHECKBOX", label: "Sjekket", required: true },
          ]),
        },
      ],
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const data = formData();
    data.delete("answer__unit-0__f1");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-data",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
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

  it("tar over en USER-eid kladdesignatur ved innsending", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "USER",
      ownerId: "u1",
      uploadedById: "u1",
    });
    mocks.prisma.upload.update.mockResolvedValue({});
    const tx = withTransaction();
    const data = formData();
    data.set("technicianSignature", "/uploads/kladdesignatur.png");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.upload.update).toHaveBeenCalledWith({
      where: { storedName: "kladdesignatur.png" },
      data: {
        ownerType: "WORK_ORDER",
        ownerId: "wo1",
        departmentId: "dep-a",
        customerId: null,
      },
    });
    expect(tx.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          technicianSignatureUrl: "/uploads/kladdesignatur.png",
        }),
      }),
    );
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
          findUnique: vi.fn(async () => revisionSource()),
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
  it("lager revisjon ved ny innsending og øker revisjonsnummeret", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      technicianSignatureUrl: "/uploads/tekn-gammel.png",
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () =>
            revisionSource({
              revision: 4,
              dataJson: JSON.stringify({ status: "AVVIK", unitCount: 1 }),
            }),
          ),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
      }),
    );

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.reportRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reportId: "r1",
        revision: 4,
        reason: "Ny innsending",
        createdById: "u1",
        dataJson: JSON.stringify({ status: "AVVIK", unitCount: 1 }),
        unitsJson: expect.stringContaining("SN-1"),
      }),
    });
    expect(tx.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revision: { increment: 1 } }),
      }),
    );
  });

  it("opplåsing, retting og ny innsending gir to revisjoner med intakt første payload", async () => {
    const originalDataJson = JSON.stringify({ status: "GODKJENT", unitCount: 1 });
    const revisions: Array<{ data: Record<string, unknown> }> = [];

    const unlockTx = txClient({
      report: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () =>
          revisionSource({ revision: 0, dataJson: originalDataJson }),
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({ id: "r1" })),
      },
      reportRevision: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          revisions.push(args);
          return {};
        }),
      },
    });
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: typeof unlockTx) => unknown) => callback(unlockTx),
    );

    const unlock = await setReportLock(
      actor({ role: "ADMIN", permissionsCustomized: true, permissions: null }),
      "wo1",
      "r1",
      "0",
      "Rett feil i sjekkpunkt",
    );
    expect(unlock).toEqual({ ok: true });

    // Etter opplåsingen er rapporten redigert og sendes inn på nytt.
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      technicianSignatureUrl: "/uploads/tekniker-gammel.png",
      technicianName: "Kari",
      customerSignatureUrl: "/uploads/kunde-gammel.png",
      customerName: "Kunde",
    });
    const resubmitTx = txClient({
      report: {
        findUnique: vi.fn(async () =>
          revisionSource({ revision: 1, dataJson: originalDataJson }),
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({ id: "r1" })),
      },
      reportRevision: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          revisions.push(args);
          return {};
        }),
      },
    });
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: typeof resubmitTx) => unknown) => callback(resubmitTx),
    );

    const resubmit = await submitReport(actor(), formData());
    expect(resubmit).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });

    expect(revisions).toHaveLength(2);
    expect(revisions[0].data).toEqual(
      expect.objectContaining({
        revision: 0,
        reason: "Rett feil i sjekkpunkt",
        dataJson: originalDataJson,
      }),
    );
    expect(JSON.parse(String(revisions[0].data.unitsJson))).toEqual([
      expect.objectContaining({ label: "Pumpe", serialNumber: "SN-1" }),
    ]);
    expect(revisions[1].data).toEqual(
      expect.objectContaining({
        revision: 1,
        reason: "Ny innsending",
        dataJson: originalDataJson,
      }),
    );
  });

  it("sletter ikke forrige signaturfil ved ny innsending", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      technicianSignatureUrl: "/uploads/gammel-signatur.png",
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });
    mocks.storeDataImage.mockResolvedValue("/uploads/ny-signatur.png");
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () =>
            revisionSource({
              revision: 2,
              technicianSignatureUrl: "/uploads/gammel-signatur.png",
            }),
          ),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
      }),
    );
    const data = formData();
    data.set("technicianSignature", "data:image/png;base64,AAAA");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.update).toHaveBeenCalled();
    expect(mocks.deleteUploadIfOwned).not.toHaveBeenCalledWith(
      "/uploads/gammel-signatur.png",
      expect.anything(),
    );
  });
});

describe("getReportPdfForViewer", () => {
  it("avviser CUSTOMER uten customerId selv om oppdraget mangler kunde", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
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
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
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

  it("avviser montør i en annen avdeling", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      status: "OPEN",
      reports: [{ id: "r1" }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1");

    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("avviser montør på et kansellert oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      status: "CANCELLED",
      reports: [{ id: "r1" }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1");

    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
