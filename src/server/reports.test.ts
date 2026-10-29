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
  getOrRenderReportPdf: vi.fn(),
  notifyWorkOrderEvent: vi.fn(),
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
vi.mock("@/lib/report-pdf-store", () => ({
  getOrRenderReportPdf: mocks.getOrRenderReportPdf,
}));
vi.mock("./notifications", () => ({
  notifyWorkOrderEvent: mocks.notifyWorkOrderEvent,
}));

import {
  getReportPdfForViewer,
  saveDraft,
  setReportLock,
  submitReport,
} from "./reports";
import { REPORT_STATUS_WITHOUT_UNITS } from "@/lib/report-answers";

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
    title: "Testoppdrag",
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

const noUnitTemplate = {
  id: "tpl1",
  title: "Samlet sjekkliste",
  reportName: "Egen rapport",
  requiresUnits: false,
  fieldsJson: JSON.stringify([
    { id: "f1", type: "TEXT", label: "Tilstand", required: false },
  ]),
};

function noUnitFormData() {
  const data = new FormData();
  data.set("workOrderId", "wo1");
  data.set("templateId", "tpl1");
  // Klienten kan fortsatt sende enhetsmetadata; serveren skal ignorere den.
  data.set(
    "unitsJson",
    JSON.stringify([
      {
        key: "report",
        label: "Skal ignoreres",
        productId: "produkt-1",
        serialNumber: "SN-999",
        location: "Feil sted",
      },
      { key: "ekstra", label: "Ekstra enhet" },
    ]),
  );
  data.set("status__report", "AVVIK");
  data.set("answer__report__f1", "Avvik funnet");
  data.set("comment__report", "Kommentar til rapporten");
  data.set("notes", "Alt i orden");
  data.set("returnTo", "/oppdrag/wo1");
  return data;
}

function txClient(overrides: Record<string, unknown> = {}) {
  return {
    report: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: "r1" })),
    },
    reportDraft: { deleteMany: vi.fn(async () => ({})) },
    reportRevision: { create: vi.fn(async () => ({})) },
    workOrder: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: "wo-rem" })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    ...overrides,
  };
}

