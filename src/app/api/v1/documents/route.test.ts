import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findDocumentIdsBySearch: vi.fn(),
  prisma: {
    document: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    documentFolder: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/document-search", () => ({
  findDocumentIdsBySearch: mocks.findDocumentIdsBySearch,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import { GET as getDocument } from "./[id]/route";
import { GET as listDocuments } from "./route";

function actor(overrides: Record<string, unknown> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(path = "/api/v1/documents") {
  return new Request(`http://localhost${path}`);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const listRow = {
  id: "doc1",
  title: "Driftsavtale",
  fileName: "avtale.pdf",
  mimeType: "application/pdf",
  fileSize: 1234,
  folder: { id: "folder1", name: "Drift" },
  tags: [{ id: "tag1", name: "drift", color: "#3b82f6" }],
  updatedAt: new Date("2026-10-20T10:00:00.000Z"),
  uploadedBy: "Kari",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.findDocumentIdsBySearch.mockResolvedValue([]);
  mocks.prisma.document.findMany.mockResolvedValue([]);
  mocks.prisma.document.findFirst.mockResolvedValue(null);
  mocks.prisma.document.count.mockResolvedValue(0);
  mocks.prisma.documentFolder.findUnique.mockResolvedValue(null);
});

describe("GET /api/v1/documents", () => {
  it("nekter aktører uten documents.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ role: "USER", departmentId: null }),
    );

    const response = await listDocuments(request());

    expect(response.status).toBe(403);
    expect(mocks.prisma.document.findMany).not.toHaveBeenCalled();
  });

  it("filtrerer på mappe, tag og søk og returnerer bare metadata", async () => {
    mocks.findDocumentIdsBySearch.mockResolvedValue(["doc1"]);
    mocks.prisma.document.count.mockResolvedValue(1);
    mocks.prisma.document.findMany.mockResolvedValue([listRow]);

    const response = await listDocuments(
      request(
        "/api/v1/documents?folderId=folder1&tag=drift&q=avtale&page=2&limit=25",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        ...listRow,
        updatedAt: "2026-10-20T10:00:00.000Z",
      },
    ]);
    expect(body.meta).toEqual({
      total: 1,
      page: 2,
      limit: 25,
      totalPages: 1,
    });
    expect(mocks.findDocumentIdsBySearch).toHaveBeenCalledWith("avtale");

    const call = mocks.prisma.document.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      deletedAt: null,
      folderId: "folder1",
      tags: { some: { name: "drift" } },
      id: { in: ["doc1"] },
    });
    expect(call.select.filePath).toBeUndefined();
    expect(call.select.folderId).toBeUndefined();
    expect(call.skip).toBe(25);
    expect(call.take).toBe(25);
  });
});

describe("GET /api/v1/documents/[id]", () => {
  it("returnerer 404 for ukjent eller slettet dokument", async () => {
    const response = await getDocument(
      request("/api/v1/documents/doc1"),
      params("doc1"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("gir mappesti, versjoner og ingen rå filsti", async () => {
    mocks.prisma.document.findFirst.mockResolvedValue({
      id: "doc1",
      title: "Driftsavtale",
      description: "Avtale",
      fileName: "avtale.pdf",
      fileSize: 1234,
      mimeType: "application/pdf",
      uploadedBy: "Kari",
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
      updatedAt: new Date("2026-10-20T10:00:00.000Z"),
      folder: { id: "folder1", name: "Drift", parentId: "root" },
      tags: [{ id: "tag1", name: "drift", color: "#3b82f6" }],
      versions: [
        {
          id: "ver1",
          fileName: "avtale-v1.pdf",
          fileSize: 1000,
          mimeType: "application/pdf",
          createdBy: "Kari",
          createdAt: new Date("2026-10-01T09:00:00.000Z"),
        },
      ],
      _count: { versions: 1 },
    });
    mocks.prisma.documentFolder.findUnique.mockResolvedValue({
      name: "Rot",
      parentId: null,
    });

    const response = await getDocument(
      request("/api/v1/documents/doc1"),
      params("doc1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "doc1",
      folder: { id: "folder1", name: "Drift" },
      folderPath: "Rot / Drift",
      versionsCount: 1,
      versions: [{ id: "ver1", fileName: "avtale-v1.pdf" }],
    });
    expect(body.data._count).toBeUndefined();
    expect(body.data.folderPath).not.toContain("/uploads");
    expect(body.data.versions[0].filePath).toBeUndefined();

    const call = mocks.prisma.document.findFirst.mock.calls[0][0];
    expect(call.select.filePath).toBeUndefined();
    expect(call.select.versions.select.filePath).toBeUndefined();
  });
});
