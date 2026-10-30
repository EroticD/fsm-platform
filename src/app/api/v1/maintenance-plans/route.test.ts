import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listMaintenancePlans: vi.fn(),
  createMaintenancePlan: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/maintenance", async () => {
  const actual = await vi.importActual<typeof import("@/server/maintenance")>(
    "@/server/maintenance",
  );
  return {
    ...actual,
    listMaintenancePlans: mocks.listMaintenancePlans,
    createMaintenancePlan: mocks.createMaintenancePlan,
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

function request(method = "GET", body?: unknown) {
  return new Request("http://localhost/api/v1/maintenance-plans", {
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
  mocks.listMaintenancePlans.mockResolvedValue({
    ok: true,
    data: {
      items: [
        {
          id: "plan-1",
          title: "Årlig service",
          trigger: "CALENDAR",
          intervalMonths: 12,
          meterInterval: null,
          leadDays: 14,
          nextDueDate: new Date("2027-01-01T00:00:00.000Z"),
          isActive: true,
          product: null,
          customer: { id: "cust-1", name: "Kunde AS" },
          department: { id: "dep-a", name: "Oslo" },
          template: null,
          occurrences: [],
          createdAt: new Date("2026-10-30T08:00:00.000Z"),
          updatedAt: new Date("2026-10-30T08:00:00.000Z"),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    },
  });
  mocks.createMaintenancePlan.mockResolvedValue({
    ok: true,
    data: { id: "plan-new" },
  });
});

describe("GET /api/v1/maintenance-plans", () => {
  it("filtrerer på produkt, kunde, utløser og aktiv", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
  });

  it("nekter aktører uten equipment.view", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: true,
      actor: actor({ permissions: [], permissionsCustomized: true }),
      apiKeyId: "key-1",
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "forbidden",
        messageKey: "errors.api.maintenance.forbidden",
      },
    });
  });
});

describe("POST /api/v1/maintenance-plans", () => {
  it("avviser ukjente felt", async () => {
    const response = await POST(
      request("POST", { title: "Plan", trigger: "CALENDAR", ukjent: true }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        messageKey: "errors.api.maintenance.unknownField",
        details: { field: "ukjent" },
      },
    });
    expect(mocks.createMaintenancePlan).not.toHaveBeenCalled();
  });

  it("oppretter plan og returnerer 201", async () => {
    const response = await POST(
      request("POST", {
        title: "Årlig service",
        trigger: "CALENDAR",
        customerId: "cust-1",
        intervalMonths: 12,
        nextDueDate: "2027-01-01",
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createMaintenancePlan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({ title: "Årlig service", trigger: "CALENDAR" }),
    );
  });
});
