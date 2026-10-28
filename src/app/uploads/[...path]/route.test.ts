import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  canReadUpload: vi.fn(() => true),
  readFile: vi.fn(async () => Buffer.from("%PDF")),
  uploadFindUnique: vi.fn(),
  workOrderFindUnique: vi.fn(),
  customerFindUnique: vi.fn(),
  documentFindUnique: vi.fn(),
  reportFindFirst: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/upload-access", () => ({ canReadUpload: mocks.canReadUpload }));
vi.mock("@/lib/prisma", () => ({
  default: {
    upload: { findUnique: mocks.uploadFindUnique },
    workOrder: { findUnique: mocks.workOrderFindUnique },
    customer: { findUnique: mocks.customerFindUnique },
    document: { findUnique: mocks.documentFindUnique },
    report: { findFirst: mocks.reportFindFirst },
  },
}));
vi.mock("@/lib/uploads", () => ({
  uploadDir: () => "/tmp/fss-uploads",
  contentTypeFor: () => "application/pdf",
}));
vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile },
}));

import { GET } from "./route";

function request() {
  return new Request("http://localhost/uploads/fil.pdf");
}

const params = { params: Promise.resolve({ path: ["fil.pdf"] }) };

const workOrderUpload = {
  storedName: "fil.pdf",
  ownerType: "WORK_ORDER",
  ownerId: "wo-1",
  departmentId: "dep-a",
  customerId: "cust-1",
  uploadedById: "u1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "dep-a",
  });
  mocks.canReadUpload.mockReturnValue(true);
  mocks.uploadFindUnique.mockResolvedValue(workOrderUpload);
  mocks.workOrderFindUnique.mockResolvedValue({ deletedAt: null });
  mocks.customerFindUnique.mockResolvedValue({ deletedAt: null });
  mocks.documentFindUnique.mockResolvedValue({ deletedAt: null });
  mocks.reportFindFirst.mockResolvedValue(null);
});

describe("/uploads – mykt slettede oppdrag", () => {
  it("nekter vanlige brukere å lese filer på et slettet oppdrag", async () => {
    mocks.workOrderFindUnique.mockResolvedValue({ deletedAt: new Date() });

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("lar administrator lese filen slik at oppdraget kan gjenopprettes", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin",
      role: "ADMIN",
      isActive: true,
      departmentId: "dep-a",
    });
    mocks.workOrderFindUnique.mockResolvedValue({ deletedAt: new Date() });

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.readFile).toHaveBeenCalled();
  });

  it("lar vanlige brukere lese filer på aktive oppdrag", async () => {
    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.readFile).toHaveBeenCalled();
  });

  it("avviser når canReadUpload sier nei", async () => {
    mocks.canReadUpload.mockReturnValue(false);

    const response = await GET(request(), params);
    expect(response.status).toBe(403);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("setter no-store på filer som kan inneholde kundedata", async () => {
    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("/uploads – slettede eiere", () => {
  it("nekter filer på en mykt slettet kunde", async () => {
    mocks.uploadFindUnique.mockResolvedValue({
      ...workOrderUpload,
      ownerType: "CUSTOMER",
      ownerId: "cust-1",
    });
    mocks.customerFindUnique.mockResolvedValue({ deletedAt: new Date() });

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("nekter filer på et mykt slettet dokument", async () => {
    mocks.uploadFindUnique.mockResolvedValue({
      ...workOrderUpload,
      ownerType: "DOCUMENT",
      ownerId: "doc-1",
    });
    mocks.documentFindUnique.mockResolvedValue({ deletedAt: new Date() });

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});

describe("/uploads – rapport-PDF", () => {
  const reportPdf = {
    id: "report-1",
    deletedAt: null,
    workOrder: { deletedAt: null },
  };

  it("krever reports.view for en rapport-PDF", async () => {
    mocks.reportFindFirst.mockResolvedValue(reportPdf);
    mocks.getCurrentUser.mockResolvedValue({
      id: "u3",
      role: "USER",
      isActive: true,
      departmentId: "dep-a",
      permissions: [],
      permissionsCustomized: true,
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(403);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("lar en bruker med reports.view lese rapport-PDF-en", async () => {
    mocks.reportFindFirst.mockResolvedValue(reportPdf);
    mocks.getCurrentUser.mockResolvedValue({
      id: "u2",
      role: "OFFICE",
      isActive: true,
      departmentId: "dep-a",
      permissions: ["reports.view"],
      permissionsCustomized: true,
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.readFile).toHaveBeenCalled();
  });

  it("nekter en slettet rapport-PDF", async () => {
    mocks.reportFindFirst.mockResolvedValue({
      ...reportPdf,
      deletedAt: new Date(),
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("beholder vanlige oppdragsvedlegg uten reports.view", async () => {
    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.readFile).toHaveBeenCalled();
  });
});
