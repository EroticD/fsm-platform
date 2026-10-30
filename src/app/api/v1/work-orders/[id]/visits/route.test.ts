import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createVisit: vi.fn(),
  prisma: {
    workOrder: { findFirst: vi.fn() },
    visit: { count: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/server/visits", () => ({
  createVisit: mocks.createVisit,
}));

import { JSON_BODY_LIMIT } from "@/lib/request-body";
import { GET, POST } from "./route";

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
    roleDefinition: {
      permissions: ["workorders.view", "workorders.edit"],
    },
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(path = "/api/v1/work-orders/wo-1/visits", init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return request("/api/v1/work-orders/wo-1/visits", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function params(id = "wo-1") {
  return { params: Promise.resolve({ id }) };
}

const visitRow = {
  id: "visit-1",
  workOrderId: "wo-1",
  sequence: 0,
  startsAt: new Date("2026-11-03T09:00:00.000Z"),
  endsAt: new Date("2026-11-03T11:00:00.000Z"),
  allDay: false,
  status: "PLANNED",
  notes: null,
  createdAt: new Date("2026-10-30T08:00:00.000Z"),
  updatedAt: new Date("2026-10-30T08:00:00.000Z"),
  technicians: [
    { user: { id: "tech-1", name: "Ola", email: "ola@example.test" } },
  ],
};

const expectedScope = {
  departmentId: "dep-a",
  department: { isActive: true },
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.prisma.workOrder.findFirst.mockResolvedValue({ id: "wo-1" });
  mocks.prisma.visit.count.mockResolvedValue(0);
  mocks.prisma.visit.findMany.mockResolvedValue([]);
  mocks.createVisit.mockResolvedValue({ ok: true, data: { id: "visit-new" } });
});

describe("GET /api/v1/work-orders/[id]/visits", () => {
  it("returnerer 401 uten gyldig API-nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('{"error":{"code":"unauthorized"}}', {
        status: 401,
      }),
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(401);
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
  });

  it("nekter aktører uten workorders.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ roleDefinition: { permissions: ["workorders.edit"] } }),
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
  });

  it("returnerer 404 når oppdraget er utenfor omfanget", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(null);

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.prisma.workOrder.findFirst.mock.calls[0][0].where).toEqual({
      id: "wo-1",
      AND: [expectedScope],
    });
    expect(mocks.prisma.visit.findMany).not.toHaveBeenCalled();
  });

  it("lister visiter sortert på startsAt med paginering og avdelingsscope", async () => {
    mocks.prisma.visit.count.mockResolvedValue(1);
    mocks.prisma.visit.findMany.mockResolvedValue([visitRow]);

    const response = await GET(
      request("/api/v1/work-orders/wo-1/visits?page=2&limit=10"),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: "visit-1",
        workOrderId: "wo-1",
        sequence: 0,
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T11:00:00.000Z",
        allDay: false,
        status: "PLANNED",
        notes: null,
        technicians: [
          { id: "tech-1", name: "Ola", email: "ola@example.test" },
        ],
        createdAt: "2026-10-30T08:00:00.000Z",
        updatedAt: "2026-10-30T08:00:00.000Z",
      },
    ]);
    expect(body.meta).toEqual({
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    });

    const call = mocks.prisma.visit.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      workOrderId: "wo-1",
      workOrder: { AND: [expectedScope] },
    });
    expect(call.orderBy).toEqual([
      { startsAt: "asc" },
      { sequence: "asc" },
      { id: "asc" },
    ]);
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });

  it("kapper limit til API-ets maksimum på 100", async () => {
    await GET(request("/api/v1/work-orders/wo-1/visits?limit=500"), params());

    expect(mocks.prisma.visit.findMany.mock.calls[0][0].take).toBe(100);
  });
});

describe("POST /api/v1/work-orders/[id]/visits", () => {
  it("oppretter visitten og svarer 201 med Location", async () => {
    const response = await POST(
      post({
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T11:00:00.000Z",
        allDay: false,
        technicianIds: ["tech-1"],
        notes: "Ta med filter.",
        sequence: 2,
      }),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("/api/v1/visits/visit-new");
    expect(body).toEqual({ data: { id: "visit-new" } });
    expect(mocks.createVisit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", departmentId: "dep-a" }),
      {
        workOrderId: "wo-1",
        startsAt: new Date("2026-11-03T09:00:00.000Z"),
        endsAt: new Date("2026-11-03T11:00:00.000Z"),
        allDay: false,
        technicianIds: ["tech-1"],
        notes: "Ta med filter.",
        sequence: 2,
      },
    );
  });

  it("avviser ukjente felt med 400", async () => {
    const response = await POST(
      post({
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T11:00:00.000Z",
        tittel: "X",
      }),
      params(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "tittel" } },
    });
    expect(mocks.createVisit).not.toHaveBeenCalled();
  });

  it("avviser ugyldige og omvendte tidsrom med 422", async () => {
    const badDate = await POST(
      post({
        startsAt: "03.11.2026 09:00",
        endsAt: "2026-11-03T11:00:00.000Z",
      }),
      params(),
    );
    expect(badDate.status).toBe(422);
    await expect(badDate.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "startsAt" } },
    });

    const reversed = await POST(
      post({
        startsAt: "2026-11-03T11:00:00.000Z",
        endsAt: "2026-11-03T09:00:00.000Z",
      }),
      params(),
    );
    expect(reversed.status).toBe(422);
    await expect(reversed.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        details: { code: "visits.errors.invalidTimeRange" },
      },
    });
    expect(mocks.createVisit).not.toHaveBeenCalled();
  });

  it("returnerer 413 når kroppen er for stor", async () => {
    const response = await POST(
      request("/api/v1/work-orders/wo-1/visits", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(JSON_BODY_LIMIT + 1),
        },
        body: "{}",
      }),
      params(),
    );

    expect(response.status).toBe(413);
    expect(mocks.createVisit).not.toHaveBeenCalled();
  });

  it("nekter aktører uten workorders.edit", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ roleDefinition: { permissions: ["workorders.view"] } }),
    );

    const response = await POST(
      post({
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T11:00:00.000Z",
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(mocks.createVisit).not.toHaveBeenCalled();
  });

  it("oversetter overlapp til 409 med tjenestens detaljer", async () => {
    mocks.createVisit.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: {
        code: "visits.errors.overlap",
        conflicts: [{ visitId: "visit-2", technicianIds: ["tech-1"] }],
      },
    });

    const response = await POST(
      post({
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T11:00:00.000Z",
        technicianIds: ["tech-1"],
      }),
      params(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "conflict",
        details: {
          code: "visits.errors.overlap",
          conflicts: [{ visitId: "visit-2" }],
        },
      },
    });
  });

  it("oversetter ukjent oppdrag til 404", async () => {
    mocks.createVisit.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });

    const response = await POST(
      post({
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T11:00:00.000Z",
      }),
      params(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });
});
