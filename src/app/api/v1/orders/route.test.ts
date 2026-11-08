import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createExternalOrder: vi.fn(),
  listExternalOrders: vi.fn(),
  getExternalOrder: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/external-orders", () => ({
  createExternalOrder: mocks.createExternalOrder,
  listExternalOrders: mocks.listExternalOrders,
  getExternalOrder: mocks.getExternalOrder,
}));

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
    permissions: ["workorders.view", "workorders.create", "workorders.update"],
    permissionsCustomized: true,
    roleDefinition: {
      permissions: ["workorders.view", "workorders.create", "workorders.update"],
    },
    ...overrides,
  } as ServiceActor;
}

function request(path = "/api/v1/orders", init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return request("/api/v1/orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const order = {
  id: "eo1",
  source: "erp",
  externalId: "WO-1",
  idempotencyKey: "erp-WO-1",
  priority: "HIGH",
  receivedAt: new Date("2026-11-09T10:00:00.000Z"),
  createdAt: new Date("2026-11-09T10:00:00.000Z"),
  updatedAt: new Date("2026-11-09T10:00:00.000Z"),
  customer: { id: "c1", name: "Nordlys AS" },
  site: null,
  totals: {
    currency: "NOK",
    subtotal: "1250.00",
    vatTotal: "312.50",
    total: "1562.50",
  },
  lines: [
    {
      description: "Service",
      quantity: "1.00",
      unit: "stk",
      unitPrice: "1250.00",
      vatRate: "25.00",
      lineTotal: "1250.00",
      lineVat: "312.50",
    },
  ],
  workOrder: {
    id: "wo1",
    reference: "O-261112-A1B2C3D4",
    orderNumber: null,
    title: "Akutt service",
    status: "PENDING",
    scheduledFor: "2026-11-12",
    scheduledTo: null,
    customerId: "c1",
    department: { id: "dep-a", name: "Oslo" },
  },
};

const validBody = {
  source: "erp",
  externalId: "WO-1",
  customerId: "c1",
  title: "Akutt service",
  requestedDate: "2026-11-12",
  lines: [
    { description: "Service", quantity: "1", unitPrice: "1250", vatRate: "25" },
  ],
  payload: { erpStatus: "CONFIRMED" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    actor: actor(),
    apiKeyId: "key-1",
  });
  mocks.listExternalOrders.mockResolvedValue({
    ok: true,
    data: { orders: [], total: 0 },
  });
  mocks.createExternalOrder.mockResolvedValue({
    ok: true,
    data: { id: "eo1", workOrderId: "wo1", reference: "O-1", replay: false },
  });
  mocks.getExternalOrder.mockResolvedValue({ ok: true, data: order });
});

describe("GET /api/v1/orders", () => {
  it("nekter aktører uten workorders.view", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: true,
      actor: actor({
        role: "TECHNICIAN",
        permissions: [],
        roleDefinition: { permissions: [] },
      }),
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.listExternalOrders).not.toHaveBeenCalled();
  });

  it("filtrerer på kilde og status", async () => {
    await GET(request("/api/v1/orders?source=erp&status=PENDING&page=1&limit=5"));
    expect(mocks.listExternalOrders).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      { page: 1, limit: 5, source: "erp", status: "PENDING" },
    );
  });
});

describe("POST /api/v1/orders", () => {
  it("oppretter ordre med Idempotency-Key og svarer 201", async () => {
    const response = await POST(
      post(validBody, { "idempotency-key": "erp-WO-1" }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("/api/v1/orders/eo1");
    expect(response.headers.get("idempotent-replay")).toBeNull();
    expect(mocks.createExternalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({
        source: "erp",
        externalId: "WO-1",
        idempotencyKey: "erp-WO-1",
        customerId: "c1",
        requestedDate: "2026-11-12",
        priority: undefined,
        payload: { erpStatus: "CONFIRMED" },
      }),
    );
  });

  it("returnerer samme ordre med 200 ved replay", async () => {
    mocks.createExternalOrder.mockResolvedValue({
      ok: true,
      data: { id: "eo1", workOrderId: "wo1", reference: "O-1", replay: true },
    });

    const response = await POST(post(validBody));
    expect(response.status).toBe(200);
    expect(response.headers.get("idempotent-replay")).toBe("true");
    expect((await response.json()).data.id).toBe("eo1");
  });

  it("avviser manglende kunde og kilde", async () => {
    const noCustomer = await POST(
      post({ ...validBody, customerId: undefined }),
    );
    expect(noCustomer.status).toBe(422);

    const noSource = await POST(post({ ...validBody, source: "" }));
    expect(noSource.status).toBe(422);
    expect(mocks.createExternalOrder).not.toHaveBeenCalled();
  });

  it("avviser ukjente felt", async () => {
    const response = await POST(post({ ...validBody, total: "10" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { field: "total" } },
    });
  });

  it("oversetter idempotenskonflikt til 409 med stabil kode", async () => {
    mocks.createExternalOrder.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "orders.idempotencyConflict" },
    });

    const response = await POST(post(validBody));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { code: "orders.idempotencyConflict" } },
    });
  });
});
