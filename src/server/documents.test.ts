import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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
    upload: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  claimUpload: vi.fn(async () => ({ claimed: true })),
  enqueuePdfText: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/upload-access", () => ({
  claimUpload: mocks.claimUpload,
}));
vi.mock("@/lib/pdf-queue", () => ({
  enqueuePdfText: mocks.enqueuePdfText,
}));

import {
  bulkCreateDocuments,
  createDocument,
  deleteDocument,
  getDocumentLibrary,
  restoreDocument,
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
  mocks.prisma.document.findFirst.mockImplementation(
    async (args: unknown) => mocks.prisma.document.findUnique(args),
  );
  mocks.prisma.document.create.mockResolvedValue({ id: "doc-2" });
  mocks.prisma.documentVersion.findUnique.mockResolvedValue(previousVersion);
  mocks.prisma.documentVersion.create.mockResolvedValue({});
  mocks.prisma.document.update.mockResolvedValue({});
  mocks.prisma.upload.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.$queryRaw.mockResolvedValue([]);
  mocks.claimUpload.mockResolvedValue({ claimed: true });
});

/** Tomme mappe-, dokument- og taglister for bibliotekssøk. */
function mockEmptyLibrary() {
  mocks.prisma.documentFolder.findUnique.mockResolvedValue(null);
  mocks.prisma.documentFolder.findMany.mockResolvedValue([]);
  mocks.prisma.document.findMany.mockResolvedValue([]);
  mocks.prisma.document.count.mockResolvedValue(0);
  mocks.prisma.documentTag.findMany.mockResolvedValue([]);
}

type SqlCall = { text: string; values: unknown[] };

