import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));

import { GET } from "./route";

function actor(overrides: Record<string, unknown> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari Nordmann",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: {
      permissions: ["workorders.view", "customers.view"],
    },
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    actor: {
      ...actor(overrides),
      department: { id: "dep-a", name: "Oslo", isActive: true },
    },
    apiKeyId: "key-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
});

describe("GET /api/v1/me", () => {
  it("returnerer 401 uten gyldig API-nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('{"error":{"code":"unauthorized"}}', {
        status: 401,
      }),
    });

    const response = await GET(new Request("http://localhost/api/v1/me"));

    expect(response.status).toBe(401);
  });

  it("viser identitet, avdeling og effektive rettigheter", async () => {
    const response = await GET(new Request("http://localhost/api/v1/me"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        id: "u1",
        name: "Kari Nordmann",
        email: "kari@example.test",
        role: "OFFICE",
        department: { id: "dep-a", name: "Oslo" },
        permissions: ["workorders.view", "customers.view"],
        customerId: null,
      },
    });
  });

  it("bruker tilpassede rettigheter og kundeportalens kunde-id", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        role: "CUSTOMER",
        customerId: "cust-1",
        departmentId: null,
        permissionsCustomized: true,
        permissions: ["workorders.view"],
      }),
    );

    const response = await GET(new Request("http://localhost/api/v1/me"));
    const body = await response.json();

    expect(body.data.permissions).toEqual(["workorders.view"]);
    expect(body.data.customerId).toBe("cust-1");
    expect(body.data.department).toEqual({ id: "dep-a", name: "Oslo" });
  });
});
