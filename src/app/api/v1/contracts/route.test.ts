import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listContracts: vi.fn(),
  createContract: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/contracts", () => ({
  listContracts: mocks.listContracts,
  createContract: mocks.createContract,
  isContractStatus: (value: string) =>
    ["DRAFT", "ACTIVE", "PAUSED", "EXPIRED", "TERMINATED"].includes(value),
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

function request(path = "/api/v1/contracts", init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

const contractRow = {
  id: "c1",
  title: "Årlig service",
  contractNumber: "A-100",
  status: "ACTIVE",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: null,
  nextServiceDate: new Date("2026-12-01T00:00:00.000Z"),
  intervalMonths: 12,
  renewalMode: "MANUAL",
  noticeDays: 30,
  customer: { id: "cust1", name: "Acme AS" },
  department: { id: "dep-a", name: "Øst" },
  slaPolicy: { id: "p1", name: "Standard" },
  priceList: null,
  _count: { lines: 2, workOrders: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.listContracts.mockResolvedValue({
    ok: true,
    data: { contracts: [], total: 0, page: 1, pageSize: 25 },
  });
  mocks.createContract.mockResolvedValue({ ok: true, data: { id: "c-new" } });
});

describe("GET /api/v1/contracts", () => {
  it("returnerer 401 uten gyldig API-nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response("{}", { status: 401 }),
    });

    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.listContracts).not.toHaveBeenCalled();
  });

  it("nekter aktører uten contracts.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ roleDefinition: { permissions: [] } }),
    );

    const response = await GET(request());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("serialiserer avtaler og paginering", async () => {
    mocks.listContracts.mockResolvedValue({
      ok: true,
      data: {
        contracts: [contractRow],
        total: 1,
        page: 2,
        pageSize: 10,
      },
    });

    const response = await GET(
      request("/api/v1/contracts?status=ACTIVE&page=2&limit=10&q=acme"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      id: "c1",
      status: "ACTIVE",
      startDate: "2026-01-01",
      endDate: null,
      lineCount: 2,
      workOrderCount: 3,
    });
    expect(body.meta).toEqual({
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    });
    const call = mocks.listContracts.mock.calls[0][1];
    expect(call).toMatchObject({
      status: "ACTIVE",
      query: "acme",
      page: 2,
      pageSize: 10,
    });
  });

  it("avviser ugyldig statusfilter", async () => {
    const response = await GET(request("/api/v1/contracts?status=NOPE"));
    expect(response.status).toBe(400);
    expect(mocks.listContracts).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/contracts", () => {
  it("krever contracts.manage", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ roleDefinition: { permissions: ["contracts.view"] } }),
    );

    const response = await POST(
      request("/api/v1/contracts", {
        method: "POST",
        body: JSON.stringify({ customerId: "cust1", title: "X" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.createContract).not.toHaveBeenCalled();
  });

  it("avviser ukjente felter og manglende customerId", async () => {
    const unknown = await POST(
      request("/api/v1/contracts", {
        method: "POST",
        body: JSON.stringify({ customerId: "cust1", farge: "blå" }),
      }),
    );
    expect(unknown.status).toBe(400);

    const missing = await POST(
      request("/api/v1/contracts", {
        method: "POST",
        body: JSON.stringify({ title: "X" }),
      }),
    );
    expect(missing.status).toBe(422);
  });

  it("oppretter avtalen og setter Location", async () => {
    const response = await POST(
      request("/api/v1/contracts", {
        method: "POST",
        body: JSON.stringify({
          customerId: "cust1",
          title: "Årlig service",
          startDate: "2026-01-01",
          intervalMonths: 12,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      "/api/v1/contracts/c-new",
    );
    expect(mocks.createContract).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "cust1",
      expect.objectContaining({ title: "Årlig service" }),
    );
  });
});
