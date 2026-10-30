import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "nb"),
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

import AdminDashboard, { buildPriorityQueue } from "./page";
import {
  buildBoardColumns,
  resolveDashboardView,
  resolveQueueSort,
  sortQueueRows,
  type QueueKey,
  type QueueRow,
  type SortableOrder,
} from "@/components/dashboard/helpers";

const technician = {
  id: "tech-1",
  name: "Ola",
  email: "montor@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-1",
  department: { id: "dep-1", name: "Hovedavdeling", isActive: true },
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: { permissions: ["workorders.view"] },
};

const customer = {
  ...technician,
  id: "customer-1",
  role: "CUSTOMER",
  customerId: "cust-1",
  roleDefinition: { permissions: [] },
};

function order(id: string) {
  return {
    id,
    title: `Oppdrag ${id}`,
    status: "OPEN",
    scheduledFor: new Date("2026-10-29T00:00:00.000Z"),
    customer: { name: "Testkunde" },
    technicians: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("felles inngang /", () => {
  it("sender montøren videre til I dag", async () => {
    mocks.getCurrentUser.mockResolvedValue(technician);

    await expect(AdminDashboard()).rejects.toThrow(
      "REDIRECT:/mine-oppdrag",
    );
  });

  it("sender kundeportalbrukere til portalen", async () => {
    mocks.getCurrentUser.mockResolvedValue(customer);

    await expect(AdminDashboard()).rejects.toThrow(
      "REDIRECT:/kundeportal",
    );
  });
});

describe("prioritert kø", () => {
  it("prioriterer forfalt, i dag og ikke tildelt uten duplikater", () => {
    const a = order("a");
    const b = order("b");
    const c = order("c");
    const d = order("d");

    const groups = buildPriorityQueue(
      {
        overdue: [a, b],
        today: [b, c],
        unassigned: [a, c, d],
      },
      { overdue: 2, today: 2, unassigned: 3 },
    );

    expect(groups.map((group) => group.key)).toEqual([
      "overdue",
      "today",
      "unassigned",
    ]);
    expect(groups.map((group) => group.orders.map((item) => item.id))).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
    ]);

    const ids = groups.flatMap((group) => group.orders.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("begrenser dagens liste til fem og markerer at det finnes mer", () => {
    const today = Array.from({ length: 8 }, (_, index) => order(`t${index}`));

    const groups = buildPriorityQueue(
      { overdue: [], today, unassigned: [] },
      { overdue: 0, today: 8, unassigned: 0 },
    );

    expect(groups[1].orders).toHaveLength(5);
    expect(groups[1].hasMore).toBe(true);
  });

  it("holder den samlede køen under taket", () => {
    const orders = Array.from({ length: 5 }, (_, index) => order(`o${index}`));
    const today = Array.from({ length: 5 }, (_, index) => order(`t${index}`));
    const unassigned = Array.from({ length: 5 }, (_, index) =>
      order(`u${index}`),
    );

    const groups = buildPriorityQueue(
      { overdue: orders, today, unassigned },
      { overdue: 5, today: 5, unassigned: 5 },
      { perGroup: 5, total: 8 },
    );

    expect(groups[0].orders).toHaveLength(5);
    expect(groups[1].orders).toHaveLength(3);
    expect(groups[2].orders).toHaveLength(0);
  });
});

describe("sortering av køen", () => {
  const rows: Array<QueueRow<SortableOrder>> = [
    {
      order: {
        id: "zeta",
        title: "Zeta",
        status: "OPEN",
        scheduledFor: new Date("2026-10-31T00:00:00.000Z"),
        customer: { name: "Alfa" },
      },
      queueKey: "today" as QueueKey,
    },
    {
      order: {
        id: "alfa",
        title: "Alfa",
        status: "IN_PROGRESS",
        scheduledFor: new Date("2026-10-29T00:00:00.000Z"),
        customer: { name: "Beta" },
      },
      queueKey: "overdue" as QueueKey,
    },
    {
      order: {
        id: "beta",
        title: "Beta",
        status: "PLANNED",
        scheduledFor: null,
        customer: { name: "Cecil" },
      },
      queueKey: "unassigned" as QueueKey,
    },
  ];

  it("sorterer eldste først og legger udaterte sist", () => {
    expect(sortQueueRows(rows, "dato").map((row) => row.order.id)).toEqual([
      "alfa",
      "zeta",
      "beta",
    ]);
  });

  it("sorterer på kunde, status og tittel uten å mutere kilden", () => {
    expect(sortQueueRows(rows, "kunde").map((row) => row.order.id)).toEqual([
      "zeta",
      "alfa",
      "beta",
    ]);
    expect(sortQueueRows(rows, "status").map((row) => row.order.id)).toEqual([
      "alfa",
      "zeta",
      "beta",
    ]);
    expect(sortQueueRows(rows, "tittel").map((row) => row.order.id)).toEqual([
      "alfa",
      "beta",
      "zeta",
    ]);
    expect(rows.map((row) => row.order.id)).toEqual(["zeta", "alfa", "beta"]);
  });

  it("faller tilbake til dato for ukjente parametere", () => {
    expect(resolveQueueSort("tittel")).toBe("tittel");
    expect(resolveQueueSort("ukjent")).toBe("dato");
    expect(resolveQueueSort(undefined)).toBe("dato");
    expect(resolveDashboardView("tavle")).toBe("tavle");
    expect(resolveDashboardView("ukjent")).toBe("liste");
  });
});

describe("tavlekolonner", () => {
  it("fordeler etter prioritet uten duplikater", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    const d = { id: "d" };
    const e = { id: "e" };
    const f = { id: "f" };

    const columns = buildBoardColumns(
      {
        overdue: [a, b],
        today: [b, c, d],
        inProgress: [c, e],
        unassigned: [a, d, e, f],
      },
      { overdue: 2, today: 1, inProgress: 2, unassigned: 1 },
    );

    expect(columns.map((column) => column.key)).toEqual([
      "overdue",
      "today",
      "inProgress",
      "unassigned",
    ]);
    expect(columns.map((column) => column.orders.map((item) => item.id))).toEqual([
      ["a", "b"],
      ["d"],
      ["c", "e"],
      ["f"],
    ]);

    const ids = columns.flatMap((column) =>
      column.orders.map((item) => item.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("kapper hver kolonne og markerer at det finnes flere", () => {
    const overdue = Array.from({ length: 4 }, (_, index) => ({
      id: `o${index}`,
    }));
    const columns = buildBoardColumns(
      { overdue, today: [], inProgress: [], unassigned: [] },
      { overdue: 9, today: 0, inProgress: 0, unassigned: 0 },
      2,
    );

    expect(columns[0].orders.map((item) => item.id)).toEqual(["o0", "o1"]);
    expect(columns[0].hasMore).toBe(true);
    expect(columns[0].total).toBe(9);
  });
});
