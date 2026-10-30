import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listEquipment: vi.fn(),
  createEquipment: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/equipment", async () => {
  const actual = await vi.importActual<typeof import("@/server/equipment")>(
    "@/server/equipment",
  );
  return {
    ...actual,
    listEquipment: mocks.listEquipment,
    createEquipment: mocks.createEquipment,
  };
});

import { GET, POST } from "./route";

function actor(overrides: Record<string, unknown> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissionsCustomized: true,
    permissions: ["equipment.view", "equipment.manage"],
    roleDefinition: null,
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(path = "/api/v1/equipment", init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function post(body: unknown) {
  return request("/api/v1/equipment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const row = {
  id: "prod-1",
  model: "Pumpe",
  serialNumber: "SN-1",
  location: "Kjeller",
  status: "ACTIVE",
  criticality: 2,
  meterUnit: "timer",
  installDate: new Date("2025-01-01T00:00:00.000Z"),
  warrantyUntil: new Date("2027-01-01T00:00:00.000Z"),
  qrToken: "abcdefghijklmnopqrstuvwx",
  customer: { id: "cust-1", name: "Kunde AS" },
  category: { id: "cat-1", name: "Pumper" },
  parent: null,
  createdAt: new Date("2026-10-30T08:00:00.000Z"),
  updatedAt: new Date("2026-10-30T08:00:00.000Z"),
  _count: {
    children: 0,
    meterReadings: 2,
    maintenancePlans: 1,
    reportUnits: 3,
    workOrder: 4,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.listEquipment.mockResolvedValue({
    ok: true,
    data: { items: [row], total: 1, page: 1, pageSize: 50, totalPages: 1 },
  });
  mocks.createEquipment.mockResolvedValue({
    ok: true,
    data: { id: "prod-new" },
  });
});

describe("GET /api/v1/equipment", () => {
  it("returnerer 401 uten gyldig nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response("{}", { status: 401 }),
    });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.listEquipment).not.toHaveBeenCalled();
  });

  it("nekter aktører uten equipment.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ permissions: [], permissionsCustomized: true }),
    );
    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("sender søk, filtre og paginering videre", async () => {
    const response = await GET(
      request(
        "/api/v1/equipment?q=pumpe&status=ACTIVE&categoryId=cat-1&customerId=cust-1&page=2&limit=10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      id: "prod-1",
      model: "Pumpe",
      installDate: "2025-01-01",
      warrantyUntil: "2027-01-01",
      counts: {
        meterReadings: 2,
        maintenancePlans: 1,
        reports: 3,
        workOrders: 4,
      },
    });
    expect(body.meta).toEqual({
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });
    expect(mocks.listEquipment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({
        q: "pumpe",
        status: "ACTIVE",
        categoryId: "cat-1",
        customerId: "cust-1",
        page: 2,
        limit: 10,
      }),
    );
  });
});

describe("POST /api/v1/equipment", () => {
  it("avviser ukjente felt", async () => {
    const response = await POST(post({ customerId: "c", model: "M", ukjent: true }));
    expect(response.status).toBe(422);
    expect(mocks.createEquipment).not.toHaveBeenCalled();
  });

  it("oppretter enhet og returnerer 201", async () => {
    const response = await POST(
      post({ customerId: "cust-1", model: "Pumpe", criticality: 1 }),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { id: "prod-new" } });
    expect(mocks.createEquipment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({ customerId: "cust-1", model: "Pumpe" }),
    );
  });

  it("mapper tjenestefeil til stabil kode", async () => {
    mocks.createEquipment.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.hierarchyCycle" },
    });
    const response = await POST(post({ customerId: "c", model: "M" }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.details).toEqual({
      code: "equipment.errors.hierarchyCycle",
    });
  });
});
