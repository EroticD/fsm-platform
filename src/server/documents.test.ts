import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    documentVersion: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    documentFolder: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    documentTag: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  linkUploadOwner: vi.fn(async () => {}),
  enqueuePdfText: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/upload-access", () => ({
  linkUploadOwner: mocks.linkUploadOwner,
}));
vi.mock("@/lib/pdf-queue", () => ({
  enqueuePdfText: mocks.enqueuePdfText,
}));

import {
  createDocument,
  deleteDocument,
  restoreDocumentVersion,
  updateDocument,
} from "./documents";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "Actor",
    email: "actor@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: [
        "documents.view",
        "documents.manage",
        "templates.manage",
      ],
    },
    ...overrides,
  };
}

const admin = () => actor({ role: "ADMIN" });
const office = () => actor();
const technician = () =>
  actor({
    role: "TECHNICIAN",
    roleDefinition: { permissions: ["documents.view"] },
  });

const currentDocument = {
  id: "doc-1",
  title: "Manual",
  fileName: "ny.pdf",
  filePath: "/uploads/ny.pdf",
  fileSize: 200,
  mimeType: "application/pdf",
};

const previousVersion = {
  id: "version-1",
  documentId: "doc-1",
  fileName: "gammel.pdf",
  filePath: "/uploads/gammel.pdf",
  fileSize: 100,
  mimeType: "application/pdf",
  createdBy: "Kontor",
  createdAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.document.findUnique.mockResolvedValue(currentDocument);
  mocks.prisma.documentVersion.findUnique.mockResolvedValue(previousVersion);
  mocks.prisma.documentVersion.create.mockResolvedValue({});
  mocks.prisma.document.update.mockResolvedValue({});
});

describe("dokumenttjenesten – autorisasjon", () => {
  it("nekter å opprette dokument uten documents.manage", async () => {
    const result = await createDocument(technician(), {
      title: "Manual",
      fileUrl: "/uploads/ny.pdf",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("nekter å slette dokument uten å være administrator", async () => {
    const result = await deleteDocument(office(), { id: "doc-1" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.document.delete).not.toHaveBeenCalled();
  });

  it("nekter å gjenopprette versjon for montør uten kontorrolle", async () => {
    const result = await restoreDocumentVersion(technician(), {
      versionId: "version-1",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("dokumenttjenesten – versjoner", () => {
  it("arkiverer gjeldende fil og ruller tilbake til valgt versjon", async () => {
    const createVersion = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));
    const auditCreate = vi.fn(async () => ({}));

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        const tx = {
          documentVersion: { create: createVersion },
          document: { update },
          auditLog: { create: auditCreate },
        };
        return callback(tx);
      },
    );

    const result = await restoreDocumentVersion(admin(), {
      versionId: "version-1",
    });

    expect(result.ok).toBe(true);
    expect(createVersion).toHaveBeenCalledWith({
      data: {
        documentId: "doc-1",
        fileName: currentDocument.fileName,
        filePath: currentDocument.filePath,
        fileSize: currentDocument.fileSize,
        mimeType: currentDocument.mimeType,
        createdBy: "Actor",
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: {
        fileName: previousVersion.fileName,
        filePath: previousVersion.filePath,
        fileSize: previousVersion.fileSize,
        mimeType: previousVersion.mimeType,
      },
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it("arkiverer ikke en versjon når revisjonsloggen feiler", async () => {
    const committed: string[] = [];
    const createVersion = vi.fn(async () => {
      committed.push("version");
      return {};
    });

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        const pending: string[] = [];
        const tx = {
          documentVersion: {
            create: vi.fn(async () => {
              pending.push("version");
              return {};
            }),
          },
          document: { update: vi.fn(async () => ({})) },
          auditLog: {
            create: vi.fn(async () => {
              throw new Error("revisjonsloggen feilet");
            }),
          },
        };
        const result = await callback(tx);
        committed.push(...pending);
        return result;
      },
    );

    await expect(
      restoreDocumentVersion(admin(), { versionId: "version-1" }),
    ).rejects.toThrow("revisjonsloggen feilet");

    expect(createVersion).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });
});

describe("dokumenttjenesten – filbytte", () => {
  it("arkiverer gammel fil når filen byttes", async () => {
    const createVersion = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          documentVersion: { create: createVersion },
          document: { update },
          auditLog: { create: vi.fn(async () => ({})) },
        }),
    );

    const result = await updateDocument(office(), {
      id: "doc-1",
      title: "Manual",
      fileUrl: "/uploads/helt-ny.pdf",
      fileName: "helt-ny.pdf",
      fileSize: "300",
    });

    expect(result.ok).toBe(true);
    expect(createVersion).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentId: "doc-1",
        filePath: currentDocument.filePath,
      }),
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: expect.objectContaining({ filePath: "/uploads/helt-ny.pdf" }),
    });
    expect(mocks.linkUploadOwner).toHaveBeenCalled();
    expect(mocks.enqueuePdfText).toHaveBeenCalledWith("doc-1", "/uploads/helt-ny.pdf");
  });
});
