import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  prisma: {
    customer: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import { GET as getCustomer } from "./[id]/route";
import { GET as listCustomers } from "./route";

function actor(overrides: Record<string, unknown> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(path = "/api/v1/customers") {
  return new Request(`http://localhost${path}`);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

const listRow = {
  id: "cust1",
  name: "Acme AS",
  customerNumber: "K-100",
  orgNumber: "999888777",
  city: "Oslo",
  phone: "12345678",
  email: "post@acme.test",
  departmentId: "dep-a",
  responsibleTechnician: { id: "tech1", name: "Ola", email: "ola@test" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.prisma.customer.findMany.mockResolvedValue([]);
  mocks.prisma.customer.findFirst.mockResolvedValue(null);
  mocks.prisma.customer.count.mockResolvedValue(0);
});

describe("GET /api/v1/customers", () => {
  it("returnerer 401 når API-nøkkelen mangler eller er ugyldig", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('{"error":{"code":"unauthorized"}}', {
        status: 401,
      }),
    });

    const response = await listCustomers(request());

    expect(response.status).toBe(401);
    expect(mocks.prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it("nekter aktører uten customers.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ role: "USER", departmentId: null }),
    );

    const response = await listCustomers(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
    expect(mocks.prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it("filtrerer på aktive kunder, søkefelt og paginering", async () => {
    mocks.prisma.customer.count.mockResolvedValue(1);
    mocks.prisma.customer.findMany.mockResolvedValue([listRow]);

    const response = await listCustomers(
      request("/api/v1/customers?q=acme&page=2&limit=10"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([listRow]);
    expect(body.meta).toEqual({
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");

    const call = mocks.prisma.customer.findMany.mock.calls[0][0];
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.OR).toEqual([
      { name: { contains: "acme", mode: "insensitive" } },
      { orgNumber: { contains: "acme", mode: "insensitive" } },
      { customerNumber: { contains: "acme", mode: "insensitive" } },
      { city: { contains: "acme", mode: "insensitive" } },
    ]);
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });
});

describe("GET /api/v1/customers/[id]", () => {
  it("returnerer 404 for ukjent eller slettet kunde", async () => {
    const response = await getCustomer(request("/api/v1/customers/cust1"), params("cust1"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("returnerer detaljer uten portalhemmeligheter og med telletall", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue({
      id: "cust1",
      name: "Acme AS",
      customerNumber: "K-100",
      orgNumber: "999888777",
      brandColor: null,
      logoUrl: null,
      address: "Gate 1",
      postalCode: "0100",
      city: "Oslo",
      phone: "12345678",
      email: "post@acme.test",
      notes: "Intern",
      departmentId: "dep-a",
      responsibleTechnicianId: "tech1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      department: { id: "dep-a", name: "Øst", isActive: true },
      responsibleTechnician: { id: "tech1", name: "Ola", email: "ola@test" },
      contacts: [{ id: "c1", name: "Kontakt", email: null, phone: null, role: null }],
      products: [{ id: "p1", model: "Pumpe", serialNumber: "S1", location: "Kjeller" }],
      contracts: [],
      users: [
        {
          id: "portal1",
          name: "Portal",
          email: "portal@test",
          isActive: true,
          contactId: "c1",
          contact: { id: "c1", name: "Kontakt" },
        },
      ],
      _count: {
        contacts: 1,
        products: 1,
        contracts: 0,
        workOrder: 4,
        attachments: 2,
        users: 1,
      },
    });

    const response = await getCustomer(request("/api/v1/customers/cust1"), params("cust1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "cust1",
      users: [{ id: "portal1" }],
      counts: {
        contacts: 1,
        products: 1,
        contracts: 0,
        workOrders: 4,
        attachments: 2,
        portalUsers: 1,
      },
    });
    expect(body.data._count).toBeUndefined();

    // Spørringen skal aldri be om passord, reset-token eller 2FA-felter.
    const call = mocks.prisma.customer.findFirst.mock.calls[0][0];
    expect(call.select.users.select.password).toBeUndefined();
    expect(call.select.users.select.resetToken).toBeUndefined();
    expect(call.select.users.select.twoFactorSecret).toBeUndefined();
    expect(call.select.users.select.twoFactorRecoveryCodes).toBeUndefined();
  });
});