function revisionSource(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    revision: 0,
    isLocked: false,
    lockedAt: null,
    lockedByName: null,
    templateId: "tpl1",
    pdfHash: null,
    legalHold: false,
    dataJson: JSON.stringify({ status: "GODKJENT", unitCount: 1 }),
    comments: "Gammel kommentar fra signeringen",
    templateTitle: "Gammel sjekkliste",
    name: "Gammel rapport",
    requiresUnits: false,
    templateCategory: "SERVICE",
    hmsType: null,
    completedAt: new Date("2026-01-02T00:00:00.000Z"),
    templateSnapshotJson: template.fieldsJson,
    technicianSignatureUrl: "/uploads/tekniker-gammel.png",
    technicianName: "Kari",
    customerSignatureUrl: "/uploads/kunde-gammel.png",
    customerName: "Kunde",
    customerAcknowledgedAt: null,
    customerAcknowledgedBy: null,
    customerAcknowledgedComment: null,
    workOrder: { legalHold: false },
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
    mocks.notifyWorkOrderEvent.mockResolvedValue(1);
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
        name: "Sjekkliste",
        requiresUnits: true,
        // Eldre maler uten kategori lagres som service.
        templateCategory: "SERVICE",
        hmsType: null,
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
        metadata: { reportId: "r1", templateId: "tpl1", remediationWorkOrderId: null },
      }),
    });
  });

  it("varsler om klar rapport med rapport- og oppdragsnavn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    withTransaction();

    const result = await submitReport(actor(), formData());

    expect(result.ok).toBe(true);
    expect(mocks.notifyWorkOrderEvent).toHaveBeenCalledWith(
      "wo1",
      "REPORT_READY",
      "Rapport klar: Sjekkliste",
      "«Sjekkliste» for «Testoppdrag» er signert og klar.",
      "/mine-oppdrag/wo1",
      "report-ready:wo1:tpl1",
    );
  });

  it("lagrer kategori og HMS-type fra malen som øyeblikksbilde", async () => {
    const hmsTemplate = {
      id: "tpl1",
      title: "Sikker Jobb Analyse",
      reportName: "SJA – Sikker jobb analyse",
      category: "HMS",
      hmsType: "SJA",
      requiresUnits: false,
      fieldsJson: JSON.stringify([
        { id: "f1", type: "TEXT", label: "Hva skal gjøres?", required: false },
      ]),
    };
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      templates: [hmsTemplate],
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateId: "tpl1",
        templateCategory: "HMS",
        hmsType: "SJA",
        name: "SJA – Sikker jobb analyse",
        reportNumber: expect.stringMatching(/^[a-z]{3}\d{4}$/),
      }),
      select: { id: true },
    });

    const reportNumber = (
      tx.report.create as unknown as {
        mock: { calls: Array<[{ data: { reportNumber: string } }]> };
      }
    ).mock.calls[0][0].data.reportNumber;
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo1",
        action: `Tildelte rapportnummer ${reportNumber}`,
        actorId: "u1",
        metadata: expect.objectContaining({
          reportId: "r1",
          templateId: "tpl1",
          reportNumber,
        }),
      }),
    });
  });

  it("bevarer kategori og HMS-type i revisjonsøyeblikksbildet", async () => {
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
          findUnique: vi.fn(async () =>
            revisionSource({
              revision: 1,
              templateCategory: "HMS",
              hmsType: "DEVIATION",
            }),
          ),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
      }),
    );

    await submitReport(actor(), formData());

    expect(tx.reportRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateCategory: "HMS",
        hmsType: "DEVIATION",
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
        comments: "Gammel kommentar fra signeringen",
        templateTitle: "Gammel sjekkliste",
        name: "Gammel rapport",
        requiresUnits: false,
        completedAt: new Date("2026-01-02T00:00:00.000Z"),
        technicianSignatureUrl: "/uploads/tekniker-gammel.png",
      }),
    });
    expect(tx.report.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: {
        isLocked: false,
        lockedAt: null,
        lockedByName: null,
        customerAcknowledgedAt: null,
        customerAcknowledgedBy: null,
        customerAcknowledgedComment: null,
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

  it("lagrer en uvurdert enhet som UNASSESSED i kladden", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.upsert.mockResolvedValue({});
    const data = formData();
    data.delete("status__unit-0");

    const result = await saveDraft(actor(), data);

    expect(result.ok).toBe(true);
    const upsert = mocks.prisma.reportDraft.upsert.mock.calls[0][0] as {
      create: { dataJson: string };
    };
    const payload = JSON.parse(upsert.create.dataJson) as {
      units: Array<{ status: string }>;
    };
    expect(payload.units[0]).toMatchObject({ status: "UNASSESSED" });
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

  it("lagrer kladd for en mal uten enheter med den anonyme oppføringen", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      templates: [noUnitTemplate],
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.upsert.mockResolvedValue({});

    const data = noUnitFormData();
    data.set("unitsJson", JSON.stringify([{ key: "report" }]));

    const result = await saveDraft(actor(), data);

    expect(result.ok).toBe(true);
    const upsert = mocks.prisma.reportDraft.upsert.mock.calls[0][0] as {
      create: { dataJson: string };
    };
    const payload = JSON.parse(upsert.create.dataJson) as {
      units: Array<Record<string, unknown>>;
    };
    expect(payload.units).toHaveLength(1);
    expect(payload.units[0]).toMatchObject({
      label: "",
      status: REPORT_STATUS_WITHOUT_UNITS,
    });
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
      error: "mangler-enhet",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["manglende status", undefined],
    ["eksplisitt UNASSESSED", "UNASSESSED"],
  ])("avviser en enhet med %s", async (_label, status) => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const data = formData();
    if (status) data.set("status__unit-0", status);
    else data.delete("status__unit-0");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: false,
      error: "mangler-vurdering",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.report.create).not.toHaveBeenCalled();
  });

  it("fullfører oppdraget i samme transaksjon når valget er krysset av", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();
    const data = formData();
    data.set("completeWorkOrder", "1");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.report.create).toHaveBeenCalled();
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo1",
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      data: { status: "COMPLETED" },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo1",
        action: "Montør endret status til: COMPLETED",
        actorId: "u1",
        metadata: expect.objectContaining({
          from: "OPEN",
          to: "COMPLETED",
          reportId: "r1",
          templateId: "tpl1",
          via: "report-submit",
        }),
      }),
    });
  });

  it("endrer ikke oppdragets status når valget ikke er krysset av", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.create).toHaveBeenCalled();
    expect(tx.workOrder.updateMany).not.toHaveBeenCalled();
  });

  it("ruller tilbake både rapport og fullføring når transaksjonen feiler", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);

    let committedReport: string | null = null;
    let committedCompletion = false;
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => {
        let pendingReport: string | null = null;
        let pendingCompletion = false;
        const tx = txClient({
          report: {
            findUnique: vi.fn(async () => null),
            updateMany: vi.fn(async () => ({ count: 1 })),
            update: vi.fn(async () => ({})),
            create: vi.fn(async () => {
              pendingReport = "r1";
              return { id: "r1" };
            }),
          },
          workOrder: {
            findUnique: vi.fn(async () => null),
            updateMany: vi.fn(async () => {
              pendingCompletion = true;
              return { count: 1 };
            }),
            create: vi.fn(async () => ({ id: "wo-rem" })),
          },
          auditLog: {
            create: vi.fn(async () => {
              throw new Error("audit feilet");
            }),
          },
        });

        try {
          const result = await callback(tx);
          committedReport = pendingReport;
          committedCompletion = pendingCompletion;
          return result;
        } catch (error) {
          // Simulerer at databasetransaksjonen rulles tilbake.
          pendingReport = null;
          pendingCompletion = false;
          throw error;
        }
      },
    );
    const data = formData();
    data.set("completeWorkOrder", "1");

    await expect(submitReport(actor(), data)).rejects.toThrow("audit feilet");
    expect(committedReport).toBeNull();
    expect(committedCompletion).toBe(false);
  });

  it("lagrer rapporten når oppdraget allerede er fullført", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      status: "COMPLETED",
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();
    tx.workOrder.updateMany.mockResolvedValue({ count: 0 });
    const data = formData();
    data.set("completeWorkOrder", "1");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.create).toHaveBeenCalled();
    expect(tx.workOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "wo1",
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      data: { status: "COMPLETED" },
    });
    // Den betingede oppdateringen traff ingen rad, så statusendringen logges ikke.
    expect(tx.auditLog.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: expect.stringContaining("endret status"),
      }),
    });
  });

  it("bevarer tall, dato og tekst når rapporten har bildefelt", async () => {
    const mixedTemplate = {
      id: "tpl-mixed",
      title: "Bilde og verdier",
      reportName: "Bilde og verdier",
      category: "SERVICE",
      hmsType: null,
      requiresUnits: true,
      fieldsJson: JSON.stringify([
        { id: "f_num", type: "NUMBER", label: "Antall", required: false },
        { id: "f_date", type: "DATE", label: "Dato", required: false },
        { id: "f_text", type: "TEXT", label: "Tekst", required: false },
        { id: "f_image", type: "IMAGE", label: "Bilde", required: false },
      ]),
    };
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      templates: [mixedTemplate],
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "bilde.png",
        ownerType: "WORK_ORDER",
        ownerId: "wo1",
        departmentId: "dep-a",
        customerId: null,
        uploadedById: "u1",
      },
    ]);
    const tx = withTransaction();
    const data = new FormData();
    data.set("workOrderId", "wo1");
    data.set("templateId", mixedTemplate.id);
    data.set("unitsJson", JSON.stringify([{ key: "unit-0", label: "Pumpe" }]));
    data.set("status__unit-0", "GODKJENT");
    data.set("answer__unit-0__f_num", "42");
    data.set("answer__unit-0__f_date", "2026-10-27");
    data.set("answer__unit-0__f_text", "Viktig tekst");
    data.set("answer__unit-0__f_image", '["/uploads/bilde.png"]');

    const result = await submitReport(actor(), data);
    expect(result.ok).toBe(true);

    const create = (
      tx.report.create as unknown as {
        mock: { calls: Array<[{ data: { units: { create: Array<{ answersJson: string }> } } }]> };
      }
    ).mock.calls[0][0];
    const answers = JSON.parse(create.data.units.create[0].answersJson);
    expect(answers).toMatchObject({
      f_num: "42",
      f_date: "2026-10-27",
      f_text: "Viktig tekst",
      f_image: '["/uploads/bilde.png"]',
    });
  });

  it("filtrerer opplastings-URL-er i alle svarfelt, ikke bare bildefelt", async () => {
    const mixedTemplate = {
      id: "tpl-mixed",
      title: "Tekst og bilde",
      reportName: "Tekst og bilde",
      category: "SERVICE",
      hmsType: null,
      requiresUnits: true,
      fieldsJson: JSON.stringify([
        { id: "f_text", type: "TEXT", label: "Tekst", required: false },
        { id: "f_image", type: "IMAGE", label: "Bilde", required: false },
      ]),
    };
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      templates: [mixedTemplate],
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "ok.png",
        ownerType: "WORK_ORDER",
        ownerId: "wo1",
        departmentId: "dep-a",
        customerId: null,
        uploadedById: "u1",
      },
      {
        storedName: "fremmed.png",
        ownerType: "WORK_ORDER",
        ownerId: "annet-oppdrag",
        departmentId: "dep-a",
        customerId: null,
        uploadedById: "u1",
      },
    ]);
    const tx = withTransaction();
    const data = new FormData();
    data.set("workOrderId", "wo1");
    data.set("templateId", mixedTemplate.id);
    data.set("unitsJson", JSON.stringify([{ key: "unit-0", label: "Pumpe" }]));
    data.set("status__unit-0", "GODKJENT");
    data.set(
      "answer__unit-0__f_text",
      '["/uploads/ok.png","/uploads/fremmed.png"]',
    );
    data.set(
      "answer__unit-0__f_image",
      '["/uploads/ok.png","/uploads/fremmed.png"]',
    );

    const result = await submitReport(actor(), data);

    expect(result.ok).toBe(true);
    const create = (
      tx.report.create as unknown as {
        mock: {
          calls: Array<[{ data: { units: { create: Array<{ answersJson: string }> } } }]>;
        };
      }
    ).mock.calls[0][0];
    const answers = JSON.parse(create.data.units.create[0].answersJson) as {
      f_text: string;
      f_image: string;
    };
    expect(answers.f_text).not.toContain("fremmed.png");
    expect(answers.f_image).toBe('["/uploads/ok.png"]');
  });

  it("ignorerer klientens avviksstatus og lagrer nøytral status uten enheter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      templates: [noUnitTemplate],
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();

    // Klienten sender status=AVVIK, men uten enheter finnes det ingen enhet å
    // melde avvik på.
    const result = await submitReport(actor(), noUnitFormData());

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.product.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.product.create).not.toHaveBeenCalled();

    const create = (
      tx.report.create as unknown as {
        mock: { calls: Array<[{ data: { name: string; requiresUnits: boolean; dataJson: string; units: { create: Array<Record<string, unknown>> } } }]> };
      }
    ).mock.calls[0][0];
    expect(create.data.name).toBe("Egen rapport");
    expect(create.data.requiresUnits).toBe(false);
    expect(JSON.parse(create.data.dataJson)).toMatchObject({
      status: REPORT_STATUS_WITHOUT_UNITS,
    });
    expect(create.data.units.create).toHaveLength(1);
    expect(create.data.units.create[0]).toMatchObject({
      productId: null,
      label: "",
      serialNumber: null,
      location: null,
      status: REPORT_STATUS_WITHOUT_UNITS,
      comment: "Kommentar til rapporten",
      sortOrder: 0,
    });
    expect(JSON.parse(String(create.data.units.create[0].answersJson))).toMatchObject({
      f1: "Avvik funnet",
    });
    // Selv om klienten sendte AVVIK skal det ikke lages utbedringsoppdrag.
    expect(tx.workOrder.findUnique).not.toHaveBeenCalled();
    expect(tx.workOrder.create).not.toHaveBeenCalled();
  });

  it("håndhever påkrevde felt i den anonyme oppføringen", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      templates: [
        {
          ...noUnitTemplate,
          fieldsJson: JSON.stringify([
            { id: "f1", type: "CHECKBOX", label: "Sjekket", required: true },
          ]),
        },
      ],
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const data = noUnitFormData();
    data.delete("answer__report__f1");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-data",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("tar vare på rapportnavn og enhetsvalg i revisjonen", async () => {
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
          findUnique: vi.fn(async () =>
            revisionSource({ revision: 2, name: "Egen rapport", requiresUnits: false }),
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
        revision: 2,
        name: "Egen rapport",
        requiresUnits: false,
      }),
    });
  });

  it("avviser manglende påkrevd sjekkpunkt", async () => {    mocks.prisma.workOrder.findFirst.mockResolvedValue({
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
      mimeType: "image/png",
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

  it("avviser en WORK_ORDER-fil fra samme oppdrag som signatur", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      uploadedById: "u1",
      mimeType: "image/png",
    });
    const tx = withTransaction();
    const data = formData();
    data.set("technicianSignature", "/uploads/oppdragsfil.png");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.upload.update).not.toHaveBeenCalled();
    expect(tx.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ technicianSignatureUrl: null }),
      }),
    );
  });

  it("avviser gjenbruk av en signatur som allerede er brukt på en annen rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "USER",
      ownerId: "u1",
      uploadedById: "u1",
      mimeType: "image/png",
    });
    mocks.prisma.report.findFirst.mockResolvedValue({ id: "r-other" });
    const tx = withTransaction();
    const data = formData();
    data.set("technicianSignature", "/uploads/gjenbrukt.png");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.report.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { technicianSignatureUrl: "/uploads/gjenbrukt.png" },
            { customerSignatureUrl: "/uploads/gjenbrukt.png" },
          ],
        }),
      }),
    );
    expect(mocks.prisma.upload.update).not.toHaveBeenCalled();
    expect(tx.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ technicianSignatureUrl: null }),
      }),
    );
  });

  it("godtar samme signaturverdi når rapporten redigeres", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      technicianSignatureUrl: "/uploads/egen.png",
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
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
    data.set("technicianSignature", "/uploads/egen.png");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.upload.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.report.findFirst).not.toHaveBeenCalled();
    expect(tx.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          technicianSignatureUrl: "/uploads/egen.png",
        }),
      }),
    );
  });

  it("avviser en signaturfil som ikke er et bilde", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "USER",
      ownerId: "u1",
      uploadedById: "u1",
      mimeType: "application/pdf",
    });
    const tx = withTransaction();
    const data = formData();
    data.set("technicianSignature", "/uploads/ikke-bilde.pdf");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(mocks.prisma.upload.update).not.toHaveBeenCalled();
    expect(tx.report.create).toHaveBeenCalledWith(
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
        dataJson: expect.any(String),
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
        dataJson: expect.any(String),
      }),
    );
    expect(JSON.parse(String(revisions[0].data.dataJson))).toMatchObject({
      status: "GODKJENT",
      unitCount: 1,
      _revisionMeta: { templateId: "tpl1", isLocked: false },
    });
    expect(JSON.parse(String(revisions[0].data.unitsJson))).toEqual([
      expect.objectContaining({ label: "Pumpe", serialNumber: "SN-1" }),
    ]);
    expect(revisions[1].data).toEqual(
      expect.objectContaining({
        revision: 1,
        reason: "Ny innsending",
        dataJson: expect.any(String),
      }),
    );
  });

  it("nullstiller kundens kvittering ved ny innsending og logger tilbaketrekkingen", async () => {
    const acknowledgedAt = new Date("2026-02-01T12:00:00.000Z");
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () =>
            revisionSource({
              revision: 2,
              customerAcknowledgedAt: acknowledgedAt,
              customerAcknowledgedBy: "Kunde",
              customerAcknowledgedComment: "Mottatt",
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

    // Revisjonen bevarer den gamle kvitteringen, slik at den signerte
    // versjonen kan dokumenteres også etter at den er trukket tilbake.
    expect(tx.reportRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revision: 2,
        customerAcknowledgedAt: acknowledgedAt,
        customerAcknowledgedBy: "Kunde",
        customerAcknowledgedComment: "Mottatt",
      }),
    });

    // Den nye versjonen må kvitteres på nytt av kunden.
    expect(tx.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerAcknowledgedAt: null,
          customerAcknowledgedBy: null,
          customerAcknowledgedComment: null,
          revision: { increment: 1 },
        }),
      }),
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Report",
        entityId: "r1",
        action: expect.stringContaining("kvittering"),
        metadata: expect.objectContaining({
          workOrderId: "wo1",
          acknowledgedAt: acknowledgedAt.toISOString(),
          acknowledgedBy: "Kunde",
        }),
      }),
    });
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

  it("avviser nye rapporter på et oppdrag med bevaringsplikt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      legalHold: true,
    });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    withTransaction();

    const result = await submitReport(actor(), formData());

    expect(result).toMatchObject({ ok: false, error: "legal-hold" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser ny innsending når oppdraget har bevaringsplikt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      legalHold: true,
    });
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      legalHold: false,
      technicianSignatureUrl: null,
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({
      ok: false,
      error: "legal-hold",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser ny innsending når rapporten selv har bevaringsplikt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      legalHold: true,
      technicianSignatureUrl: null,
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({
      ok: false,
      error: "legal-hold",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser opplåsing av en rapport under bevaringsplikt", async () => {
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () => revisionSource({ legalHold: true })),
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
      "Prøver å låse opp",
    );

    expect(result).toEqual({ ok: false, error: "legal-hold" });
    expect(tx.reportRevision.create).not.toHaveBeenCalled();
    expect(tx.report.update).not.toHaveBeenCalled();
  });

  it("avviser opplåsing når oppdraget har bevaringsplikt", async () => {
    withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () =>
            revisionSource({ workOrder: { legalHold: true } }),
          ),
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
      "Prøver å låse opp",
    );

    expect(result).toEqual({ ok: false, error: "legal-hold" });
  });

  it("trekker tilbake kundens kvittering ved opplåsing og logger det", async () => {
    const acknowledgedAt = new Date("2026-02-01T12:00:00.000Z");
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () => null),
          findFirst: vi.fn(async () =>
            revisionSource({
              customerAcknowledgedAt: acknowledgedAt,
              customerAcknowledgedBy: "Kunde",
            }),
          ),
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
      "Rett feil",
    );

    expect(result).toEqual({ ok: true });
    expect(tx.report.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({
        customerAcknowledgedAt: null,
        customerAcknowledgedBy: null,
        customerAcknowledgedComment: null,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Report",
        action: expect.stringContaining("kvittering"),
        metadata: expect.objectContaining({
          acknowledgedAt: acknowledgedAt.toISOString(),
          reason: "Rett feil",
        }),
      }),
    });
  });

  it("oppretter ett datoløst utbedringsoppdrag for alle avvik med innsender som montør", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      title: "Service på pumpe",
      customerId: "cust-1",
      contactId: "contact-1",
    });
    mocks.prisma.product.findFirst.mockResolvedValue({ id: "prod-1" });
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();
    const data = formData();
    data.set("status__unit-0", "AVVIK");
    data.set("comment__unit-0", "Lekkasje ved pakning");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: true,
      returnTo: "/oppdrag/wo1",
      remediationWorkOrderId: "wo-rem",
    });
    expect(tx.workOrder.findUnique).toHaveBeenCalledWith({
      where: { deviationSourceKey: "report:r1" },
      select: { id: true },
    });
    const create = (
      tx.workOrder.create.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ]
    )[0];
    expect(create.data).toMatchObject({
      scheduledFor: null,
      scheduledTo: null,
      status: "OPEN",
      departmentId: "dep-a",
      customerId: "cust-1",
      contactId: "contact-1",
      deviationSourceKey: "report:r1",
      technicians: { connect: [{ id: "u1" }] },
    });
    expect(String(create.data.title)).toContain("Utbedring av avvik");
    expect(String(create.data.description)).toContain("Pumpe");
    expect(String(create.data.description)).toContain("Lekkasje ved pakning");
    const reportCreate = (
      tx.report.create.mock.calls[0] as unknown as [
        { data: { dataJson: string; units: { create: Array<Record<string, unknown>> } } },
      ]
    )[0];
    expect(JSON.parse(reportCreate.data.dataJson)).toMatchObject({ status: "AVVIK" });
    expect(reportCreate.data.units.create[0]).toMatchObject({ status: "AVVIK" });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo-rem",
        metadata: expect.objectContaining({
          reportId: "r1",
          sourceWorkOrderId: "wo1",
          deviationSourceKey: "report:r1",
          assignedTechnicianId: "u1",
        }),
      }),
    });
  });

  it("oppretter ikke utbedringsoppdrag når rapporten er godkjent", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    const tx = withTransaction();

    const result = await submitReport(actor(), formData());

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.workOrder.create).not.toHaveBeenCalled();
    const reportCreate = (
      tx.report.create.mock.calls[0] as unknown as [
        { data: { dataJson: string; units: { create: Array<Record<string, unknown>> } } },
      ]
    )[0];
    expect(JSON.parse(reportCreate.data.dataJson)).toMatchObject({
      status: "GODKJENT",
    });
    expect(reportCreate.data.units.create[0]).toMatchObject({ status: "GODKJENT" });
  });

  it("oppretter ikke et nytt utbedringsoppdrag ved ny innsending av samme avvik", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      legalHold: false,
      technicianSignatureUrl: null,
      technicianName: "Kari",
      customerSignatureUrl: null,
      customerName: null,
    });
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () => revisionSource()),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
        workOrder: {
          findUnique: vi.fn(async () => ({ id: "wo-rem" })),
          create: vi.fn(async () => ({ id: "wo-rem" })),
        },
      }),
    );
    const data = formData();
    data.set("status__unit-0", "AVVIK");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: true,
      returnTo: "/oppdrag/wo1",
      remediationWorkOrderId: "wo-rem",
    });
    expect(tx.workOrder.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "WorkOrder",
        entityId: "wo1",
        metadata: expect.objectContaining({
          reportId: "r1",
          remediationWorkOrderId: "wo-rem",
        }),
      }),
    });
  });

  it("ruller tilbake både rapport og utbedringsoppdrag når revisjonsloggen feiler", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);

    let committedReport: string | null = null;
    let committedRemediation: string | null = null;
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => {
        let pendingReport: string | null = null;
        let pendingRemediation: string | null = null;
        const tx = txClient({
          report: {
            findUnique: vi.fn(async () => null),
            updateMany: vi.fn(async () => ({ count: 1 })),
            update: vi.fn(async () => ({})),
            create: vi.fn(async () => {
              pendingReport = "r1";
              return { id: "r1" };
            }),
          },
          workOrder: {
            findUnique: vi.fn(async () => null),
            create: vi.fn(async () => {
              pendingRemediation = "wo-rem";
              return { id: "wo-rem" };
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
          committedReport = pendingReport;
          committedRemediation = pendingRemediation;
          return result;
        } catch (error) {
          pendingReport = null;
          pendingRemediation = null;
          throw error;
        }
      },
    );
    const data = formData();
    data.set("status__unit-0", "AVVIK");

    await expect(submitReport(actor(), data)).rejects.toThrow("audit feilet");
    expect(committedReport).toBeNull();
    expect(committedRemediation).toBeNull();
  });
});

