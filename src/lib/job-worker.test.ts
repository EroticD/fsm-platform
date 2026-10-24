import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    document: { findUnique: vi.fn(), update: vi.fn() },
    documentJob: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    reportDraft: { findMany: vi.fn(), deleteMany: vi.fn() },
    upload: { findUnique: vi.fn(), delete: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/pdf-text", () => ({
  extractPdfText: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { unlink: vi.fn() },
}));

vi.mock("@/lib/uploads", () => ({ uploadDir: () => "/tmp/uploads" }));

import prisma from "@/lib/prisma";
import { extractPdfText } from "@/lib/pdf-text";
import fs from "node:fs/promises";
import {
  claimNextPdfTextJob,
  cleanupExpiredDrafts,
  DRAFT_TTL_MS,
  enqueuePdfText,
  MAX_JOB_ATTEMPTS,
  pdfJobBackoffMs,
  processPdfTextJob,
  type PdfTextJob,
} from "./job-worker";

const mocked = prisma as unknown as {
  document: { findUnique: Mock; update: Mock };
  documentJob: { findFirst: Mock; create: Mock; update: Mock };
  reportDraft: { findMany: Mock; deleteMany: Mock };
  upload: { findUnique: Mock; delete: Mock };
  $queryRaw: Mock;
};
const mockedUnlink = vi.mocked(fs.unlink);
const mockedExtract = vi.mocked(extractPdfText);

function job(overrides: Partial<PdfTextJob> = {}): PdfTextJob {
  return {
    id: "job-1",
    documentId: "doc-1",
    type: "PDF_TEXT",
    status: "RUNNING",
    attempts: 1,
    runAt: new Date(),
    lockedAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("pdfJobBackoffMs", () => {
  it("dobler pausen for hvert forsøk", () => {
    expect(pdfJobBackoffMs(1)).toBe(30_000);
    expect(pdfJobBackoffMs(2)).toBe(60_000);
    expect(pdfJobBackoffMs(3)).toBe(120_000);
  });
});

describe("claimNextPdfTextJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bruker SKIP LOCKED slik at flere prosesser kan dele køen", async () => {
    mocked.$queryRaw.mockResolvedValue([job()]);

    const claimed = await claimNextPdfTextJob();

    expect(claimed?.id).toBe("job-1");
    const sql = (mocked.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("RUNNING");
    expect(sql).toContain(`"attempts" + 1`);
  });

  it("returnerer null når køen er tom", async () => {
    mocked.$queryRaw.mockResolvedValue([]);
    expect(await claimNextPdfTextJob()).toBeNull();
  });
});

describe("enqueuePdfText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lager en vedvarende jobb", async () => {
    mocked.documentJob.findFirst.mockResolvedValue(null);
    mocked.documentJob.create.mockResolvedValue({ id: "job-2" });

    const created = await enqueuePdfText("doc-1", "/uploads/a.pdf");

    expect(created).toEqual({ id: "job-2" });
    expect(mocked.documentJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { documentId: "doc-1", type: "PDF_TEXT" } }),
    );
  });

  it("lager ikke en ny jobb når dokumentet allerede venter", async () => {
    mocked.documentJob.findFirst.mockResolvedValue({ id: "job-existing" });

    expect(await enqueuePdfText("doc-1")).toEqual({ id: "job-existing" });
    expect(mocked.documentJob.create).not.toHaveBeenCalled();
  });

  it("svelger databasefeil slik at opplastingen ikke feiler", async () => {
    mocked.documentJob.findFirst.mockRejectedValue(new Error("db nede"));

    await expect(enqueuePdfText("doc-1")).resolves.toBeNull();
  });
});

