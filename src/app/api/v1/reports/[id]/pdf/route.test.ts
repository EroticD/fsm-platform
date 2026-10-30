import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getReportPdfForViewer: vi.fn(),
  prisma: {
    report: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/server/reports", () => ({
  getReportPdfForViewer: mocks.getReportPdfForViewer,
}));

import { GET as getReportPdf } from "./route";

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

function request() {
  return new Request("http://localhost/api/v1/reports/rep1/pdf");
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.prisma.report.findFirst.mockResolvedValue({
    id: "rep1",
    workOrderId: "wo1",
  });
  mocks.getReportPdfForViewer.mockResolvedValue({
    ok: true,
    buffer: Buffer.from("%PDF-1.7"),
    fileName: "rapport-123",
  });
});

describe("GET /api/v1/reports/[id]/pdf", () => {
  it("returnerer 401 uten gyldig API-nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('{"error":{"code":"unauthorized"}}', { status: 401 }),
    });

    const response = await getReportPdf(request(), params("rep1"));

    expect(response.status).toBe(401);
    expect(mocks.getReportPdfForViewer).not.toHaveBeenCalled();
  });

  it("nekter aktører uten reports.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ role: "USER", departmentId: null }),
    );

    const response = await getReportPdf(request(), params("rep1"));

    expect(response.status).toBe(403);
    expect(mocks.prisma.report.findFirst).not.toHaveBeenCalled();
    expect(mocks.getReportPdfForViewer).not.toHaveBeenCalled();
  });

  it("gir 404 uten å kalle PDF-tjenesten når rapporten er utenfor omfanget", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(null);

    const response = await getReportPdf(request(), params("rep1"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.getReportPdfForViewer).not.toHaveBeenCalled();

    const call = mocks.prisma.report.findFirst.mock.calls[0][0];
    expect(call.where.workOrder.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ departmentId: "dep-a" }),
        { deletedAt: null },
      ]),
    );
  });

  it("returnerer PDF som vedlegg med no-store", async () => {
    const response = await getReportPdf(request(), params("rep1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="rapport-123\.pdf"/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.text()).resolves.toBe("%PDF-1.7");
    expect(mocks.getReportPdfForViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "wo1",
      "rep1",
    );
  });

  it("mapper tjenestens 403 og 404 til stabile API-feil", async () => {
    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: false,
      status: 403,
      message: "Ingen tilgang",
    });

    const forbidden = await getReportPdf(request(), params("rep1"));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "forbidden", message: "Ingen tilgang" },
    });

    mocks.getReportPdfForViewer.mockResolvedValue({
      ok: false,
      status: 404,
      message: "Fant ikke rapporten",
    });

    const missing = await getReportPdf(request(), params("rep1"));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "not_found", message: "Fant ikke rapporten" },
    });
  });
});
