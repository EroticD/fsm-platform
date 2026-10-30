import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getEquipment: vi.fn(),
  updateEquipment: vi.fn(),
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
    getEquipment: mocks.getEquipment,
    updateEquipment: mocks.updateEquipment,
  };
});

import { GET, PATCH } from "./route";

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

const params = (id = "prod-1") => ({ params: Promise.resolve({ id }) });

function request(method = "GET", body?: unknown) {
  return new Request("http://localhost/api/v1/equipment/prod-1", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const detail = {
  equipment: {
    id: "prod-1",
    model: "Pumpe",
    serialNumber: "SN-1",
    location: "Kjeller",
    status: "ACTIVE",
    criticality: 2,
    meterUnit: "timer",
    installDate: new Date("2025-01-01T00:00:00.000Z"),
    warrantyUntil: new Date("2027-01-01T00:00:00.000Z"),
    warrantyNotifiedAt: null,
    qrToken: "abcdefghijklmnopqrstuvwx",
    customer: { id: "cust-1", name: "Kunde AS" },
    category: { id: "cat-1", name: "Pumper" },
    parent: null,
    children: [],
    _count: {
      children: 0,
      meterReadings: 1,
      maintenancePlans: 1,
      reportUnits: 1,
      workOrder: 1,
    },
    meterReadings: [
      {
        id: "reading-1",
        value: { toString: () => "123.45" },
        readAt: new Date("2026-10-30T10:00:00.000Z"),
        source: "MANUAL",
        note: null,
        user: null,
        createdAt: new Date("2026-10-30T10:00:00.000Z"),
      },
    ],
    maintenancePlans: [
      {
        id: "plan-1",
        title: "Årlig service",
        trigger: "CALENDAR",
        intervalMonths: 12,
        meterInterval: null,
        leadDays: 14,
        nextDueDate: new Date("2027-01-01T00:00:00.000Z"),
        isActive: true,
        occurrences: [],
      },
    ],
    workOrder: [],
    reportUnits: [],
    createdAt: new Date("2026-10-01T08:00:00.000Z"),
    updatedAt: new Date("2026-10-02T08:00:00.000Z"),
  },
  uploads: [],
  ancestors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.getEquipment.mockResolvedValue({ ok: true, data: detail });
  mocks.updateEquipment.mockResolvedValue({
    ok: true,
    data: { id: "prod-1" },
  });
});

describe("GET /api/v1/equipment/{id}", () => {
  it("returnerer detaljer med målinger og planer", async () => {
    const response = await GET(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "prod-1",
      installDate: "2025-01-01",
      meterReadings: [{ value: "123.45" }],
      maintenancePlans: [
        { id: "plan-1", nextDueDate: "2027-01-01", intervalMonths: 12 },
      ],
    });
  });

  it("returnerer 404 når enheten ikke finnes", async () => {
    mocks.getEquipment.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await GET(request(), params("mangler"));
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/v1/equipment/{id}", () => {
  it("avviser ukjente felt", async () => {
    const response = await PATCH(request("PATCH", { ukjent: 1 }), params());
    expect(response.status).toBe(422);
    expect(mocks.updateEquipment).not.toHaveBeenCalled();
  });

  it("sender bare kjente felt videre og returnerer id", async () => {
    const response = await PATCH(
      request("PATCH", { status: "OUT_OF_SERVICE", parentId: null }),
      params(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { id: "prod-1" },
    });
    expect(mocks.updateEquipment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      { id: "prod-1", status: "OUT_OF_SERVICE", parentId: null },
    );
  });
});
