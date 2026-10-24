import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    attachment: { findFirst: vi.fn() },
    customerAttachment: { findFirst: vi.fn() },
    document: { findFirst: vi.fn() },
    documentVersion: { findFirst: vi.fn() },
    report: { findFirst: vi.fn() },
    reportUnit: { findFirst: vi.fn() },
    upload: { deleteMany: vi.fn() },
  },
  unlink: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("node:fs/promises", () => ({ default: { unlink: mocks.unlink } }));
vi.mock("@/lib/uploads", () => ({ uploadDir: () => "/tmp/uploads" }));

import { releaseUpload } from "./upload-cleanup";

function noReferences() {
  mocks.prisma.attachment.findFirst.mockResolvedValue(null);
  mocks.prisma.customerAttachment.findFirst.mockResolvedValue(null);
  mocks.prisma.document.findFirst.mockResolvedValue(null);
  mocks.prisma.documentVersion.findFirst.mockResolvedValue(null);
  mocks.prisma.report.findFirst.mockResolvedValue(null);
  mocks.prisma.reportUnit.findFirst.mockResolvedValue(null);
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

  it("ignorerer URL-er utenfor opplastingsmappen", async () => {
    await releaseUpload("https://evil.example/x.pdf");
    await releaseUpload("/etc/passwd");

    expect(mocks.prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.upload.deleteMany).not.toHaveBeenCalled();
  });
});