describe("getReportPdfForViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrRenderReportPdf.mockResolvedValue({
      buffer: Buffer.from("%PDF"),
      fileName: "kunde-servicerapport",
    });
  });

  it("avviser CUSTOMER uten customerId selv om oppdraget mangler kunde", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: null,
      status: "OPEN",
      reports: [{ id: "r1", isLocked: true }],
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
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "CUSTOMER", customerId: "kunde-1" }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.getOrRenderReportPdf).not.toHaveBeenCalled();
  });

  it("avviser CUSTOMER når kunden er mykt slettet", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      status: "OPEN",
      customer: { deletedAt: new Date() },
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "CUSTOMER", customerId: "kunde-1" }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.getOrRenderReportPdf).not.toHaveBeenCalled();
  });

  it("lar CUSTOMER hente egen rapport når kunden er aktiv", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      status: "OPEN",
      customer: { deletedAt: null },
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "CUSTOMER", customerId: "kunde-1" }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("avviser CUSTOMER som henter en opplåst rapport med kjent URL", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      status: "OPEN",
      customer: { deletedAt: null },
      reports: [{ id: "r1", isLocked: false }],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "CUSTOMER", customerId: "kunde-1" }),
      "wo1",
      "r1",
    );

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mocks.getOrRenderReportPdf).not.toHaveBeenCalled();
  });

  it("avviser CUSTOMER når den kombinerte PDF-en inneholder en opplåst rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      status: "OPEN",
      customer: { deletedAt: null },
      reports: [
        { id: "r1", isLocked: true },
        { id: "r2", isLocked: false },
      ],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "CUSTOMER", customerId: "kunde-1" }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mocks.getOrRenderReportPdf).not.toHaveBeenCalled();
  });

  it("lar ansatte hente en opplåst rapport i egen avdeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-a",
      department: { isActive: true },
      status: "OPEN",
      customer: { deletedAt: null },
      reports: [{ id: "r1", isLocked: false }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1", "r1");

    expect(result).toMatchObject({ ok: true });
  });

  it("avviser ansatt uten reports.viewAllDepartments i en annen avdeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      department: { isActive: true },
      status: "OPEN",
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1");

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.getOrRenderReportPdf).not.toHaveBeenCalled();
  });

  it("lar ansatt med reports.viewAllDepartments hente rapport fra en annen avdeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      department: { isActive: true },
      status: "OPEN",
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(
      actor({
        roleDefinition: {
          permissions: ["reports.view", "reports.viewAllDepartments"],
        },
      }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: true });
    expect(mocks.getOrRenderReportPdf).toHaveBeenCalledWith("wo1", undefined);
  });

  it("lar administrator hente rapport fra en annen avdeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      department: { isActive: true },
      status: "OPEN",
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(
      actor({ role: "ADMIN", roleDefinition: null }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("avviser rapport i en deaktivert avdeling", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-a",
      department: { isActive: false },
      status: "OPEN",
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1");

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.getOrRenderReportPdf).not.toHaveBeenCalled();
  });

  it("slår bare opp ikke-slettede oppdrag og rapporter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-b",
      status: "OPEN",
      reports: [{ id: "r1", isLocked: true }],
    });

    await getReportPdfForViewer(actor(), "wo1");

    expect(mocks.prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wo1", deletedAt: null },
        select: expect.objectContaining({
          reports: expect.objectContaining({ where: { deletedAt: null } }),
        }),
      }),
    );
  });

  it("avviser ansatt uten reports.view", async () => {
    const result = await getReportPdfForViewer(
      actor({ permissionsCustomized: true, permissions: [] }),
      "wo1",
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
  });

  it("avviser montør på et kansellert oppdrag", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-a",
      department: { isActive: true },
      status: "CANCELLED",
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1");

    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("rendrer bare den valgte rapporten når den tilhører oppdraget", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-a",
      department: { isActive: true },
      status: "OPEN",
      reports: [
        { id: "r1", isLocked: true },
        { id: "r2", isLocked: true },
      ],
    });

    const result = await getReportPdfForViewer(actor(), "wo1", "r2");

    expect(result).toMatchObject({ ok: true });
    expect(mocks.getOrRenderReportPdf).toHaveBeenCalledWith(
      "wo1",
      undefined,
      "r2",
    );
  });

  it("avviser en rapport-id som ikke tilhører oppdraget", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      customerId: "kunde-1",
      departmentId: "dep-a",
      department: { isActive: true },
      status: "OPEN",
      reports: [{ id: "r1", isLocked: true }],
    });

    const result = await getReportPdfForViewer(actor(), "wo1", "fremmed");

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(mocks.getOrRenderReportPdf).not.toHaveBeenCalled();
  });
});

