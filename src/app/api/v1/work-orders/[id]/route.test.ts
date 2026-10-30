import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  changeWorkOrderStatus: vi.fn(),
  updateWorkOrderDate: vi.fn(),
  prisma: {
    workOrder: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/server/work-orders", () => ({
  changeWorkOrderStatus: mocks.changeWorkOrderStatus,
  updateWorkOrderDate: mocks.updateWorkOrderDate,
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
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: {
      permissions: ["workorders.view", "workorders.update"],
    },
    ...overrides,
  } as ServiceActor;
}

function authenticated(overrides: Record<string, unknown> = {}) {
  return { ok: true as const, actor: actor(overrides), apiKeyId: "key-1" };
}

function request(path = "/api/v1/work-orders/wo-1", init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

function patch(body: unknown) {
  return request("/api/v1/work-orders/wo-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const summaryRow = {
  id: "wo-1",
  title: "Service av varmepumpe",
  orderNumber: "2026-1042",
  status: "IN_PROGRESS",
  scheduledFor: new Date("2026-11-14T00:00:00.000Z"),
  scheduledTo: new Date("2026-11-15T00:00:00.000Z"),
  customer: { id: "cust-1", name: "Nordlys Eiendom AS" },
  technicians: [{ id: "tech-1", name: "Ola", email: "ola@example.test" }],
  department: { id: "dep-a", name: "Oslo" },
  createdAt: new Date("2026-10-30T08:15:00.000Z"),
  updatedAt: new Date("2026-10-30T09:15:00.000Z"),
  _count: { reports: 1 },
  visits: [
    {
      id: "visit-1",
      workOrderId: "wo-1",
      sequence: 0,
      startsAt: new Date("2026-11-14T09:00:00.000Z"),
      endsAt: new Date("2026-11-14T11:00:00.000Z"),
      allDay: false,
      status: "ASSIGNED",
      notes: null,
      createdAt: new Date("2026-10-30T08:00:00.000Z"),
      updatedAt: new Date("2026-10-30T08:30:00.000Z"),
      technicians: [
        { user: { id: "tech-1", name: "Ola", email: "ola@example.test" } },
      ],
    },
  ],
};

const detailRow = {
  ...summaryRow,
  description: "Kontroller filter.",
  address: "Gate 1",
  postalCode: "0100",
  city: "Oslo",
  contact: {
    id: "contact-1",
    name: "Kontakt",
    email: "kontakt@example.test",
    phone: "12345678",
  },
  tags: [{ id: "tag-1", name: "Service", color: "#3b82f6" }],
  templates: [{ id: "tpl-1", title: "Serviceskjema" }],
  reports: [
    {
      id: "rep-1",
      name: "Serviceskjema",
      isLocked: true,
      completedAt: new Date("2026-11-14T12:00:00.000Z"),
      reportNumber: "abc1234",
    },
  ],
  workComments: [
    {
      id: "comment-1",
      content: "Ringte kunden.",
      authorName: "Kari",
      createdAt: new Date("2026-11-13T09:00:00.000Z"),
    },
  ],
  attachments: [
    {
      id: "att-1",
      fileName: "bilde.jpg",
      // Skal aldri videresendes, selv om en mock eller gammel spørring har den.
      dataUrl: "/uploads/hemmelig.jpg",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(authenticated());
  mocks.prisma.workOrder.findFirst.mockResolvedValue(null);
  mocks.changeWorkOrderStatus.mockResolvedValue({ ok: true });
  mocks.updateWorkOrderDate.mockResolvedValue({ ok: true });
});

describe("GET /api/v1/work-orders/[id]", () => {
  it("returnerer 404 når oppdraget er ukjent eller utenfor omfanget", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ id: "wo-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });

    const call = mocks.prisma.workOrder.findFirst.mock.calls[0][0];
    expect(call.where.id).toBe("wo-1");
    expect(call.where.AND[0]).toEqual({
      departmentId: "dep-a",
      department: { isActive: true },
      deletedAt: null,
    });
    expect(call.select.visits).toMatchObject({
      orderBy: [{ sequence: "asc" }, { startsAt: "asc" }],
      take: 20,
    });
  });

  it("viser detaljer, rapportoversikt, kommentarer og vedlegg uten filinnhold", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(detailRow);

    const response = await GET(request(), {
      params: Promise.resolve({ id: "wo-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "wo-1",
      scheduledFor: "2026-11-14",
      scheduledTo: "2026-11-15",
      reportCount: 1,
      contact: { id: "contact-1" },
      tags: [{ id: "tag-1", name: "Service" }],
      templates: [{ id: "tpl-1", title: "Serviceskjema" }],
      reports: [
        {
          id: "rep-1",
          name: "Serviceskjema",
          isLocked: true,
          reportNumber: "abc1234",
        },
      ],
      comments: [{ id: "comment-1", body: "Ringte kunden." }],
      attachments: [{ id: "att-1", fileName: "bilde.jpg" }],
      visits: [
        {
          id: "visit-1",
          workOrderId: "wo-1",
          sequence: 0,
          startsAt: "2026-11-14T09:00:00.000Z",
          endsAt: "2026-11-14T11:00:00.000Z",
          allDay: false,
          status: "ASSIGNED",
          notes: null,
          technicians: [
            { id: "tech-1", name: "Ola", email: "ola@example.test" },
          ],
          createdAt: "2026-10-30T08:00:00.000Z",
          updatedAt: "2026-10-30T08:30:00.000Z",
        },
      ],
    });
    expect(body.data.attachments[0].dataUrl).toBeUndefined();
  });

  it("nekter aktører uten workorders.view", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        role: "USER",
        departmentId: null,
        roleDefinition: { permissions: [] },
      }),
    );

    const response = await GET(request(), {
      params: Promise.resolve({ id: "wo-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.prisma.workOrder.findFirst).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/work-orders/[id]", () => {
  it("endrer status gjennom tjenestelaget og returnerer oppdatert oppsummering", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(summaryRow);

    const response = await PATCH(patch({ status: "IN_PROGRESS" }), {
      params: Promise.resolve({ id: "wo-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.changeWorkOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "wo-1",
      "IN_PROGRESS",
      "office",
      undefined,
    );
    expect(body.data).toMatchObject({
      id: "wo-1",
      status: "IN_PROGRESS",
      scheduledFor: "2026-11-14",
      reportCount: 1,
    });
  });

  it("flytter datoene gjennom updateWorkOrderDate", async () => {
    mocks.prisma.workOrder.findFirst.mockResolvedValue(summaryRow);

    const response = await PATCH(
      patch({ scheduledFor: "2026-11-14", scheduledTo: "2026-11-15" }),
      { params: Promise.resolve({ id: "wo-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateWorkOrderDate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "wo-1",
      { newDate: "2026-11-14", newEnd: "2026-11-15" },
    );
    expect(mocks.changeWorkOrderStatus).not.toHaveBeenCalled();
  });

  it("avviser tomme og ukjente felt", async () => {
    const empty = await PATCH(patch({}), {
      params: Promise.resolve({ id: "wo-1" }),
    });
    expect(empty.status).toBe(400);

    const unknown = await PATCH(patch({ status: "IN_PROGRESS", tittel: "X" }), {
      params: Promise.resolve({ id: "wo-1" }),
    });
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toMatchObject({
      error: { code: "validation_error", details: { field: "tittel" } },
    });
    expect(mocks.changeWorkOrderStatus).not.toHaveBeenCalled();
  });

  it("avviser ugyldig status og dato med 422", async () => {
    const badStatus = await PATCH(patch({ status: "FERDIG" }), {
      params: Promise.resolve({ id: "wo-1" }),
    });
    expect(badStatus.status).toBe(422);

    const badDate = await PATCH(patch({ scheduledFor: "14.11.2026" }), {
      params: Promise.resolve({ id: "wo-1" }),
    });
    expect(badDate.status).toBe(422);
    expect(mocks.changeWorkOrderStatus).not.toHaveBeenCalled();
    expect(mocks.updateWorkOrderDate).not.toHaveBeenCalled();
  });

  it("oversetter låst oppdrag og bevaringsplikt til 409", async () => {
    mocks.changeWorkOrderStatus.mockResolvedValue({
      ok: false,
      error: "workorder-locked",
    });

    const response = await PATCH(patch({ status: "IN_PROGRESS" }), {
      params: Promise.resolve({ id: "wo-1" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "conflict" },
    });
  });

  it("nekter aktører uten workorders.update", async () => {
    mocks.authenticate.mockResolvedValue(
      authenticated({
        roleDefinition: { permissions: ["workorders.view"] },
      }),
    );

    const response = await PATCH(patch({ status: "IN_PROGRESS" }), {
      params: Promise.resolve({ id: "wo-1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.changeWorkOrderStatus).not.toHaveBeenCalled();
  });
});
