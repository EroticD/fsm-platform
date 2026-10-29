import { beforeEach, describe, expect, it, vi } from "vitest";

type DispatchDayLike = {
  date: string;
  kind?: string;
  workOrders: Array<{
    id: string;
    statusOptions: string[];
    canComplete: boolean;
    canCancel: boolean;
    isOverdue: boolean;
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
  workOrderCount: vi.fn(async () => 0),
  userFindMany: vi.fn(async () => []),
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
      count: mocks.workOrderCount,
    },
    user: { findMany: mocks.userFindMany },
  },
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

function row(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "wo-1",
    title: "Service",
    status: "OPEN",
    description: null,
    scheduledFor: new Date("2026-10-29T00:00:00.000Z"),
    scheduledTo: null,
    customer: null,
    product: null,
    technicians: [],
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
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
  mocks.workOrderCount.mockResolvedValue(0);
  mocks.userFindMany.mockResolvedValue([]);
});

describe("dispatch page – forfalte og ufordelte", () => {
  it("henter ufordelte og forfalte utenfor valgt datoperiode", async () => {
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

    const dateArgs = mocks.workOrderFindMany.mock.calls[1][0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(dateArgs.where.AND).toContainEqual({ NOT: { OR: attention } });
    expect(dateArgs.where.AND).toContainEqual({
      scheduledFor: { gte: expect.any(Date) },
    });
    expect(dateArgs.where.AND).toContainEqual({
      scheduledFor: { lte: expect.any(Date) },
    });
  });

  it("viser varselseksjonen først uten å duplisere kort i datokolonnen", async () => {
    mocks.workOrderFindMany
      .mockResolvedValueOnce([
        row({
          id: "wo-overdue",
          scheduledFor: new Date("2026-10-20T00:00:00.000Z"),
        }),
      ])
      .mockResolvedValueOnce([row({ id: "wo-in-range" })]);

    const element = await render();
    const days = findBoardDays(element);

    expect(days?.map((day) => day.date)).toEqual([
      "attention",
      "2026-10-29",
    ]);
    expect(days?.[0].kind).toBe("attention");
    expect(days?.[0].workOrders.map((workOrder) => workOrder.id)).toEqual([
      "wo-overdue",
    ]);
    expect(days?.[1].workOrders.map((workOrder) => workOrder.id)).toEqual([
      "wo-in-range",
    ]);
  });

  it("teller bare ufordelte kort som faktisk vises", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mocks.workOrderFindMany.mockResolvedValueOnce([
      row({ id: "wo-future", scheduledFor: tomorrow }),
      row({ id: "wo-unassigned", scheduledFor: tomorrow }),
    ]);
    mocks.workOrderFindMany.mockResolvedValueOnce([]);

    const element = await render();
    const days = findBoardDays(element);
    const text = collectText(element).join(" ");

    expect(days?.[0].workOrders).toHaveLength(2);
    expect(days?.[0].workOrders.every((workOrder) => workOrder.isOverdue)).toBe(
      false,
    );
    expect(text).toContain("calendar.dispatch.unassignedCount:2");
  });
});

describe("dispatch page – statussikkerhet", () => {
  it("tilbyr ikke fullført/kansellert i statusnedtrekket", async () => {
    mocks.workOrderFindMany.mockResolvedValueOnce([]);
    mocks.workOrderFindMany.mockResolvedValueOnce([row()]);

    const element = await render();
    const days = findBoardDays(element);
    const workOrder = days?.[0].workOrders[0];

    expect(workOrder?.statusOptions).not.toContain("COMPLETED");
    expect(workOrder?.statusOptions).not.toContain("CANCELLED");
    expect(workOrder?.canComplete).toBe(true);
    expect(workOrder?.canCancel).toBe(true);
  });

  it("skjuler kansellering for brukere uten workorders.edit", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      ...admin,
      role: "OFFICE",
      permissionsCustomized: true,
      permissions: ["workorders.assign", "workorders.update"],
    });
    mocks.workOrderFindMany.mockResolvedValueOnce([]);
    mocks.workOrderFindMany.mockResolvedValueOnce([row()]);

    const element = await render();
    const days = findBoardDays(element);
    const workOrder = days?.[0].workOrders[0];

    expect(workOrder?.canComplete).toBe(true);
    expect(workOrder?.canCancel).toBe(false);
    expect(workOrder?.statusOptions).not.toContain("CANCELLED");
  });
});
