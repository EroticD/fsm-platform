import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getReportPdfForViewer: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/server/reports", () => ({
  getReportPdfForViewer: mocks.getReportPdfForViewer,
}));

import { GET } from "./route";

function pdf(extra = "") {
  return Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R${extra} >>\nendobj\n%%EOF\n`);
}

function call() {
  return GET(new Request("http://localhost/api/rapporter/wo1/pdf"), {
    params: Promise.resolve({ id: "wo1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.QPDF_PATH;
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    isActive: true,
    role: "OFFICE",
  });
});

describe("GET /api/rapporter/[id]/pdf", () => {
  it("leverer PDF som vedlegg, aldri inline", async () => {
    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: true,
      buffer: pdf(),
      fileName: "Rapport 1",
    });

    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("content-disposition")).not.toContain("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("avviser aktivt innhold når qpdf ikke er tilgjengelig", async () => {
    process.env.QPDF_PATH = "qpdf-finnes-ikke";
    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: true,
      buffer: pdf(' /OpenAction << /S /JavaScript /JS (app.alert(1)) >>'),
      fileName: "Rapport 1",
    });

    const response = await call();

    expect(response.status).toBe(422);
  });

  it("avviser uten gyldig økt", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(403);
  });
});
