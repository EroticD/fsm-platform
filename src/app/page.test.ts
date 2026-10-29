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
