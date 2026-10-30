import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createWorkOrder: vi.fn(),
  prisma: {
    workOrder: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/server/work-orders", () => ({
  createWorkOrder: mocks.createWorkOrder,
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
      permissions: ["workorders.view", "workorders.create"],
    },
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(
  path = "/api/v1/work-orders",
  init?: RequestInit,
) {
  return new Request(`http://localhost${path}`, init);
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return request("/api/v1/work-orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const listRow = {
  id: "wo-1",
  title: "Service av varmepumpe",
  orderNumber: "2026-1042",
  status: "PLANNED",
  scheduledFor: new Date("2026-11-03T00:00:00.000Z"),
  scheduledTo: null,
  customer: { id: "cust-1", name: "Nordlys Eiendom AS" },
  technicians: [{ id: "tech-1", name: "Ola", email: "ola@example.test" }],
  department: { id: "dep-a", name: "Oslo" },
  createdAt: new Date("2026-10-30T08:15:00.000Z"),
  updatedAt: new Date("2026-10-30T09:15:00.000Z"),
  _count: { reports: 2 },
  visits: [
    {
      id: "visit-1",
      workOrderId: "wo-1",
      sequence: 0,
      startsAt: new Date("2026-11-03T09:00:00.000Z"),
      endsAt: new Date("2026-11-03T11:00:00.000Z"),
      allDay: false,
      status: "ASSIGNED",
      notes: null,
      createdAt: new Date("2026-10-30T08:00:00.000Z"),
      updatedAt: new Date("2026-10-30T08:30:00.000Z"),
      technicians: [
        { user: { id: "tech-1", name: "Ola", email: "ola@example.test" } },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.prisma.workOrder.count.mockResolvedValue(0);
  mocks.prisma.workOrder.findMany.mockResolvedValue([]);
  mocks.createWorkOrder.mockResolvedValue({ ok: true, id: "wo-new" });
});

describe("GET /api/v1/work-orders", () => {
  it("returnerer 401 uten gyldig API-nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('{"error":{"code":"unauthorized"}}', {
        status: 401,
      }),
    });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it("nekter aktører uten workorders.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        role: "USER",
        departmentId: null,
        roleDefinition: { permissions: [] },
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
    expect(mocks.prisma.workOrder.findMany).not.toHaveBeenCalled();
  });

  it("avgrenser til avdelingen og kombinerer alle filtre med AND", async () => {
    mocks.prisma.workOrder.count.mockResolvedValue(1);
    mocks.prisma.workOrder.findMany.mockResolvedValue([listRow]);

    const response = await GET(
      request(
        "/api/v1/work-orders?status=PLANNED&customerId=cust-1" +
          "&technicianId=tech-1&q=nordlys&scheduledFrom=2026-11-01" +
          "&scheduledTo=2026-11-30&updatedSince=2026-10-01T00:00:00.000Z" +
          "&page=2&limit=10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: "wo-1",
        title: "Service av varmepumpe",
        orderNumber: "2026-1042",
        status: "PLANNED",
        scheduledFor: "2026-11-03",
        scheduledTo: null,
        customer: { id: "cust-1", name: "Nordlys Eiendom AS" },
        technicians: [
          { id: "tech-1", name: "Ola", email: "ola@example.test" },
        ],
        department: { id: "dep-a", name: "Oslo" },
        reportCount: 2,
        visits: [
          {
            id: "visit-1",
            workOrderId: "wo-1",
            sequence: 0,
            startsAt: "2026-11-03T09:00:00.000Z",
            endsAt: "2026-11-03T11:00:00.000Z",
            allDay: false,
            status: "ASSIGNED",
            notes: null,
            technicians: [
              { id: "tech-1", name: "Ola", email: "ola@example.test" },
            ],
            createdAt: "2026-10-30T08:00:00.000Z",
            updatedAt: "2026-10-30T08:30:00.000Z",
          },
        ],
        sla: null,
        createdAt: "2026-10-30T08:15:00.000Z",
        updatedAt: "2026-10-30T09:15:00.000Z",
      },
    ]);
    expect(body.meta).toEqual({
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    });

    const call = mocks.prisma.workOrder.findMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({
      departmentId: "dep-a",
      department: { isActive: true },
      deletedAt: null,
    });
    expect(call.where.AND).toContainEqual({ status: "PLANNED" });
    expect(call.where.AND).toContainEqual({ customerId: "cust-1" });
    expect(call.where.AND).toContainEqual({
      technicians: { some: { id: "tech-1" } },
    });
    expect(call.where.AND).toContainEqual({
      OR: [
        { title: { contains: "nordlys", mode: "insensitive" } },
        { customer: { name: { contains: "nordlys", mode: "insensitive" } } },
      ],
    });
    expect(call.where.AND).toContainEqual({
      scheduledFor: {
        gte: new Date("2026-11-01T00:00:00.000Z"),
        lte: new Date("2026-11-30T00:00:00.000Z"),
      },
    });
    expect(call.where.AND).toContainEqual({
      updatedAt: { gte: new Date("2026-10-01T00:00:00.000Z") },
    });
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
    expect(call.select.visits).toMatchObject({
      orderBy: [{ sequence: "asc" }, { startsAt: "asc" }],
      take: 20,
    });
  });

  it("kapper limit til 100 og avviser ugyldig status", async () => {
    await GET(request("/api/v1/work-orders?limit=500"));

    expect(mocks.prisma.workOrder.findMany.mock.calls[0][0].take).toBe(100);

    const response = await GET(request("/api/v1/work-orders?status=NOPE"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "status" } },
    });
  });
});

