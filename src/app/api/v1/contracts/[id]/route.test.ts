import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getContract: vi.fn(),
  updateContract: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/contracts", () => ({
  getContract: mocks.getContract,
  updateContract: mocks.updateContract,
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
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: {
      permissions: ["contracts.view", "contracts.manage"],
    },
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(method = "GET", body?: unknown) {
  return new Request("http://localhost/api/v1/contracts/c1", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function params() {
  return { params: Promise.resolve({ id: "c1" }) };
}

const detail = {
  id: "c1",
  title: "Årlig service",
  contractNumber: "A-100",
  status: "ACTIVE",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-12-31T00:00:00.000Z"),
  nextServiceDate: new Date("2026-12-01T00:00:00.000Z"),
  intervalMonths: 12,
  renewalMode: "MANUAL",
  noticeDays: 30,
  indexationPercent: null,
  isActive: true,
  customer: { id: "cust1", name: "Acme AS" },
  department: { id: "dep-a", name: "Øst" },
  contact: null,
  template: null,
  slaPolicy: null,
  priceList: {
    id: "pl1",
    name: "Standard",
    items: [
      {
        id: "i1",
        code: "SVC",
        label: "Service",
        unit: "stk",
        amount: 1250,
      },
    ],
  },
  lines: [],
  workOrders: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.getContract.mockResolvedValue({ ok: true, data: { contract: detail } });
  mocks.updateContract.mockResolvedValue({ ok: true, data: undefined });
});

describe("GET /api/v1/contracts/[id]", () => {
  it("returnerer 404 for ukjent avtale", async () => {
    mocks.getContract.mockResolvedValue({ ok: false, reason: "not_found" });

    const response = await GET(request(), params());
    expect(response.status).toBe(404);
  });

  it("serialiserer detaljer og beløp som visningsstreng", async () => {
    const response = await GET(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "c1",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      priceList: {
        items: [{ code: "SVC", amount: "1250.00" }],
      },
    });
  });
});

describe("PATCH /api/v1/contracts/[id]", () => {
  it("avviser ukjente felter", async () => {
    const response = await PATCH(
      request("PATCH", { customerId: "cust1" }),
      params(),
    );
    expect(response.status).toBe(400);
    expect(mocks.updateContract).not.toHaveBeenCalled();
  });

  it("sender delvis oppdatering til tjenesten", async () => {
    const response = await PATCH(
      request("PATCH", { title: "Nytt navn", renewalMode: "AUTO" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateContract).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "c1",
      { title: "Nytt navn", renewalMode: "AUTO" },
    );
  });

  it("krever contracts.manage", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ roleDefinition: { permissions: ["contracts.view"] } }),
    );

    const response = await PATCH(
      request("PATCH", { title: "X" }),
      params(),
    );
    expect(response.status).toBe(403);
  });
});
