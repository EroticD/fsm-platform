import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  canReadUpload: vi.fn(() => true),
  stat: vi.fn(async () => ({ size: 4 })),
  createReadStream: vi.fn(),
  uploadFindUnique: vi.fn(),
  workOrderFindUnique: vi.fn(),
  customerFindUnique: vi.fn(),
  documentFindUnique: vi.fn(),
  departmentFindUnique: vi.fn(),
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
    department: { findUnique: mocks.departmentFindUnique },
    report: { findFirst: mocks.reportFindFirst },
  },
}));
vi.mock("@/lib/uploads", () => ({
  uploadDir: () => "/tmp/fss-uploads",
  contentTypeFor: (filePath: string) =>
    filePath.endsWith(".png") ? "image/png" : "application/pdf",
}));
vi.mock("node:fs", () => ({ createReadStream: mocks.createReadStream }));
vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));

import { GET } from "./route";

function request(name = "fil.pdf") {
  return new Request(`http://localhost/uploads/${name}`);
}

function params(name = "fil.pdf") {
  return { params: Promise.resolve({ path: [name] }) };
}

const workOrderUpload = {
  storedName: "fil.pdf",
  originalName: "rapport.pdf",
  ownerType: "WORK_ORDER",
  ownerId: "wo-1",
  departmentId: "dep-a",
  customerId: "cust-1",
  uploadedById: "u1",
};

function activeWorkOrder(overrides: Record<string, unknown> = {}) {
  return {
    deletedAt: null,
    status: "OPEN",
    department: { isActive: true },
    customer: { deletedAt: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "dep-a",
  });
  mocks.canReadUpload.mockReturnValue(true);
  mocks.stat.mockResolvedValue({ size: 4 });
  mocks.createReadStream.mockImplementation(() =>
    Readable.from([Buffer.from("%PDF")]),
  );
  mocks.uploadFindUnique.mockResolvedValue(workOrderUpload);
  mocks.workOrderFindUnique.mockResolvedValue(activeWorkOrder());
  mocks.customerFindUnique.mockResolvedValue({ deletedAt: null });
  mocks.documentFindUnique.mockResolvedValue({ deletedAt: null });
  mocks.departmentFindUnique.mockResolvedValue({ isActive: true });
  mocks.reportFindFirst.mockResolvedValue(null);
});

describe("/uploads – mykt slettede oppdrag", () => {
  it("nekter vanlige brukere å lese filer på et slettet oppdrag", async () => {
    mocks.workOrderFindUnique.mockResolvedValue(
      activeWorkOrder({ deletedAt: new Date() }),
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("lar administrator lese filen slik at oppdraget kan gjenopprettes", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin",
      role: "ADMIN",
      isActive: true,
      departmentId: "dep-a",
    });
    mocks.workOrderFindUnique.mockResolvedValue(
      activeWorkOrder({ deletedAt: new Date() }),
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(mocks.createReadStream).toHaveBeenCalled();
  });

  it("lar vanlige brukere lese filer på aktive oppdrag", async () => {
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(mocks.createReadStream).toHaveBeenCalled();
  });

  it("avviser når canReadUpload sier nei", async () => {
    mocks.canReadUpload.mockReturnValue(false);

    const response = await GET(request(), params());
    expect(response.status).toBe(403);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("setter no-store på filer som kan inneholde kundedata", async () => {
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("/uploads – kansellerte oppdrag", () => {
  it("nekter montør filer på et kansellert oppdrag", async () => {
    mocks.workOrderFindUnique.mockResolvedValue(
      activeWorkOrder({ status: "CANCELLED" }),
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("nekter montør en bufret rapport-PDF når rapportens oppdrag er kansellert", async () => {
    mocks.reportFindFirst.mockResolvedValue({
      id: "report-1",
      deletedAt: null,
      workOrder: { deletedAt: null, status: "CANCELLED" },
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("lar kontoret lese filer på et kansellert oppdrag", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "u2",
      role: "OFFICE",
      isActive: true,
      departmentId: "dep-a",
    });
    mocks.workOrderFindUnique.mockResolvedValue(
      activeWorkOrder({ status: "CANCELLED" }),
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
  });
});

describe("/uploads – deaktiverte avdelinger", () => {
  it("nekter ansatte i en deaktivert avdeling", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "u1",
      role: "TECHNICIAN",
      isActive: true,
      departmentId: "dep-a",
      department: { isActive: false },
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("slår opp avdelingen når økten ikke har den", async () => {
    mocks.departmentFindUnique.mockResolvedValue({ isActive: false });

    const response = await GET(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.departmentFindUnique).toHaveBeenCalledWith({
      where: { id: "dep-a" },
      select: { isActive: true },
    });
    expect(mocks.createReadStream).not.toHaveBeenCalled();
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

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("nekter en kundeportalbruker oppdragsfil når kunden er slettet", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "customer-user",
      role: "CUSTOMER",
      isActive: true,
      departmentId: null,
      customerId: "cust-1",
    });
    mocks.workOrderFindUnique.mockResolvedValue(
      activeWorkOrder({ customer: { deletedAt: new Date() } }),
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("nekter filer på et mykt slettet dokument", async () => {
    mocks.uploadFindUnique.mockResolvedValue({
      ...workOrderUpload,
      ownerType: "DOCUMENT",
      ownerId: "doc-1",
    });
    mocks.documentFindUnique.mockResolvedValue({ deletedAt: new Date() });

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });
});

describe("/uploads – strømming og headere", () => {
  it("strømmer filen med Content-Length og attachment for PDF", async () => {
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="rapport\.pdf"/,
    );
    expect(mocks.createReadStream).toHaveBeenCalledWith(
      "/tmp/fss-uploads/fil.pdf",
    );

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString()).toBe("%PDF");
  });

  it("viser bilder inline", async () => {
    mocks.uploadFindUnique.mockResolvedValue({
      ...workOrderUpload,
      storedName: "bilde.png",
      originalName: "bilde.png",
      ownerType: "USER",
      ownerId: "u1",
    });

    const response = await GET(request("bilde.png"), params("bilde.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("sanerer filnavnet i Content-Disposition", async () => {
    mocks.uploadFindUnique.mockResolvedValue({
      ...workOrderUpload,
      originalName: '../../rapport"\r\nX-Evil: 1.pdf',
    });

    const response = await GET(request(), params());
    const header = response.headers.get("content-disposition") ?? "";

    expect(response.status).toBe(200);
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).toContain('filename="rapportX-Evil: 1.pdf"');
  });
});

describe("/uploads – rapport-PDF", () => {
  const reportPdf = {
    id: "report-1",
    deletedAt: null,
    workOrder: { deletedAt: null, status: "OPEN" },
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

    const response = await GET(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
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

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(mocks.createReadStream).toHaveBeenCalled();
  });

  it("nekter en slettet rapport-PDF", async () => {
    mocks.reportFindFirst.mockResolvedValue({
      ...reportPdf,
      deletedAt: new Date(),
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(mocks.createReadStream).not.toHaveBeenCalled();
  });

  it("beholder vanlige oppdragsvedlegg uten reports.view", async () => {
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(mocks.createReadStream).toHaveBeenCalled();
  });
});
