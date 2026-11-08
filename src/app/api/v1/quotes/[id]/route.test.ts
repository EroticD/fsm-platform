import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getQuote: vi.fn(),
  updateQuote: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/quotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/quotes")>();
  return {
    ...actual,
    getQuote: mocks.getQuote,
    updateQuote: mocks.updateQuote,
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
    customerId: null,
    permissions: ["customers.manage", "customers.view"],
    permissionsCustomized: true,
    roleDefinition: { permissions: ["customers.manage", "customers.view"] },
    ...overrides,
  } as ServiceActor;
}

function request(init?: RequestInit) {
  return new Request("http://localhost/api/v1/quotes/q1", init);
}

const quote = {
  id: "q1",
  quoteNumber: "T-261109-AB12CD",
  title: "Tilbud",
  status: "DRAFT",
  version: 1,
  customerId: "c1",
  customerName: null,
  contactId: null,
  workOrderId: null,
  contractId: null,
  productId: null,
  departmentId: "dep-a",
  currency: "NOK",
  subtotal: { toString: () => "2150.00" },
  vatTotal: { toString: () => "537.50" },
  total: { toString: () => "2687.50" },
  vatRate: { toString: () => "25.00" },
  validUntil: new Date("2026-12-31T00:00:00.000Z"),
  notes: null,
  customer: { id: "c1", name: "Nordlys AS" },
  contact: null,
  workOrder: null,
  contract: null,
  product: null,
  department: { id: "dep-a", name: "Oslo" },
  lines: [
    {
      id: "l1",
      sortOrder: 0,
      description: "Arbeid",
      quantity: { toString: () => "2.00" },
      unit: "time",
      unitPrice: { toString: () => "950.00" },
      vatRate: { toString: () => "25.00" },
      lineTotal: { toString: () => "1900.00" },
      lineVat: { toString: () => "475.00" },
    },
  ],
  versions: [
    {
      id: "v1",
      version: 1,
      status: "DRAFT",
      total: { toString: () => "2687.50" },
      createdAt: new Date("2026-11-09T10:00:00.000Z"),
    },
  ],
  invoices: [],
  sentAt: null,
  acceptedAt: null,
  rejectedAt: null,
  convertedWorkOrderId: null,
  createdAt: new Date("2026-11-09T10:00:00.000Z"),
  updatedAt: new Date("2026-11-09T10:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    actor: actor(),
    apiKeyId: "key-1",
  });
  mocks.getQuote.mockResolvedValue({ ok: true, data: quote });
  mocks.updateQuote.mockResolvedValue({ ok: true, data: { id: "q1" } });
});

describe("GET /api/v1/quotes/{id}", () => {
  it("returnerer serverberegnede totaler som desimalstrenger", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ id: "q1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "q1",
      subtotal: "2150.00",
      vatTotal: "537.50",
      total: "2687.50",
      validUntil: "2026-12-31",
    });
    expect(body.data.lines[0]).toMatchObject({
      quantity: "2.00",
      unitPrice: "950.00",
      lineTotal: "1900.00",
    });
  });

  it("gir 404 når tilbudet er utenfor omfanget", async () => {
    mocks.getQuote.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await GET(request(), {
      params: Promise.resolve({ id: "q1" }),
    });
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/v1/quotes/{id}", () => {
  it("bevarer linjer og kunde når bare tittel sendes", async () => {
    const response = await PATCH(
      request({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Nytt navn" }),
      }),
      { params: Promise.resolve({ id: "q1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateQuote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "q1",
      expect.objectContaining({
        title: "Nytt navn",
        customerId: "c1",
        validUntil: "2026-12-31",
        lines: [
          {
            description: "Arbeid",
            quantity: "2.00",
            unit: "time",
            unitPrice: "950.00",
            vatRate: "25.00",
          },
        ],
      }),
    );
  });

  it("avviser tom body og ukjente felt", async () => {
    const empty = await PATCH(
      request({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: "q1" }) },
    );
    expect(empty.status).toBe(400);

    const unknown = await PATCH(
      request({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ total: "0" }),
      }),
      { params: Promise.resolve({ id: "q1" }) },
    );
    expect(unknown.status).toBe(400);
    expect(mocks.updateQuote).not.toHaveBeenCalled();
  });

  it("oversetter låst tilbud til 409", async () => {
    mocks.updateQuote.mockResolvedValue({ ok: false, reason: "conflict" });
    const response = await PATCH(
      request({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Nytt navn" }),
      }),
      { params: Promise.resolve({ id: "q1" }) },
    );
    expect(response.status).toBe(409);
  });
});
