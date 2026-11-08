import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  listQuotes: vi.fn(),
  createQuote: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/quotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/quotes")>();
  return {
    ...actual,
    listQuotes: mocks.listQuotes,
    createQuote: mocks.createQuote,
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
    customerId: null,
    permissions: ["customers.manage", "customers.view"],
    permissionsCustomized: true,
    roleDefinition: { permissions: ["customers.manage", "customers.view"] },
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(path = "/api/v1/quotes", init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function post(body: unknown) {
  return request("/api/v1/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const listRow = {
  id: "q1",
  quoteNumber: "T-261109-AB12CD",
  title: "Tilbud",
  status: "DRAFT",
  version: 1,
  total: { toString: () => "2687.50" },
  validUntil: new Date("2026-12-31T00:00:00.000Z"),
  updatedAt: new Date("2026-11-09T10:00:00.000Z"),
  customer: { id: "c1", name: "Nordlys AS" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.listQuotes.mockResolvedValue({ ok: true, data: { quotes: [], total: 0 } });
  mocks.createQuote.mockResolvedValue({ ok: true, data: { id: "q-new" } });
});

describe("GET /api/v1/quotes", () => {
  it("returnerer 401 uten gyldig nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response("{}", { status: 401 }),
    });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.listQuotes).not.toHaveBeenCalled();
  });

  it("nekter aktører uten tilgang til tilbud", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        role: "TECHNICIAN",
        permissions: [],
        roleDefinition: { permissions: [] },
      }),
    );
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.listQuotes).not.toHaveBeenCalled();
  });

  it("videresender filtre og returnerer paginert liste", async () => {
    mocks.listQuotes.mockResolvedValue({
      ok: true,
      data: { quotes: [listRow], total: 1 },
    });

    const response = await GET(
      request(
        "/api/v1/quotes?status=DRAFT&customerId=c1&q=nordlys&page=2&limit=10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listQuotes).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      {
        page: 2,
        pageSize: 10,
        status: "DRAFT",
        customerId: "c1",
        query: "nordlys",
      },
    );
    expect(body.data[0]).toMatchObject({
      id: "q1",
      total: "2687.50",
      validUntil: "2026-12-31",
      updatedAt: "2026-11-09T10:00:00.000Z",
    });
    expect(body.meta).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it("avviser ugyldig statusfilter", async () => {
    const response = await GET(request("/api/v1/quotes?status=NOPE"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "status" } },
    });
  });
});

describe("POST /api/v1/quotes", () => {
  it("oppretter tilbud og returnerer Location", async () => {
    const response = await POST(
      post({
        title: "Service",
        customerId: "c1",
        lines: [
          { description: "Arbeid", quantity: "2", unitPrice: "950" },
        ],
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("/api/v1/quotes/q-new");
    expect(mocks.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      expect.objectContaining({
        title: "Service",
        customerId: "c1",
        lines: [{ description: "Arbeid", quantity: "2", unitPrice: "950" }],
      }),
    );
  });

  it("avviser klientberegnede totaler som ukjent felt", async () => {
    const response = await POST(
      post({
        title: "Service",
        lines: [{ description: "Arbeid", quantity: "1", unitPrice: "10" }],
        total: "1.00",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { field: "total" } },
    });
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("avviser manglende linjer med 422", async () => {
    const response = await POST(post({ title: "Service", lines: [] }));
    expect(response.status).toBe(422);
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("nekter aktører uten customers.manage", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        permissions: ["customers.view"],
        roleDefinition: { permissions: ["customers.view"] },
      }),
    );
    const response = await POST(
      post({
        title: "Service",
        lines: [{ description: "Arbeid", quantity: "1", unitPrice: "10" }],
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("oversetter tjenestefeil til stabile HTTP-koder", async () => {
    mocks.createQuote.mockResolvedValue({ ok: false, reason: "conflict" });
    const response = await POST(
      post({
        title: "Service",
        lines: [{ description: "Arbeid", quantity: "1", unitPrice: "10" }],
      }),
    );
    expect(response.status).toBe(409);
  });
});
