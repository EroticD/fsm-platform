import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  prisma: {
    report: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import { GET as getReport } from "./[id]/route";
import { GET as listReports } from "./route";

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

function request(path = "/api/v1/reports") {
  return new Request(`http://localhost${path}`);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const listRow = {
  id: "rep1",
  name: "Service",
  reportNumber: "abc1234",
  completedAt: new Date("2026-10-20T10:00:00.000Z"),
  isLocked: true,
  customerAcknowledgedAt: null,
  technicianName: "Ola",
  workOrder: { id: "wo1", title: "Oppdrag", customer: { id: "cust1", name: "Acme" } },
  _count: { units: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.prisma.report.findMany.mockResolvedValue([]);
  mocks.prisma.report.findFirst.mockResolvedValue(null);
  mocks.prisma.report.count.mockResolvedValue(0);
});

describe("GET /api/v1/reports", () => {
  it("returnerer 401 uten gyldig API-nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('{"error":{"code":"unauthorized"}}', { status: 401 }),
    });

    const response = await listReports(request());

    expect(response.status).toBe(401);
    expect(mocks.prisma.report.findMany).not.toHaveBeenCalled();
  });

  it("nekter aktører uten reports.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ role: "USER", departmentId: null }),
    );

    const response = await listReports(request());

    expect(response.status).toBe(403);
    expect(mocks.prisma.report.findMany).not.toHaveBeenCalled();
  });

  it("avgrenser til rapportomfanget og kombinerer filtre med AND", async () => {
    mocks.prisma.report.count.mockResolvedValue(1);
    mocks.prisma.report.findMany.mockResolvedValue([listRow]);

    const response = await listReports(
      request(
        "/api/v1/reports?customerId=cust1&workOrderId=wo1&locked=false" +
          "&acknowledged=true&q=abc&dateFrom=2026-10-01&dateTo=2026-10-30&page=3&limit=5",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: "rep1",
        name: "Service",
        reportNumber: "abc1234",
        completedAt: "2026-10-20T10:00:00.000Z",
        isLocked: true,
        customerAcknowledgedAt: null,
        technicianName: "Ola",
        workOrder: listRow.workOrder,
        unitsCount: 3,
      },
    ]);
    expect(body.meta).toEqual({
      total: 1,
      page: 3,
      limit: 5,
      totalPages: 1,
    });

    const call = mocks.prisma.report.findMany.mock.calls[0][0];
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.isLocked).toBe(false);
    expect(call.where.customerAcknowledgedAt).toEqual({ not: null });
    expect(call.where.completedAt).toEqual({
      gte: new Date("2026-10-01T00:00:00.000Z"),
      lt: new Date("2026-10-31T00:00:00.000Z"),
    });
    expect(call.where.workOrder.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departmentId: "dep-a",
          department: { isActive: true },
        }),
        { deletedAt: null },
        { customerId: "cust1" },
        { id: "wo1" },
      ]),
    );
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: "abc", mode: "insensitive" } },
        { workOrder: { title: { contains: "abc", mode: "insensitive" } } },
      ]),
    );
    expect(call.skip).toBe(10);
    expect(call.take).toBe(5);
  });

  it("avviser ugyldige boolske og dato-filtre", async () => {
    const locked = await listReports(request("/api/v1/reports?locked=ja"));
    expect(locked.status).toBe(400);
    await expect(locked.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "locked" } },
    });

    const date = await listReports(request("/api/v1/reports?from=2026-02-30"));
    expect(date.status).toBe(400);
    await expect(date.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "from" } },
    });
    expect(mocks.prisma.report.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/reports/[id]", () => {
  it("returnerer 404 når rapporten er utenfor omfanget", async () => {
    const response = await getReport(request("/api/v1/reports/rep1"), params("rep1"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });

    const call = mocks.prisma.report.findFirst.mock.calls[0][0];
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.workOrder.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ departmentId: "dep-a" }),
        { deletedAt: null },
      ]),
    );
  });

  it("parser svar trygt og slipper bare gjennom trygge signatur-URL-er", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue({
      id: "rep1",
      name: "Service",
      reportNumber: "abc1234",
      templateTitle: "Sjekkliste",
      templateCategory: "SERVICE",
      hmsType: null,
      requiresUnits: true,
      comments: "Alt ok",
      completedAt: new Date("2026-10-20T10:00:00.000Z"),
      createdAt: new Date("2026-10-20T09:00:00.000Z"),
      updatedAt: new Date("2026-10-20T10:00:00.000Z"),
      isLocked: true,
      lockedAt: new Date("2026-10-20T10:00:00.000Z"),
      lockedByName: "Kari",
      revision: 0,
      legalHold: false,
      technicianSignatureUrl: "/uploads/sig.png",
      customerSignatureUrl: "https://evil.example/sig.png",
      technicianName: "Ola",
      customerName: "Kunde",
      customerAcknowledgedAt: null,
      customerAcknowledgedBy: null,
      customerAcknowledgedComment: null,
      dataJson:
        '{"status":"GODKJENT","answers":{"f1":"OK","__proto__":{"polluted":true},"constructor":"x"}}',
      workOrder: {
        id: "wo1",
        title: "Oppdrag",
        orderNumber: "1001",
        status: "COMPLETED",
        customerId: "cust1",
        departmentId: "dep-a",
        customer: { id: "cust1", name: "Acme" },
        department: { id: "dep-a", name: "Øst" },
      },
      units: [
        {
          id: "unit1",
          label: "Pumpe",
          serialNumber: "S1",
          location: "Kjeller",
          status: "GODKJENT",
          comment: null,
          answersJson: '{"u1":"OK"}',
        },
      ],
    });

    const response = await getReport(request("/api/v1/reports/rep1"), params("rep1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "rep1",
      templateTitle: "Sjekkliste",
      status: "GODKJENT",
      answers: { f1: "OK" },
      units: [{ id: "unit1", answers: { u1: "OK" } }],
      signatures: {
        technician: { signed: true, url: "/uploads/sig.png" },
        customer: { signed: true, url: null },
      },
    });
    expect(body.data.dataJson).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body.data.answers, "__proto__")).toBe(
      false,
    );
    expect(
      Object.prototype.hasOwnProperty.call(body.data.answers, "constructor"),
    ).toBe(false);
  });
});
