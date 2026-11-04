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

function call(path = "/api/rapporter/wo1/pdf") {
  return GET(new Request(`http://localhost${path}`), {
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
  it("leverer PDF som vedlegg som standard", async () => {
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

  it("leverer inline når viseren ber om det", async () => {
    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: true,
      buffer: pdf(),
      fileName: "Rapport 1",
    });

    const response = await call("/api/rapporter/wo1/pdf?inline=1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(response.headers.get("content-disposition")).not.toContain(
      "attachment",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("lar download=1 overstyre inline", async () => {
    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: true,
      buffer: pdf(),
      fileName: "Rapport 1",
    });

    const response = await call(
      "/api/rapporter/wo1/pdf?inline=1&download=1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("avviser aktivt innhold også for inline-visning", async () => {
    process.env.QPDF_PATH = "qpdf-finnes-ikke";
    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: true,
      buffer: pdf(' /OpenAction << /S /JavaScript /JS (app.alert(1)) >>'),
      fileName: "Rapport 1",
    });

    const response = await call("/api/rapporter/wo1/pdf?inline=1");

    expect(response.status).toBe(422);
    expect(response.headers.get("content-disposition")).toBeNull();
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

  it("returnerer 404 når oppdraget eller rapporten mangler", async () => {
    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: false,
      status: 404,
      message: "Fant ikke rapporten",
    });

    const response = await call("/api/rapporter/wo1/pdf?inline=1");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-disposition")).toBeNull();
  });
});
