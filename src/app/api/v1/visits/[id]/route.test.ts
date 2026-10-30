import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  assignVisit: vi.fn(),
  deleteVisit: vi.fn(),
  moveVisit: vi.fn(),
  setVisitStatus: vi.fn(),
  updateVisit: vi.fn(),
  prisma: {
    visit: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/server/visits", () => ({
  assignVisit: mocks.assignVisit,
  deleteVisit: mocks.deleteVisit,
  moveVisit: mocks.moveVisit,
  setVisitStatus: mocks.setVisitStatus,
  updateVisit: mocks.updateVisit,
}));

import { DELETE, GET, PATCH } from "./route";

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
    roleDefinition: {
      permissions: [
        "workorders.view",
        "workorders.update",
        "workorders.edit",
        "workorders.assign",
      ],
    },
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(path = "/api/v1/visits/visit-1", init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function patch(body: unknown) {
  return request("/api/v1/visits/visit-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function params(id = "visit-1") {
  return { params: Promise.resolve({ id }) };
}

const detailRow = {
  id: "visit-1",
  workOrderId: "wo-1",
  sequence: 0,
  startsAt: new Date("2026-11-03T09:00:00.000Z"),
  endsAt: new Date("2026-11-03T11:00:00.000Z"),
  allDay: false,
  status: "ASSIGNED",
  notes: "Ta med filter.",
  createdAt: new Date("2026-10-30T08:00:00.000Z"),
  updatedAt: new Date("2026-10-30T09:00:00.000Z"),
  technicians: [
    { user: { id: "tech-1", name: "Ola", email: "ola@example.test" } },
  ],
  workOrder: {
    id: "wo-1",
    title: "Service av varmepumpe",
    orderNumber: "2026-1042",
    status: "PLANNED",
    scheduledFor: new Date("2026-11-03T00:00:00.000Z"),
    scheduledTo: null,
    customer: { id: "cust-1", name: "Nordlys Eiendom AS" },
    department: { id: "dep-a", name: "Oslo" },
  },
};

const expectedScope = {
  departmentId: "dep-a",
  department: { isActive: true },
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.prisma.visit.findFirst.mockResolvedValue(detailRow);
  mocks.assignVisit.mockResolvedValue({ ok: true, data: {} });
  mocks.deleteVisit.mockResolvedValue({ ok: true, data: undefined });
  mocks.moveVisit.mockResolvedValue({ ok: true, data: {} });
  mocks.setVisitStatus.mockResolvedValue({ ok: true, data: {} });
  mocks.updateVisit.mockResolvedValue({ ok: true, data: {} });
});

describe("GET /api/v1/visits/[id]", () => {
  it("returnerer 401 uten gyldig API-nøkkel", async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('{"error":{"code":"unauthorized"}}', {
        status: 401,
      }),
    });

    const response = await GET(request(), params());

    expect(response.status).toBe(401);
    expect(mocks.prisma.visit.findFirst).not.toHaveBeenCalled();
  });

  it("nekter aktører uten workorders.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ roleDefinition: { permissions: [] } }),
    );

    const response = await GET(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.prisma.visit.findFirst).not.toHaveBeenCalled();
  });

  it("returnerer 404 når visitten er ukjent eller utenfor omfanget", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(null);

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
    expect(mocks.prisma.visit.findFirst.mock.calls[0][0].where).toEqual({
      id: "visit-1",
      workOrder: { AND: [expectedScope] },
    });
  });

  it("viser visitt, montører og oppdragssammendrag", async () => {
    const response = await GET(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: "visit-1",
      workOrderId: "wo-1",
      sequence: 0,
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T11:00:00.000Z",
      allDay: false,
      status: "ASSIGNED",
      notes: "Ta med filter.",
      technicians: [
        { id: "tech-1", name: "Ola", email: "ola@example.test" },
      ],
      createdAt: "2026-10-30T08:00:00.000Z",
      updatedAt: "2026-10-30T09:00:00.000Z",
      workOrder: {
        id: "wo-1",
        title: "Service av varmepumpe",
        orderNumber: "2026-1042",
        status: "PLANNED",
        scheduledFor: "2026-11-03",
        scheduledTo: null,
        customer: { id: "cust-1", name: "Nordlys Eiendom AS" },
        department: { id: "dep-a", name: "Oslo" },
      },
    });
  });
});