describe("processPdfTextJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.document.findUnique.mockResolvedValue({
      id: "doc-1",
      filePath: "/uploads/a.pdf",
    });
    mocked.document.update.mockResolvedValue({});
    mocked.documentJob.update.mockResolvedValue({});
  });

  it("lagrer tekst og markerer jobben som ferdig", async () => {
    const pages = [{ page: 1, text: "Hei" }];
    mockedExtract.mockResolvedValue({ text: "Hei", pages });

    const outcome = await processPdfTextJob(job({ attempts: 1 }));

    expect(outcome).toBe("done");
    expect(mockedExtract).toHaveBeenCalledWith("/uploads/a.pdf");
    expect(mocked.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { contentText: "Hei", pageTexts: JSON.stringify(pages) },
    });
    expect(mocked.documentJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "DONE", lockedAt: null, lastError: null },
    });
  });

  it("legger jobben tilbake med eksponentiell pause etter første feil", async () => {
    mockedExtract.mockRejectedValue(new Error("pdftotext feilet"));

    const before = Date.now();
    const outcome = await processPdfTextJob(job({ attempts: 1 }));
    const after = Date.now();

    expect(outcome).toBe("retry");

    const update = mocked.documentJob.update.mock.calls[0][0] as {
      data: { status: string; runAt: Date; lastError: string };
    };
    expect(update.data.status).toBe("PENDING");
    expect(update.data.lastError).toContain("pdftotext feilet");
    const delay = update.data.runAt.getTime();
    expect(delay).toBeGreaterThanOrEqual(before + 30_000);
    expect(delay).toBeLessThanOrEqual(after + 30_000);
  });

  it("gir opp og markerer jobben FAILED etter maks antall forsøk", async () => {
    mockedExtract.mockRejectedValue(new Error("OCR feilet"));

    const outcome = await processPdfTextJob(job({ attempts: MAX_JOB_ATTEMPTS }));

    expect(outcome).toBe("failed");
    expect(mocked.documentJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "FAILED",
        lockedAt: null,
        lastError: "OCR feilet",
      },
    });
    expect(mocked.document.update).not.toHaveBeenCalled();
  });

  it("markerer jobben som feilet når dokumentet er slettet", async () => {
    mocked.document.findUnique.mockResolvedValue(null);

    const outcome = await processPdfTextJob(job({ attempts: MAX_JOB_ATTEMPTS }));

    expect(outcome).toBe("failed");
    expect(mockedExtract).not.toHaveBeenCalled();
  });
});

describe("cleanupExpiredDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.reportDraft.deleteMany.mockResolvedValue({ count: 1 });
    mocked.upload.findUnique.mockResolvedValue(null);
    mocked.upload.delete.mockResolvedValue({});
    mockedUnlink.mockResolvedValue(undefined);
  });

  it("sletter utløpte kladder og frigjør en signatur som fortsatt eies av brukeren", async () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    mocked.reportDraft.findMany.mockResolvedValue([
      {
        id: "draft-1",
        userId: "u1",
        dataJson: JSON.stringify({
          technicianSignatureUrl: "/uploads/sig.png",
          customerSignatureUrl: null,
        }),
      },
    ]);
    mocked.upload.findUnique.mockResolvedValue({
      storedName: "sig.png",
      ownerType: "USER",
      ownerId: "u1",
    });

    const deleted = await cleanupExpiredDrafts(now);

    expect(deleted).toBe(1);
    const cutoff = new Date(now.getTime() - DRAFT_TTL_MS);
    expect(mocked.reportDraft.findMany).toHaveBeenCalledWith({
      where: { updatedAt: { lt: cutoff } },
      select: { id: true, userId: true, dataJson: true },
    });
    expect(mocked.reportDraft.deleteMany).toHaveBeenCalledWith({
      where: { id: "draft-1", updatedAt: { lt: cutoff } },
    });
    expect(mocked.upload.delete).toHaveBeenCalledWith({ where: { storedName: "sig.png" } });
    expect(mockedUnlink).toHaveBeenCalledWith("/tmp/uploads/sig.png");
  });

  it("sletter ikke en signatur som allerede er tatt over av en rapport", async () => {
    mocked.reportDraft.findMany.mockResolvedValue([
      {
        id: "draft-1",
        userId: "u1",
        dataJson: JSON.stringify({ customerSignatureUrl: "/uploads/signert.png" }),
      },
    ]);
    mocked.upload.findUnique.mockResolvedValue({
      storedName: "signert.png",
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
    });

    const deleted = await cleanupExpiredDrafts();

    expect(deleted).toBe(1);
    expect(mocked.reportDraft.deleteMany).toHaveBeenCalled();
    expect(mocked.upload.delete).not.toHaveBeenCalled();
    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it("sletter ikke en kladd som ble oppdatert etter utløpet", async () => {
    mocked.reportDraft.findMany.mockResolvedValue([
      { id: "draft-1", userId: "u1", dataJson: JSON.stringify({}) },
    ]);
    mocked.reportDraft.deleteMany.mockResolvedValue({ count: 0 });

    const deleted = await cleanupExpiredDrafts();

    expect(deleted).toBe(0);
    expect(mocked.upload.findUnique).not.toHaveBeenCalled();
  });
});