describe("betingede felt og bevaringsplikt", () => {
  const conditionalTemplate = {
    id: "tpl1",
    title: "Betinget sjekkliste",
    fieldsJson: JSON.stringify([
      {
        id: "f1",
        type: "SELECT",
        label: "Avvik?",
        required: false,
        options: ["Ja", "Nei"],
      },
      {
        id: "f2",
        type: "TEXT",
        label: "Beskriv avviket",
        required: true,
        conditionalFieldId: "f1",
        conditionalValue: "Ja",
      },
    ]),
  };

  function conditionalWorkOrder(overrides: Record<string, unknown> = {}) {
    return {
      ...workOrder(),
      templates: [conditionalTemplate],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyWorkOrderEvent.mockResolvedValue(1);
  });

  it("ignorerer påkrevde felt som er skjult av en betingelse", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(conditionalWorkOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    withTransaction();

    const data = formData();
    data.set("answer__unit-0__f1", "Nei");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
  });

  it("krever synlige betingede felt", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(conditionalWorkOrder());
    mocks.prisma.report.findUnique.mockResolvedValue(null);

    const data = formData();
    data.set("answer__unit-0__f1", "Ja");

    const result = await submitReport(actor(), data);

    expect(result).toMatchObject({ ok: false, error: "ugyldig-data" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser innsending når oppdraget har bevaringsplikt, også uten rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(
      conditionalWorkOrder({ legalHold: true }),
    );
    mocks.prisma.report.findUnique.mockResolvedValue(null);

    const result = await submitReport(actor(), formData());

    expect(result).toMatchObject({ ok: false, error: "legal-hold" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser kladd når oppdraget har bevaringsplikt, også uten rapport", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(
      conditionalWorkOrder({ legalHold: true }),
    );
    mocks.prisma.report.findUnique.mockResolvedValue(null);

    const result = await saveDraft(actor(), formData());

    expect(result).toEqual({ ok: false });
    expect(mocks.prisma.reportDraft.upsert).not.toHaveBeenCalled();
  });
});

describe("signaturnavn", () => {
  function workOrderWithSigners() {
    return {
      ...workOrder(),
      contact: { name: "Kontakt Person" },
      technicians: [{ name: "Ola Tekniker" }],
      customer: {
        name: "Kunde AS",
        contacts: [{ name: "Annen Kontakt" }],
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeDataImage.mockResolvedValue("/uploads/signatur.png");
    mocks.deleteUploadIfOwned.mockResolvedValue(undefined);
    mocks.notifyWorkOrderEvent.mockResolvedValue(1);
    mocks.prisma.report.findUnique.mockResolvedValue(null);
  });

  it("godtar kundens kontaktperson som kundenavn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrderWithSigners());
    const tx = withTransaction();
    const data = formData();
    data.set("customerName", "  kontakt person ");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerName: "kontakt person" }),
      select: { id: true },
    });
  });

  it("godtar en annen kontaktperson hos kunden", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrderWithSigners());
    withTransaction();
    const data = formData();
    data.set("customerName", "ANNEN KONTAKT");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
  });

  it("godtar kundens firmanavn som kundenavn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrderWithSigners());
    withTransaction();
    const data = formData();
    data.set("customerName", "Kunde AS");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
  });

  it("avviser ukjent kundenavn når kunden har kontakter", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrderWithSigners());
    const data = formData();
    data.set("customerName", "Ukjent Person");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-signaturnavn",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("godtar innlogget bruker eller tildelt tekniker som teknikernavn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrderWithSigners());
    withTransaction();

    const byActor = formData();
    byActor.set("technicianName", " kari ");
    expect(await submitReport(actor(), byActor)).toEqual({
      ok: true,
      returnTo: "/oppdrag/wo1",
    });

    const byAssigned = formData();
    byAssigned.set("technicianName", "OLA TEKNIKER");
    expect(await submitReport(actor(), byAssigned)).toEqual({
      ok: true,
      returnTo: "/oppdrag/wo1",
    });
  });

  it("avviser ukjent teknikernavn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrderWithSigners());
    const data = formData();
    data.set("technicianName", "Ukjent Tekniker");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({
      ok: false,
      error: "ugyldig-signaturnavn",
      returnTo: "/oppdrag/wo1",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("godtar samme person som både tekniker og kunde", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      contact: { name: "Ola Tekniker" },
      technicians: [{ name: "Ola Tekniker" }],
      customer: { name: "Kunde AS", contacts: [] },
    });
    withTransaction();
    const data = formData();
    data.set("technicianName", "Ola Tekniker");
    data.set("customerName", "Ola Tekniker");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
  });

  it("tillater fritt kundenavn når oppdraget mangler kontakter og kundenavn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue({
      ...workOrder(),
      contact: null,
      technicians: [],
      customer: null,
    });
    withTransaction();
    const data = formData();
    data.set("technicianName", "Kari");
    data.set("customerName", "Vilkårlig Navn");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
  });

  it("beholder lagrede navn når skjemaet ikke sender navn", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrder());
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: "r1",
      isLocked: false,
      legalHold: false,
      technicianSignatureUrl: null,
      technicianName: "Gammel Tekniker",
      customerSignatureUrl: null,
      customerName: "Gammel Kunde",
    });
    const tx = withTransaction(
      txClient({
        report: {
          findUnique: vi.fn(async () =>
            revisionSource({
              technicianName: "Gammel Tekniker",
              customerName: "Gammel Kunde",
            }),
          ),
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async () => ({})),
          create: vi.fn(async () => ({ id: "r1" })),
        },
      }),
    );
    const data = formData();
    data.set("technicianName", "");
    data.set("customerName", "");

    const result = await submitReport(actor(), data);

    expect(result).toEqual({ ok: true, returnTo: "/oppdrag/wo1" });
    expect(tx.report.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({
        technicianName: "Gammel Tekniker",
        customerName: "Gammel Kunde",
      }),
    });
  });

  it("validerer ikke signaturnavn ved kladdelagring", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(workOrderWithSigners());
    mocks.prisma.reportDraft.findUnique.mockResolvedValue(null);
    mocks.prisma.reportDraft.upsert.mockResolvedValue({});
    const data = formData();
    data.set("technicianName", "Ukjent Tekniker");
    data.set("customerName", "Ukjent Kunde");

    const result = await saveDraft(actor(), data);

    expect(result.ok).toBe(true);
    expect(mocks.prisma.reportDraft.upsert).toHaveBeenCalled();
  });
});
