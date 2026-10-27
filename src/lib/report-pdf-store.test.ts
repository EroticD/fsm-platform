import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: { findFirst: vi.fn() },
    upload: { create: vi.fn() },
    report: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/report-pdf", () => ({
  loadReportPdf: vi.fn(),
  reportFileNameForWorkOrder: vi.fn(() => "kunde-servicerapport-2026-01-01"),
}));

const releaseUploadMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/upload-cleanup", () => ({
  releaseUpload: releaseUploadMock,
}));

vi.mock("node:fs/promises", () => {
  const api = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  };
  return { ...api, default: api };
});

import fs from "node:fs/promises";
import prisma from "@/lib/prisma";
import { loadReportPdf } from "@/lib/report-pdf";
import {
  computeReportPdfHash,
  computeReportPdfHashForReports,
  getOrRenderReportPdf,
  type ReportPdfHashInput,
} from "./report-pdf-store";

const mocked = prisma as unknown as {
  workOrder: { findFirst: Mock };
  upload: { create: Mock };
  report: { update: Mock };
  $transaction: Mock;
};
const mockedReadFile = vi.mocked(fs.readFile);
const mockedWriteFile = vi.mocked(fs.writeFile);
const mockedLoadReportPdf = vi.mocked(loadReportPdf);

function report(overrides: Partial<ReportPdfHashInput> = {}): ReportPdfHashInput {
  return {
    id: "report-1",
    updatedAt: new Date("2026-01-01T10:00:00.000Z"),
    comments: "Alt i orden",
    technicianSignatureUrl: "/uploads/tekniker.png",
    customerSignatureUrl: "/uploads/kunde.png",
    templateId: "template-1",
    name: "Egen rapport",
    requiresUnits: true,
    templateSnapshotJson: '{"title":"Sjekkliste"}',
    units: [
      {
        id: "unit-1",
        label: "Pumpe",
        status: "GODKJENT",
        answersJson: '{"trykk":"ok"}',
        comment: null,
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

describe("pdfHash", () => {
  it("er stabil for samme innhold", () => {
    expect(computeReportPdfHash(report())).toBe(computeReportPdfHash(report()));
    expect(computeReportPdfHashForReports([report()])).toBe(
      computeReportPdfHashForReports([report()]),
    );
  });

  it("endres når kommentar, signatur eller antall enheter endres", () => {
    const base = computeReportPdfHash(report());

    expect(computeReportPdfHash(report({ comments: "Ny kommentar" }))).not.toBe(base);
    expect(
      computeReportPdfHash(report({ customerSignatureUrl: null })),
    ).not.toBe(base);
    expect(
      computeReportPdfHash(report({ units: [] })),
    ).not.toBe(base);
  });

  it("endres når rapportnavn eller enhetsvalg endres", () => {
    const base = computeReportPdfHash(report());

    expect(computeReportPdfHash(report({ name: "Nytt navn" }))).not.toBe(base);
    expect(computeReportPdfHash(report({ requiresUnits: false }))).not.toBe(base);
    expect(computeReportPdfHash(report({ name: null }))).not.toBe(base);
  });

  it("tar med alle rapportene når PDF-en består av flere", () => {
    const first = report();
    const second = report({ id: "report-2" });

    expect(computeReportPdfHashForReports([first])).not.toBe(
      computeReportPdfHashForReports([first, second]),
    );
  });
});

describe("getOrRenderReportPdf", () => {
  const pdfHash = computeReportPdfHashForReports([report()]);

  function workOrderWithCache(cachedHash: string | null) {
    return {
      id: "wo-1",
      departmentId: "dept-1",
      customerId: "cust-1",
      customer: { name: "Kunde AS" },
      scheduledFor: new Date("2026-01-01T00:00:00.000Z"),
      reports: [
        {
          ...report(),
          pdfUrl: cachedHash ? "/uploads/cache.pdf" : null,
          pdfHash: cachedHash,
        },
      ],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    releaseUploadMock.mockResolvedValue(true);
    mockedReadFile.mockResolvedValue(Buffer.from("%PDF-cached"));
    mockedWriteFile.mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    mocked.$transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    mocked.upload.create.mockResolvedValue({});
    mocked.report.update.mockResolvedValue({});
  });

  it("leser mellomlagret PDF uten å rendre på nytt", async () => {
    mocked.workOrder.findFirst.mockResolvedValue(workOrderWithCache(pdfHash));

    const result = await getOrRenderReportPdf("wo-1");

    expect(result?.buffer.toString()).toBe("%PDF-cached");
    expect(result?.url).toBe("/uploads/cache.pdf");
    expect(mockedLoadReportPdf).not.toHaveBeenCalled();
  });

  it("henter bare ikke-slettede rapporter på ikke-slettede oppdrag", async () => {
    mocked.workOrder.findFirst.mockResolvedValue(workOrderWithCache(pdfHash));

    await getOrRenderReportPdf("wo-1");

    expect(mocked.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wo-1", deletedAt: null },
        include: expect.objectContaining({
          reports: expect.objectContaining({
            where: { deletedAt: null },
          }),
        }),
      }),
    );
  });

  it("lager ingen PDF for et slettet oppdrag", async () => {
    mocked.workOrder.findFirst.mockResolvedValue(null);

    const result = await getOrRenderReportPdf("wo-1");

    expect(result).toBeNull();
    expect(mockedLoadReportPdf).not.toHaveBeenCalled();
  });

  it("lager ingen PDF når alle rapportene på oppdraget er slettet", async () => {
    mocked.workOrder.findFirst.mockResolvedValue({
      ...workOrderWithCache(null),
      reports: [],
    });

    const result = await getOrRenderReportPdf("wo-1");

    expect(result).toBeNull();
    expect(mockedLoadReportPdf).not.toHaveBeenCalled();
  });

  it("rendrer, lagrer og registrerer PDF når hashen er ukjent", async () => {
    mocked.workOrder.findFirst.mockResolvedValue(workOrderWithCache(null));
    mockedLoadReportPdf.mockResolvedValue({
      buffer: Buffer.from("%PDF-new"),
      fileName: "kunde-servicerapport",
    });

    const result = await getOrRenderReportPdf("wo-1");

    expect(mockedLoadReportPdf.mock.calls[0][0]).toBe("wo-1");
    expect(result?.buffer.toString()).toBe("%PDF-new");
    expect(result?.url).toMatch(/^\/uploads\/[0-9a-f-]+\.pdf$/);

    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    expect(mocked.upload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerType: "WORK_ORDER",
          ownerId: "wo-1",
          departmentId: "dept-1",
          customerId: "cust-1",
          mimeType: "application/pdf",
        }),
      }),
    );
    expect(mocked.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "report-1" },
        data: expect.objectContaining({
          pdfHash,
          pdfUrl: result?.url,
        }),
      }),
    );
  });

  it("rendrer på nytt når den mellomlagrede filen er borte", async () => {
    mocked.workOrder.findFirst.mockResolvedValue(workOrderWithCache(pdfHash));
    mockedReadFile.mockRejectedValue(new Error("ENOENT"));
    mockedLoadReportPdf.mockResolvedValue({
      buffer: Buffer.from("%PDF-new"),
      fileName: "kunde-servicerapport",
    });

    const result = await getOrRenderReportPdf("wo-1");

    expect(mockedLoadReportPdf).toHaveBeenCalledTimes(1);
    expect(result?.buffer.toString()).toBe("%PDF-new");
    // Den gamle, nå urefererte PDF-cachen frigjøres etter at den nye er lagret.
    expect(releaseUploadMock).toHaveBeenCalledWith("/uploads/cache.pdf");
  });

  it("sletter filen når registreringen i databasen feiler", async () => {
    mocked.workOrder.findFirst.mockResolvedValue(workOrderWithCache(null));
    mockedLoadReportPdf.mockResolvedValue({
      buffer: Buffer.from("%PDF-new"),
      fileName: "kunde-servicerapport",
    });
    mocked.$transaction.mockRejectedValue(new Error("databasen feilet"));

    const result = await getOrRenderReportPdf("wo-1");

    // PDF-en returneres fortsatt til brukeren, men uten url.
    expect(result?.buffer.toString()).toBe("%PDF-new");
    expect(result?.url).toBeUndefined();
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });
});