describe("PATCH /api/v1/visits/[id]", () => {
  it("flytter visitten når startsAt og endsAt sendes sammen", async () => {
    const response = await PATCH(
      patch({
        startsAt: "2026-11-04T09:00:00.000Z",
        endsAt: "2026-11-04T12:00:00.000Z",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.moveVisit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "visit-1",
      {
        startsAt: new Date("2026-11-04T09:00:00.000Z"),
        endsAt: new Date("2026-11-04T12:00:00.000Z"),
      },
    );
    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "visit-1", status: "ASSIGNED" },
    });
  });

  it("endrer status gjennom tjenestelaget", async () => {
    const response = await PATCH(
      patch({ status: "ON_SITE" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.setVisitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "visit-1",
      "ON_SITE",
    );
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("erstatter montørlisten gjennom assignVisit", async () => {
    const response = await PATCH(
      patch({ technicianIds: ["tech-1", "tech-2"] }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.assignVisit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "visit-1",
      ["tech-1", "tech-2"],
    );
  });

  it("oppdaterer metadatafeltene samlet", async () => {
    const response = await PATCH(
      patch({ notes: "Ny beskjed", allDay: true, sequence: 3 }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateVisit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "visit-1",
      { notes: "Ny beskjed", allDay: true, sequence: 3 },
    );
  });

  it("avviser blandede operasjoner med 400", async () => {
    const response = await PATCH(
      patch({ status: "ON_SITE", technicianIds: ["tech-1"] }),
      params(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
    expect(mocks.assignVisit).not.toHaveBeenCalled();
  });

  it("avviser ukjente felt og tom body med 400", async () => {
    const empty = await PATCH(patch({}), params());
    expect(empty.status).toBe(400);

    const unknown = await PATCH(
      patch({ status: "ON_SITE", tittel: "X" }),
      params(),
    );
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "tittel" } },
    });
    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
  });

  it("avviser bare én dato og omvendt tidsrom med 422", async () => {
    const singleDate = await PATCH(
      patch({ startsAt: "2026-11-04T09:00:00.000Z" }),
      params(),
    );
    expect(singleDate.status).toBe(422);
    await expect(singleDate.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        details: {
          field: "endsAt",
          code: "visits.errors.invalidTimeRange",
        },
      },
    });

    const reversed = await PATCH(
      patch({
        startsAt: "2026-11-04T12:00:00.000Z",
        endsAt: "2026-11-04T09:00:00.000Z",
      }),
      params(),
    );
    expect(reversed.status).toBe(422);
    await expect(reversed.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        details: { code: "visits.errors.invalidTimeRange" },
      },
    });
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("avviser ugyldig status med 422", async () => {
    const response = await PATCH(patch({ status: "FERDIG" }), params());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        details: { field: "status", code: "visits.errors.statusTransition" },
      },
    });
    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
  });

  it("nekter operasjoner aktøren ikke har rettighet til", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({ roleDefinition: { permissions: ["workorders.view"] } }),
    );

    const response = await PATCH(patch({ status: "ON_SITE" }), params());

    expect(response.status).toBe(403);
    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
  });

  it("oversetter konflikt og ukjent visitt fra tjenestelaget", async () => {
    mocks.setVisitStatus.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: {
        code: "visits.errors.visitLocked",
      },
    });

    const conflict = await PATCH(patch({ status: "ON_SITE" }), params());
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "conflict",
        details: { code: "visits.errors.visitLocked" },
      },
    });

    mocks.setVisitStatus.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });
    const missing = await PATCH(patch({ status: "ON_SITE" }), params());
    expect(missing.status).toBe(404);
  });
});

describe("DELETE /api/v1/visits/[id]", () => {
  it("sletter visitten og svarer 204 uten body", async () => {
    const response = await DELETE(request(), params());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(mocks.deleteVisit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "visit-1",
    );
  });

  it("oversetter ukjent visitt til 404", async () => {
    mocks.deleteVisit.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });

    const response = await DELETE(request(), params());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("nekter aktører uten workorders.edit", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        roleDefinition: {
          permissions: ["workorders.view", "workorders.assign"],
        },
      }),
    );

    const response = await DELETE(request(), params());

    expect(response.status).toBe(403);
    expect(mocks.deleteVisit).not.toHaveBeenCalled();
  });
});
