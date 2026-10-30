import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listMeterReadings: vi.fn(),
  addMeterReading: vi.fn(),
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
    listMeterReadings: mocks.listMeterReadings,
    addMeterReading: mocks.addMeterReading,
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

const params = { params: Promise.resolve({ id: "prod-1" }) };

function request(method = "GET", body?: unknown) {
  return new Request("http://localhost/api/v1/equipment/prod-1/meters", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    actor: actor(),
    apiKeyId: "key-1",
  });
  mocks.listMeterReadings.mockResolvedValue({
    ok: true,
    data: {
      items: [
        {
          id: "reading-1",
          productId: "prod-1",
          value: { toString: () => "123.45" },
          readAt: new Date("2026-10-30T10:00:00.000Z"),
          source: "MANUAL",
          note: null,
          user: null,
          createdAt: new Date("2026-10-30T10:00:00.000Z"),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    },
  });
  mocks.addMeterReading.mockResolvedValue({
    ok: true,
    data: { id: "reading-new" },
  });
});

describe("GET /api/v1/equipment/{id}/meters", () => {
  it("returnerer målinger med paginering", async () => {
    const response = await GET(request(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      id: "reading-1",
      value: "123.45",
      source: "MANUAL",
    });
    expect(body.meta).toMatchObject({ total: 1, limit: 50 });
  });
});

describe("POST /api/v1/equipment/{id}/meters", () => {
  it("avviser ukjente felt", async () => {
    const response = await POST(request("POST", { value: 1, ukjent: true }), params);
    expect(response.status).toBe(422);
    expect(mocks.addMeterReading).not.toHaveBeenCalled();
  });

  it("registrerer måling og returnerer 201", async () => {
    const response = await POST(
      request("POST", { value: 1200, readAt: "2026-10-30", source: "MANUAL" }),
      params,
    );
    expect(response.status).toBe(201);
    expect(mocks.addMeterReading).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "prod-1",
      expect.objectContaining({ value: 1200 }),
    );
  });

  it("returnerer 409 med stabil feilkode", async () => {
    mocks.addMeterReading.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.retired" },
    });
    const response = await POST(
      request("POST", { value: 1, readAt: "2026-10-30" }),
      params,
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.details.code).toBe("equipment.errors.retired");
  });
});
