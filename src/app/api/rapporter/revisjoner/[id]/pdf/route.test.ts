import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getReportRevisionForPdf: vi.fn(),
  renderReportRevisionPdf: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));
vi.mock("@/server/report-revisions", () => ({
  getReportRevisionForPdf: mocks.getReportRevisionForPdf,
}));
vi.mock("@/lib/report-pdf", () => ({
  renderReportRevisionPdf: mocks.renderReportRevisionPdf,
}));

import { GET } from "./route";

function call(path = "/api/rapporter/revisjoner/rev1/pdf") {
  return GET(new Request(`http://localhost${path}`), {
    params: Promise.resolve({ id: "rev1" }),
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
  mocks.getReportRevisionForPdf.mockResolvedValue({
    ok: true,
    data: {
      id: "rev1",
      workOrder: {
        id: "wo1",
        title: "Oppdrag",
        customerName: null,
      },
    },
  });
  mocks.renderReportRevisionPdf.mockResolvedValue({
    buffer: Buffer.from("%PDF-1.7\n%%EOF\n"),
    fileName: "Revisjon 1",
  });
});

describe("GET /api/rapporter/revisjoner/[id]/pdf", () => {
  it("leverer revisjons-PDF som vedlegg som standard", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("content-disposition")).not.toContain("inline");
  });

  it("leverer revisjons-PDF inline når viseren ber om det", async () => {
    const response = await call(
      "/api/rapporter/revisjoner/rev1/pdf?inline=1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(response.headers.get("content-disposition")).not.toContain(
      "attachment",
    );
  });

  it("avviser revisjons-PDF uten gyldig økt", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(403);
  });

  it("avviser aktivt innhold også for inline-visning", async () => {
    process.env.QPDF_PATH = "qpdf-finnes-ikke";
    mocks.renderReportRevisionPdf.mockResolvedValue({
      buffer: Buffer.from(
        "%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (x) >> >>\n%%EOF\n",
      ),
      fileName: "Revisjon 1",
    });

    const response = await call(
      "/api/rapporter/revisjoner/rev1/pdf?inline=1",
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("avviser aktivt innhold når qpdf mangler", async () => {
    process.env.QPDF_PATH = "qpdf-finnes-ikke";
    mocks.renderReportRevisionPdf.mockResolvedValue({
      buffer: Buffer.from(
        "%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (x) >> >>\n%%EOF\n",
      ),
      fileName: "Revisjon 1",
    });

    const response = await call();

    expect(response.status).toBe(422);
  });
});
