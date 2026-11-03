import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFParse } from "pdf-parse";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  branding: { findFirst: vi.fn() },
  upload: { findMany: vi.fn(), findUnique: vi.fn() },
  workOrder: { findFirst: vi.fn(), findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import {
  loadReportPdf,
  renderReportPdf,
  renderReportRevisionPdf,
  reportFileNameForWorkOrder,
  reportRevisionFileName,
  safeReportFileName,
} from "./report-pdf";

const workOrder = {
  customer: { name: "Kunde AS" },
  scheduledFor: new Date("2026-01-02T00:00:00.000Z"),
  orderNumber: "ORD-42",
};

describe("reportFileNameForWorkOrder", () => {
  it("bruker rapportnavn og ordrenummer i filnavnet", () => {
    expect(reportFileNameForWorkOrder(workOrder, "Egen rapport")).toBe(
      "Kunde-AS-Egen-rapport-ORD-42-2026-01-02",
    );
  });

  it("faller tilbake til servicerapport når rapporten mangler navn", () => {
    expect(reportFileNameForWorkOrder(workOrder, null)).toContain(
      "servicerapport",
    );
  });

  it("lager et trygt filnavn også med norske tegn", () => {
    expect(safeReportFileName("Årsrapport for Øst – 2026")).toBe(
      "arsrapport-for-ost-2026",
    );
  });
});

describe("reportRevisionFileName", () => {
  it("merker revisjonen med nummer og rapportnavn", () => {
    expect(
      reportRevisionFileName(workOrder, {
        revision: 3,
        name: "Egen rapport",
        templateTitle: null,
      }),
    ).toBe("Kunde-AS-Egen-rapport-ORD-42-2026-01-02-revisjon-3");
  });
});

function countImageXObjects(buffer: Buffer): number {
  return (buffer.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;
}

function countPages(buffer: Buffer): number {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe("renderReportPdf – bilder og signaturer", () => {
  let uploadDirPath = "";
  const storedFiles = {
    photo: "11111111-1111-4111-8111-111111111111.jpg",
    technician: "22222222-2222-4222-8222-222222222222.png",
    customer: "33333333-3333-4333-8333-333333333333.png",
  };

  const uploadRows = [
    {
      storedName: storedFiles.photo,
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dep1",
      customerId: "cust1",
      uploadedById: "user1",
    },
    {
      storedName: storedFiles.technician,
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dep1",
      customerId: "cust1",
      uploadedById: "user1",
    },
    {
      storedName: storedFiles.customer,
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dep1",
      customerId: "cust1",
      uploadedById: "user1",
    },
  ];

  const fieldsJson = JSON.stringify([
    { id: "f1", type: "IMAGE", label: "Bilder" },
  ]);

  const report = {
    id: "report-1",
    templateId: null,
    templateTitle: "Servicerapport",
    name: "Servicerapport",
    requiresUnits: false,
    templateSnapshotJson: fieldsJson,
    dataJson: JSON.stringify({
      status: "UTEN_ENHET",
      answers: { f1: JSON.stringify([`/uploads/${storedFiles.photo}`]) },
    }),
    comments: null,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    units: [],
    technicianSignatureUrl: `/uploads/${storedFiles.technician}`,
    technicianName: "Tekniker",
    customerSignatureUrl: `/uploads/${storedFiles.customer}`,
    customerName: "Kunde",
  };

  const workOrder = {
    id: "wo1",
    departmentId: "dep1",
    customerId: "cust1",
    title: "Serviceoppdrag",
    orderNumber: "ORD-42",
    status: "OPEN",
    scheduledFor: new Date("2026-01-02T00:00:00.000Z"),
    customer: { name: "Kunde AS" },
    templates: [],
    technicians: [],
    reports: [report],
  };

  beforeAll(async () => {
    uploadDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-pdf-images-"));
    process.env.UPLOAD_DIR = uploadDirPath;
    await fs.writeFile(
      path.join(uploadDirPath, storedFiles.photo),
      await sharp({
        create: { width: 640, height: 480, channels: 3, background: "#22c55e" },
      }).jpeg().toBuffer(),
    );
    await fs.writeFile(
      path.join(uploadDirPath, storedFiles.technician),
      await sharp({
        create: { width: 300, height: 100, channels: 4, background: "#ffffff" },
      }).png().toBuffer(),
    );
    await fs.writeFile(
      path.join(uploadDirPath, storedFiles.customer),
      await sharp({
        create: { width: 320, height: 110, channels: 4, background: "#f8fafc" },
      }).png().toBuffer(),
    );
  });

  afterAll(async () => {
    delete process.env.UPLOAD_DIR;
    if (uploadDirPath) await fs.rm(uploadDirPath, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.branding.findFirst.mockResolvedValue(null);
    db.upload.findMany.mockResolvedValue(uploadRows);
    db.upload.findUnique.mockResolvedValue(null);
    db.workOrder.findUnique.mockResolvedValue({
      departmentId: "dep1",
      customerId: "cust1",
    });
    db.workOrder.findFirst.mockResolvedValue(workOrder);
  });

  it("bygger inn bilder og begge signaturer gjennom loadReportPdf", async () => {
    const pdf = await loadReportPdf("wo1", "https://fsm.example");

    expect(pdf).not.toBeNull();
    const buffer = pdf!.buffer;
    // Fotoet brukes både som miniatyr og vedleggsside; de to signaturene er
    // egne bilder. Minst tre bildeobjekter skal ligge i PDF-en, og det skal
    // ikke dupliseres ett objekt per visning.
    expect(countImageXObjects(buffer)).toBeGreaterThanOrEqual(3);
    expect(countImageXObjects(buffer)).toBeLessThanOrEqual(4);
    expect(buffer.length).toBeLessThan(5_000_000);
    expect(countPages(buffer)).toBeGreaterThanOrEqual(2);
    expect(db.workOrder.findFirst).toHaveBeenCalled();
    expect(db.upload.findMany).toHaveBeenCalled();
  });

  it("bygger inn bilder når datasettet er pakket som { workOrder, reports }", async () => {
    const buffer = await renderReportPdf(
      {
        workOrder: { id: "wo1", title: "Serviceoppdrag", customer: { name: "Kunde AS" } },
        reports: [report],
      },
      "https://fsm.example",
    );

    expect(countImageXObjects(buffer)).toBeGreaterThanOrEqual(3);
    // Avdeling/kunde hentes når revisjonsdatasettet bare har oppdrags-id.
    expect(db.workOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "wo1" } }),
    );
  });

  it("rendrer en data-URL-signatur uten opplastingsrad", async () => {
    const dataUrl =
      "data:image/png;base64," +
      (
        await sharp({
          create: { width: 300, height: 100, channels: 4, background: "#ffffff" },
        }).png().toBuffer()
      ).toString("base64");

    db.upload.findMany.mockResolvedValue([uploadRows[0]]);
    const buffer = await renderReportPdf(
      {
        ...workOrder,
        reports: [
          {
            ...report,
            technicianSignatureUrl: dataUrl,
            customerSignatureUrl: null,
          },
        ],
      },
      "https://fsm.example",
    );

    expect(countImageXObjects(buffer)).toBeGreaterThanOrEqual(2);
  });

  it("varsler i PDF-en når et forventet bilde mangler", async () => {
    db.upload.findMany.mockResolvedValue([]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const buffer = await renderReportPdf(workOrder, "https://fsm.example");
      const parser = new PDFParse({ data: buffer });
      try {
        const { text } = await parser.getText();
        expect(text).toContain("Advarsel: 3 bilder");
      } finally {
        await parser.destroy();
      }

      expect(consoleError).toHaveBeenCalledWith(
        "report_pdf_images_missing",
        expect.objectContaining({ code: "report_pdf_images_missing", count: 3 }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("bygger inn bilder og signaturer i revisjons-PDF-en", async () => {
    const pdf = await renderReportRevisionPdf(
      { id: "wo1", title: "Serviceoppdrag", customer: { name: "Kunde AS" } },
      {
        id: "revision-1",
        revision: 1,
        dataJson: JSON.stringify({ status: "GODKJENT" }),
        unitsJson: JSON.stringify([
          {
            id: "unit-1",
            label: "Pumpe",
            serialNumber: "SN-1",
            location: "Kjeller",
            status: "GODKJENT",
            answersJson: JSON.stringify({
              f1: JSON.stringify([`/uploads/${storedFiles.photo}`]),
            }),
            comment: null,
            sortOrder: 0,
          },
        ]),
        templateSnapshotJson: fieldsJson,
        requiresUnits: true,
        technicianSignatureUrl: `/uploads/${storedFiles.technician}`,
        technicianName: "Tekniker",
        customerSignatureUrl: `/uploads/${storedFiles.customer}`,
        customerName: "Kunde",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    );

    expect(countImageXObjects(pdf.buffer)).toBeGreaterThanOrEqual(3);
    expect(countPages(pdf.buffer)).toBeGreaterThanOrEqual(2);
  });
});
