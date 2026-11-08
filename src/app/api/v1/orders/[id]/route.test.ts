import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getExternalOrder: vi.fn(),
  updateExternalOrder: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/external-orders", () => ({
  getExternalOrder: mocks.getExternalOrder,
  updateExternalOrder: mocks.updateExternalOrder,
}));

import { GET, PATCH } from "./route";

function actor(overrides: Record<string, unknown> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: ["workorders.view", "workorders.update", "workorders.edit"],
    permissionsCustomized: true,
    roleDefinition: {
      permissions: ["workorders.view", "workorders.update", "workorders.edit"],
    },
    ...overrides,
  } as ServiceActor;
}

const detail = {
  id: "eo1",
  source: "erp",
  externalId: "WO-1",
  idempotencyKey: null,
  priority: null,
  receivedAt: new Date("2026-11-09T10:00:00.000Z"),
  createdAt: new Date("2026-11-09T10:00:00.000Z"),
  updatedAt: new Date("2026-11-09T10:00:00.000Z"),
  customer: null,
  site: null,
  totals: { currency: "NOK", subtotal: "0.00", vatTotal: "0.00", total: "0.00" },
  lines: [],
  workOrder: {
    id: "wo1",
    reference: "O-1",
    orderNumber: null,
    title: "Service",
    status: "CANCELLED",
    scheduledFor: null,
    scheduledTo: null,
    customerId: null,
    department: { id: "dep-a", name: "Oslo" },
  },
  payload: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    actor: actor(),
    apiKeyId: "key-1",
  });
  mocks.getExternalOrder.mockResolvedValue({ ok: true, data: detail });
  mocks.updateExternalOrder.mockResolvedValue({ ok: true, data: detail });
});

describe("GET /api/v1/orders/{id}", () => {
  it("gir 404 utenfor omfanget", async () => {
    mocks.getExternalOrder.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });
    const response = await GET(
      new Request("http://localhost/api/v1/orders/eo1"),
      { params: Promise.resolve({ id: "eo1" }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/v1/orders/{id}", () => {
  it("kansellerer med cancel: true", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/v1/orders/eo1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancel: true, reason: "Avbestilt" }),
      }),
      { params: Promise.resolve({ id: "eo1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateExternalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "eo1",
      { status: "CANCELLED", reason: "Avbestilt" },
    );
  });

  it("avviser status og cancel samtidig", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/v1/orders/eo1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS", cancel: true }),
      }),
      { params: Promise.resolve({ id: "eo1" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.updateExternalOrder).not.toHaveBeenCalled();
  });

  it("nekter aktører uten workorders.update", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: true,
      actor: actor({
        permissions: ["workorders.view"],
        roleDefinition: { permissions: ["workorders.view"] },
      }),
      apiKeyId: "key-1",
    });
    const response = await PATCH(
      new Request("http://localhost/api/v1/orders/eo1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      }),
      { params: Promise.resolve({ id: "eo1" }) },
    );
    expect(response.status).toBe(403);
  });
});