function lastSql(): SqlCall {
  const call = mocks.prisma.$queryRaw.mock.calls.at(-1);
  if (!call) throw new Error("Ingen SQL-spørring ble kjørt");
  return call[0] as SqlCall;
}

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

  it("nekter å gjenopprette versjon uten documents.manage", async () => {
    const technicianResult = await restoreDocumentVersion(technician(), {
      versionId: "version-1",
    });
    const officeWithoutManage = actor({
      roleDefinition: { permissions: ["documents.view"] },
    });
    const officeResult = await restoreDocumentVersion(officeWithoutManage, {
      versionId: "version-1",
    });

    expect(technicianResult).toEqual({ ok: false, reason: "forbidden" });
    expect(officeResult).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("dokumenttjenesten – myk sletting og gjenoppretting", () => {
  it("myksletter dokumentet i stedet for å slette filen", async () => {
    const result = await deleteDocument(admin(), { id: "doc-1" });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: {
        deletedAt: expect.any(Date),
        deletedBy: "Actor",
      },
    });
    expect(mocks.prisma.document.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Document",
        entityId: "doc-1",
        actorId: "actor",
      }),
    });
  });

  it("gjenoppretter et slettet dokument", async () => {
    mocks.prisma.document.findUnique.mockResolvedValue({
      ...currentDocument,
      deletedAt: new Date(),
    });

    const result = await restoreDocument(admin(), { id: "doc-1" });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { deletedAt: null, deletedBy: null },
    });
  });

  it("nekter gjenoppretting for kontor", async () => {
    const result = await restoreDocument(office(), { id: "doc-1" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.document.update).not.toHaveBeenCalled();
  });

  it("viser papirkurven bare til administrator", async () => {
    mocks.prisma.documentFolder.findUnique.mockResolvedValue(null);
    mocks.prisma.documentFolder.findMany.mockResolvedValue([]);
    mocks.prisma.document.findMany.mockResolvedValue([]);
    mocks.prisma.document.count.mockResolvedValue(0);
    mocks.prisma.documentTag.findMany.mockResolvedValue([]);

    await getDocumentLibrary(admin(), {
      folderId: null,
      search: "",
      tag: "",
      page: 1,
      documentId: null,
      deleted: true,
    });

    const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
      where: { deletedAt: unknown; folderId: string | null };
    };
    expect(args.where).toMatchObject({
      folderId: null,
      deletedAt: { not: null },
    });
  });

  it("ignorerer papirkurven for brukere som ikke er administrator", async () => {
    mocks.prisma.documentFolder.findUnique.mockResolvedValue(null);
    mocks.prisma.documentFolder.findMany.mockResolvedValue([]);
    mocks.prisma.document.findMany.mockResolvedValue([]);
    mocks.prisma.document.count.mockResolvedValue(0);
    mocks.prisma.documentTag.findMany.mockResolvedValue([]);

    await getDocumentLibrary(office(), {
      folderId: null,
      search: "",
      tag: "",
      page: 1,
      documentId: null,
      deleted: true,
    });

    const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
      where: { deletedAt: unknown };
    };
    expect(args.where.deletedAt).toBeNull();
  });

  it("søker i hele biblioteket når søkefeltet er brukt", async () => {
    mocks.prisma.documentFolder.findUnique.mockResolvedValue({
      id: "folder-a",
      name: "Pumper",
      parentId: null,
    });
    mocks.prisma.documentFolder.findMany.mockResolvedValue([]);
    mocks.prisma.document.findMany.mockResolvedValue([]);
    mocks.prisma.document.count.mockResolvedValue(0);
    mocks.prisma.documentTag.findMany.mockResolvedValue([]);
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "doc-1" }]);

    await getDocumentLibrary(office(), {
      folderId: "folder-a",
      search: "pumpe",
      tag: "manual",
      page: 1,
      documentId: null,
    });

    const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
      where: {
        folderId?: unknown;
        id?: unknown;
        OR?: unknown[];
        tags?: unknown;
        deletedAt?: unknown;
      };
    };

    // Mappen skal ikke begrense treffene når brukeren søker.
    expect(args.where.folderId).toBeUndefined();
    expect(args.where.OR).toBeUndefined();
    expect(args.where.id).toEqual({ in: ["doc-1"] });
    // Tag-filteret komponeres med søket.
    expect(args.where.tags).toEqual({ some: { name: "manual" } });
    expect(args.where.deletedAt).toBeNull();
    expect(mocks.prisma.document.count).toHaveBeenCalledWith({
      where: args.where,
    });
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Faktura #123 (Kunde).pdf", "faktura 123 kunde pdf", "faktura123kundepdf"],
    ["faktura 123 kunde", "faktura 123 kunde", "faktura123kunde"],
    ["Faktura-123", "faktura 123", "faktura123"],
    ["faktura#123", "faktura 123", "faktura123"],
  ])(
    "ignorerer tegnsetting i filnavnsøket: %s",
    async (query, expectedTerm, expectedCompact) => {
      mockEmptyLibrary();
      mocks.prisma.$queryRaw.mockResolvedValue([{ id: "doc-faktura" }]);

      await getDocumentLibrary(office(), {
        folderId: null,
        search: query,
        tag: "",
        page: 1,
        documentId: null,
      });

      const sql = lastSql();
      // Både normalisert og kompakt form sendes som parametere.
      expect(sql.values).toContain(expectedTerm);
      expect(sql.values).toContain(expectedCompact);
      // Punctuation blir mellomrom i databasen, og mellomrom fjernes i den
      // kompakte varianten. Æ/ø/å og aksenter brettes med unaccent.
      expect(sql.text).toContain("unaccent");
      expect(sql.text).toContain("regexp_replace");
      expect(sql.text).toContain("replace(");
      expect(sql.text).toContain('d."fileName"');

      const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
        where: { id?: unknown };
      };
      expect(args.where.id).toEqual({ in: ["doc-faktura"] });
    },
  );

  it("matcher tittel og beskrivelse med samme normaliserte søk", async () => {
    mockEmptyLibrary();
    mocks.prisma.$queryRaw.mockResolvedValue([
      { id: "doc-tittel" },
      { id: "doc-beskrivelse" },
    ]);

    await getDocumentLibrary(office(), {
      folderId: null,
      search: "Årlig-service",
      tag: "",
      page: 1,
      documentId: null,
    });

    const sql = lastSql();
    expect(sql.text).toContain('d."title"');
    expect(sql.text).toContain('d."description"');
    expect(sql.values).toContain("arlig service");
    expect(sql.values).toContain("arligservice");

    const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
      where: { id?: unknown };
    };
    expect(args.where.id).toEqual({
      in: ["doc-tittel", "doc-beskrivelse"],
    });
  });

  it("utelater mykt slettede dokumenter fra søket", async () => {
    mockEmptyLibrary();
    mocks.prisma.$queryRaw.mockResolvedValue([
      { id: "doc-1" },
      { id: "doc-slettet" },
    ]);

    await getDocumentLibrary(office(), {
      folderId: null,
      search: "pumpe",
      tag: "",
      page: 1,
      documentId: null,
    });

    const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
      where: { deletedAt?: unknown; id?: unknown };
    };
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.id).toEqual({ in: ["doc-1", "doc-slettet"] });
  });

  it("beholder tag-filteret når det søkes", async () => {
    mockEmptyLibrary();
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "doc-1" }]);

    await getDocumentLibrary(office(), {
      folderId: null,
      search: "pumpe",
      tag: "manual",
      page: 2,
      documentId: null,
    });

    const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
      where: { id?: unknown; tags?: unknown };
      skip?: number;
      take?: number;
    };
    expect(args.where.id).toEqual({ in: ["doc-1"] });
    expect(args.where.tags).toEqual({ some: { name: "manual" } });
    // Pagineringen er uendret.
    expect(args.skip).toBe(30);
    expect(args.take).toBe(30);
    expect(mocks.prisma.document.count).toHaveBeenCalledWith({
      where: args.where,
    });
  });

  it("begrenser blaing til mappen når det ikke søkes", async () => {
    mocks.prisma.documentFolder.findUnique.mockResolvedValue({
      id: "folder-a",
      name: "Pumper",
      parentId: null,
    });
    mocks.prisma.documentFolder.findMany.mockResolvedValue([]);
    mocks.prisma.document.findMany.mockResolvedValue([]);
    mocks.prisma.document.count.mockResolvedValue(0);
    mocks.prisma.documentTag.findMany.mockResolvedValue([]);

    await getDocumentLibrary(office(), {
      folderId: "folder-a",
      search: "",
      tag: "",
      page: 1,
      documentId: null,
    });

    const args = mocks.prisma.document.findMany.mock.calls[0][0] as {
      where: { folderId?: unknown };
    };
    expect(args.where.folderId).toBe("folder-a");
    // Blaing uten søk skal ikke kjøre det normaliserte ID-søket.
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("dokumenttjenesten – filstier", () => {
  const rejected = [
    "https://evil.example/ond.pdf",
    "//evil.example/ond.pdf",
    "/etc/passwd",
    "/dev/zero",
    "/uploads/../etc/passwd",
  ];

  it.each(rejected)("avviser createDocument med filstien %s", async (fileUrl) => {
    const result = await createDocument(office(), {
      title: "Manual",
      fileUrl,
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(rejected)("avviser updateDocument med filstien %s", async (fileUrl) => {
    const result = await updateDocument(office(), {
      id: "doc-1",
      title: "Manual",
      fileUrl,
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(rejected)("avviser bulkCreateDocuments med filstien %s", async (fileUrl) => {
    const result = await bulkCreateDocuments(office(), {
      folderId: null,
      itemsJson: JSON.stringify([
        { fileName: "ond.pdf", fileUrl, fileSize: 10, relativePath: "ond.pdf" },
      ]),
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("godtar en vanlig fil i opplastingsmappen", async () => {
    const result = await createDocument(office(), {
      title: "Manual",
      fileUrl: "/uploads/0f7c1a9e-4a2b-4f8e-9f1a-123456789abc.pdf",
      fileName: "manual.pdf",
      fileSize: "100",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filePath: "/uploads/0f7c1a9e-4a2b-4f8e-9f1a-123456789abc.pdf",
      }),
    });
  });

  it("godtar en vanlig fil ved oppdatering", async () => {
    const result = await updateDocument(office(), {
      id: "doc-1",
      title: "Manual",
      fileUrl: "/uploads/0f7c1a9e-4a2b-4f8e-9f1a-123456789abc.pdf",
      fileName: "manual.pdf",
      fileSize: "100",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.document.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: expect.objectContaining({
        filePath: "/uploads/0f7c1a9e-4a2b-4f8e-9f1a-123456789abc.pdf",
      }),
    });
  });

  it("avviser oppretting når brukeren ikke eier filen", async () => {
    mocks.claimUpload.mockResolvedValue({ claimed: false });

    const result = await createDocument(office(), {
      title: "Manual",
      fileUrl: "/uploads/lånt.pdf",
      fileName: "lånt.pdf",
      fileSize: "100",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.document.create).not.toHaveBeenCalled();
    expect(mocks.enqueuePdfText).not.toHaveBeenCalled();
  });

  it("avviser filbytte når brukeren ikke eier den nye filen", async () => {
    mocks.claimUpload.mockResolvedValue({ claimed: false });

    const result = await updateDocument(office(), {
      id: "doc-1",
      title: "Manual",
      fileUrl: "/uploads/lånt.pdf",
      fileName: "lånt.pdf",
      fileSize: "100",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.documentVersion.create).not.toHaveBeenCalled();
    expect(mocks.prisma.document.update).not.toHaveBeenCalled();
    expect(mocks.enqueuePdfText).not.toHaveBeenCalled();
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
    expect(mocks.claimUpload).toHaveBeenCalled();
    expect(mocks.enqueuePdfText).toHaveBeenCalledWith("doc-1", "/uploads/helt-ny.pdf");
  });
});