describe("POST /api/v1/work-orders", () => {
  it("oppretter oppdraget og svarer 201 med Location", async () => {
    const response = await POST(
      post({
        title: "Årlig service",
        description: "Kontroller filter og trykk.",
        customerId: "cust-1",
        scheduledFor: "2026-11-12",
        technicianIds: ["tech-1"],
        templateIds: ["tpl-1"],
        tagNames: ["Service"],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      "/api/v1/work-orders/wo-new",
    );
    expect(body).toEqual({ data: { id: "wo-new" } });
    expect(mocks.createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", departmentId: "dep-a" }),
      expect.objectContaining({
        title: "Årlig service",
        description: "Kontroller filter og trykk.",
        customerId: "cust-1",
        scheduledFor: "2026-11-12",
        scheduledTo: "",
        technicianIds: ["tech-1"],
        templateIds: ["tpl-1"],
        tagNames: ["Service"],
      }),
    );
  });

  it("avviser manglende påkrevde felt med 422", async () => {
    const response = await POST(post({ description: "Mangler tittel" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "title" } },
    });
    expect(mocks.createWorkOrder).not.toHaveBeenCalled();
  });

  it("avviser ugyldig JSON og ukjente felt med 400", async () => {
    const invalidJson = await POST(post("{ikke json"));
    expect(invalidJson.status).toBe(400);

    const unknownField = await POST(
      post({ title: "Service", scheduledFor: "2026-11-12", ukjent: true }),
    );
    expect(unknownField.status).toBe(400);
    await expect(unknownField.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "ukjent" } },
    });
  });

  it("returnerer 413 når kroppen er for stor", async () => {
    const response = await POST(
      request("/api/v1/work-orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(JSON_BODY_LIMIT + 1),
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.createWorkOrder).not.toHaveBeenCalled();
  });

  it("nekter aktører uten workorders.create", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        roleDefinition: { permissions: ["workorders.view"] },
      }),
    );

    const response = await POST(
      post({ title: "Service", scheduledFor: "2026-11-12" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.createWorkOrder).not.toHaveBeenCalled();
  });

  it("oversetter duplikat ordrenummer til 409", async () => {
    mocks.createWorkOrder.mockResolvedValue({
      ok: false,
      error: "duplikat-ordrenummer",
    });

    const response = await POST(
      post({
        title: "Service",
        orderNumber: "2026-1042",
        scheduledFor: "2026-11-12",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict" },
    });
  });
});
