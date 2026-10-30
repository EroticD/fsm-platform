import { beforeEach, describe, expect, it, vi } from "vitest";

type DispatchDayLike = {
  date: string;
  label: string;
  visits: Array<{
    id: string;
    workOrderId: string;
    visitStatus: string;
    statusOptions: string[];
    timeLabel: string;
    dateLabel: string;
    candidates?: Array<{
      id: string;
      name: string;
      score: number;
      eligible: boolean;
    }>;
  }>;
};

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  getTranslations: vi.fn(async () => (key: string, values?: Record<string, unknown>) =>
    typeof values?.count === "number" ? `${key}:${values.count}` : key,
  ),
  getLocale: vi.fn(async () => "nb"),
  workOrderFindMany: vi.fn(),
  visitFindMany: vi.fn(),
  visitCount: vi.fn(async () => 0),
  userFindMany: vi.fn(async () => []),
  scoreCandidatesForVisits: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
  getLocale: mocks.getLocale,
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/access", () => ({
  workOrderScope: vi.fn(() => ({ departmentId: "dep-a" })),
  staffScope: vi.fn(() => ({ departmentId: "dep-a" })),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: {
      findMany: mocks.workOrderFindMany,
    },
    visit: {
      findMany: mocks.visitFindMany,
      count: mocks.visitCount,
    },
    user: { findMany: mocks.userFindMany },
  },
}));

vi.mock("@/server/dispatch", () => ({
  scoreCandidatesForVisits: mocks.scoreCandidatesForVisits,
}));

import DispatchPage from "./page";

const admin = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: "dep-a",
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
};

function attentionRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "wo-attention",
    title: "Forfalt service",
    status: "OPEN",
    description: null,
    scheduledFor: new Date("2026-10-20T00:00:00.000Z"),
    scheduledTo: null,
    customer: null,
    product: null,
    technicians: [],
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function visitRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "visit-1",
    workOrderId: "wo-1",
    sequence: 0,
    startsAt: new Date("2026-11-02T09:00:00.000Z"),
    endsAt: new Date("2026-11-02T11:00:00.000Z"),
    allDay: false,
    status: "PLANNED",
    notes: null,
    technicians: [],
    workOrder: {
      id: "wo-1",
      title: "Service",
      status: "OPEN",
      description: null,
      scheduledFor: new Date("2026-11-02T00:00:00.000Z"),
      scheduledTo: null,
      customer: {
        name: "Kunde AS",
        address: "Storgata 1",
        postalCode: "6002",
        city: "Ålesund",
      },
      product: null,
      technicians: [],
    },
    ...overrides,
  };
}

function findBoardDays(node: unknown): DispatchDayLike[] | null {
  if (!node || typeof node !== "object") return null;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && Array.isArray(props.days)) {
    return props.days as DispatchDayLike[];
  }
  for (const value of Object.values(props ?? {})) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = findBoardDays(child);
        if (found) return found;
      }
    } else {
      const found = findBoardDays(value);
      if (found) return found;
    }
  }
  return null;
}

function render(params: Record<string, string> = {}) {
  return DispatchPage({ searchParams: Promise.resolve(params) });
}

function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const props = (node as { props?: Record<string, unknown> }).props;
  for (const value of Object.values(props ?? {})) {
    if (Array.isArray(value)) {
      for (const child of value) collectText(child, out);
    } else {
      collectText(value, out);
    }
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(admin);
  mocks.workOrderFindMany.mockResolvedValue([]);
  mocks.visitFindMany.mockResolvedValue([]);
  mocks.visitCount.mockResolvedValue(0);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.scoreCandidatesForVisits.mockResolvedValue({
    ok: false,
    reason: "error",
  });
});

