import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    attachment: { findFirst: vi.fn() },
    customerAttachment: { findFirst: vi.fn() },
    document: { findFirst: vi.fn() },
    documentVersion: { findFirst: vi.fn() },
    report: { findFirst: vi.fn() },
    reportUnit: { findFirst: vi.fn() },
    reportRevision: { findFirst: vi.fn() },
    reportDraft: { findFirst: vi.fn() },
    upload: { deleteMany: vi.fn(), findMany: vi.fn() },
  },
  unlink: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("node:fs/promises", () => ({ default: { unlink: mocks.unlink } }));
vi.mock("@/lib/uploads", () => ({ uploadDir: () => "/tmp/uploads" }));

import { cleanupAbandonedUploads, releaseUpload } from "./upload-cleanup";

function noReferences() {
  mocks.prisma.attachment.findFirst.mockResolvedValue(null);
  mocks.prisma.customerAttachment.findFirst.mockResolvedValue(null);
  mocks.prisma.document.findFirst.mockResolvedValue(null);
  mocks.prisma.documentVersion.findFirst.mockResolvedValue(null);
  mocks.prisma.report.findFirst.mockResolvedValue(null);
  mocks.prisma.reportUnit.findFirst.mockResolvedValue(null);
  mocks.prisma.reportRevision.findFirst.mockResolvedValue(null);
  mocks.prisma.reportDraft.findFirst.mockResolvedValue(null);
}

describe("releaseUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noReferences();
    mocks.prisma.upload.deleteMany.mockResolvedValue({ count: 1 });
    mocks.unlink.mockResolvedValue(undefined);
  });

  it("sletter en fil som ikke er referert", async () => {
    await releaseUpload("/uploads/abc.pdf");

    expect(mocks.prisma.upload.deleteMany).toHaveBeenCalledWith({
      where: { storedName: "abc.pdf" },
    });
    expect(mocks.unlink).toHaveBeenCalledWith("/tmp/uploads/abc.pdf");
  });

  it("beholder en fil som fortsatt er referert", async () => {
    mocks.prisma.document.findFirst.mockResolvedValue({ id: "doc-1" });

    await releaseUpload("/uploads/abc.pdf");

    expect(mocks.prisma.upload.deleteMany).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it("beholder en fil som brukes i en rapport", async () => {
    mocks.prisma.reportUnit.findFirst.mockResolvedValue({ id: "unit-1" });

    await releaseUpload("/uploads/abc.png");

    expect(mocks.prisma.upload.deleteMany).not.toHaveBeenCalled();
  });

  it("beholder en fil som bare brukes i en rapportrevisjon", async () => {
    mocks.prisma.reportRevision.findFirst.mockResolvedValue({ id: "rev-1" });

    const released = await releaseUpload("/uploads/abc.png");

    expect(released).toBe(false);
    expect(mocks.prisma.upload.deleteMany).not.toHaveBeenCalled();
  });

  it("beholder en fil som brukes i en rapportkladd", async () => {
    mocks.prisma.reportDraft.findFirst.mockResolvedValue({ id: "draft-1" });

    await releaseUpload("/uploads/abc.png");

    expect(mocks.prisma.upload.deleteMany).not.toHaveBeenCalled();
  });

  it("beholder en fil som er rapportens mellomlagrede PDF", async () => {
    // Revisjonen og kladden er tomme; det er pdfUrl-treffet som skal stoppe.
    mocks.prisma.report.findFirst.mockResolvedValue({ id: "report-1" });

    await releaseUpload("/uploads/abc.pdf");

    expect(mocks.prisma.report.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([{ pdfUrl: "/uploads/abc.pdf" }]),
        },
      }),
    );
    expect(mocks.prisma.upload.deleteMany).not.toHaveBeenCalled();
  });

  it("rydder bare gamle, ubrukte opplastinger", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      { storedName: "gammel.pdf" },
      { storedName: "brukt.pdf" },
    ]);
    mocks.prisma.upload.deleteMany.mockResolvedValueOnce({ count: 1 });
    mocks.prisma.reportDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "draft-1" });

    const result = await cleanupAbandonedUploads({ olderThanHours: 48 });

    expect(result).toEqual({ checked: 2, released: 1 });
    expect(mocks.prisma.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerType: { in: ["USER", "DOCUMENT", "WORK_ORDER", "CONTRACT"] },
        }),
      }),
    );
  });

  it("inkluderer forlatte WORK_ORDER-opplastinger, men beholder refererte filer", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      { storedName: "forlatt.jpg" },
      { storedName: "vedlegg.jpg" },
    ]);
    mocks.prisma.attachment.findFirst.mockImplementation(
      async (args: { where: { dataUrl: string } }) =>
        args.where.dataUrl.includes("vedlegg") ? { id: "att-1" } : null,
    );
    for (const model of [
      mocks.prisma.customerAttachment,
      mocks.prisma.document,
      mocks.prisma.documentVersion,
      mocks.prisma.report,
      mocks.prisma.reportUnit,
      mocks.prisma.reportRevision,
      mocks.prisma.reportDraft,
    ]) {
      model.findFirst.mockResolvedValue(null);
    }
    let deletes = 0;
    mocks.prisma.upload.deleteMany.mockImplementation(async () => {
      deletes += 1;
      return { count: deletes === 1 ? 1 : 0 };
    });

    const result = await cleanupAbandonedUploads({ olderThanHours: 48 });

    expect(mocks.prisma.upload.deleteMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ checked: 2, released: 1 });
    expect(mocks.prisma.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerType: { in: ["USER", "DOCUMENT", "WORK_ORDER", "CONTRACT"] },
        }),
      }),
    );
  });

  it("ignorerer URL-er utenfor opplastingsmappen", async () => {
    await releaseUpload("https://evil.example/x.pdf");
    await releaseUpload("/etc/passwd");

    expect(mocks.prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.upload.deleteMany).not.toHaveBeenCalled();
  });
});