describe("dispatch page – visiter som planlagte blokker", () => {
  it("henter visiter i valgt periode og utelater forfalte/ufordelte", async () => {
    await render({ fra: "2026-11-01", til: "2026-11-07" });

    const attentionArgs = mocks.workOrderFindMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    const attention = attentionArgs.where.AND.find((filter) =>
      Array.isArray(filter.OR),
    )?.OR as Array<Record<string, unknown>>;

    expect(attention).toEqual(
      expect.arrayContaining([
        { technicians: { none: {} } },
        { scheduledFor: { lt: expect.any(Date) } },
      ]),
    );

    const visitArgs = mocks.visitFindMany.mock.calls[0][0] as {
      where: {
        AND: Array<Record<string, unknown>>;
      };
      take: number;
    };
    expect(visitArgs.take).toBe(80);
    expect(visitArgs.where.AND).toContainEqual({
      status: { not: "CANCELLED" },
    });
    const workOrderFilter = visitArgs.where.AND.find(
      (filter) => "workOrder" in filter,
    )?.workOrder as { AND: Array<Record<string, unknown>> };
    expect(workOrderFilter.AND).toContainEqual({ departmentId: "dep-a" });
    expect(workOrderFilter.AND).toContainEqual({
      status: { not: "COMPLETED" },
    });
    expect(workOrderFilter.AND).toContainEqual({
      NOT: { OR: attention },
    });
    expect(visitArgs.where.AND).toContainEqual({
      startsAt: { gte: expect.any(Date) },
    });
    expect(visitArgs.where.AND).toContainEqual({
      startsAt: { lt: expect.any(Date) },
    });
  });

  it("grupperer på visittens startdato og sorterer dagene", async () => {
    mocks.visitFindMany.mockResolvedValue([
      visitRow({
        id: "visit-late",
        startsAt: new Date("2026-11-03T09:00:00.000Z"),
        endsAt: new Date("2026-11-03T10:00:00.000Z"),
      }),
      visitRow({
        id: "visit-early",
        startsAt: new Date("2026-11-02T09:00:00.000Z"),
        endsAt: new Date("2026-11-02T10:00:00.000Z"),
      }),
    ]);

    const element = await render({
      fra: "2026-11-01",
      til: "2026-11-07",
    });
    const days = findBoardDays(element);

    expect(days?.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(days?.[0].visits.map((visit) => visit.id)).toEqual([
      "visit-early",
    ]);
    expect(days?.[1].visits.map((visit) => visit.id)).toEqual([
      "visit-late",
    ]);
    expect(days?.[0].visits[0].timeLabel).toBe("calendar.visit.timeRange");
  });

  it("viser forfalte/ufordelte i egen seksjon uten å duplisere dem i dagene", async () => {
    mocks.workOrderFindMany.mockResolvedValueOnce([
      attentionRow({ id: "wo-overdue" }),
    ]);
    mocks.visitFindMany.mockResolvedValueOnce([
      visitRow({ id: "visit-in-range" }),
    ]);

    const element = await render();
    const days = findBoardDays(element);
    const text = collectText(element).join(" ");

    expect(days?.map((day) => day.date)).toEqual(["2026-11-02"]);
    expect(days?.[0].visits.map((visit) => visit.id)).toEqual([
      "visit-in-range",
    ]);
    expect(text).toContain("calendar.dispatch.attentionCount:1");
  });

  it("tilbyr bare lovlige visittstatusoverganger", async () => {
    mocks.visitFindMany.mockResolvedValueOnce([
      visitRow({ status: "PLANNED" }),
    ]);

    const element = await render();
    const visit = findBoardDays(element)?.[0].visits[0];

    expect(visit?.statusOptions).toEqual([
      "ASSIGNED",
      "EN_ROUTE",
      "CANCELLED",
    ]);
    expect(visit?.statusOptions).not.toContain("DONE");
  });

  it("skjuler statusvalg uten workorders.update", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      ...admin,
      role: "OFFICE",
      permissionsCustomized: true,
      permissions: ["workorders.assign"],
    });
    mocks.visitFindMany.mockResolvedValueOnce([visitRow()]);

    const element = await render();
    const visit = findBoardDays(element)?.[0].visits[0];

    expect(visit?.statusOptions).toEqual([]);
  });

  it("teller visiter i dagoverskriften", async () => {
    mocks.visitFindMany.mockResolvedValueOnce([
      visitRow({ id: "visit-a" }),
      visitRow({ id: "visit-b" }),
    ]);

    const element = await render();
    const days = findBoardDays(element);

    expect(days).toHaveLength(1);
    expect(days?.[0].visits.map((visit) => visit.id)).toEqual([
      "visit-a",
      "visit-b",
    ]);
  });

  it("sender rangerte kandidater med poengsum til tavla", async () => {
    mocks.visitFindMany.mockResolvedValueOnce([visitRow()]);
    mocks.scoreCandidatesForVisits.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          visitId: "visit-1",
          best: { id: "tech-1" },
          candidates: [
            {
              id: "tech-1",
              name: "Ola",
              score: 87.5,
              eligible: true,
              excludedReason: null,
              missingSkillIds: [],
              breakdown: {
                skills: 35,
                distance: 20,
                travel: 15,
                free: 10,
                sla: 8,
                load: 7,
              },
              distanceKm: 2.5,
              travelMinutes: 6,
              freeMinutes: 420,
              assignedMinutes: 60,
              capacityMinutes: 480,
              currentLoad: 0.125,
              slaUrgency: 30,
              raw: {
                skills: 100,
                distance: 88,
                travel: 88,
                free: 100,
                sla: 70,
                load: 88,
              },
            },
          ],
        },
      ],
    });

    const element = await render();
    const visit = findBoardDays(element)?.[0].visits[0];

    expect(visit?.candidates).toEqual([
      expect.objectContaining({ id: "tech-1", name: "Ola", score: 87.5 }),
    ]);
  });
});
