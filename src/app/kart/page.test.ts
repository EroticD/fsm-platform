import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  addDaysUtc,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  userFindMany: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "nb"),
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));
vi.mock("@/lib/access", () => ({
  staffScope: () => ({}),
  workOrderScope: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findMany: mocks.userFindMany },
    workOrder: { count: mocks.count, findMany: mocks.findMany },
  },
}));
vi.mock("@/server/map-settings", () => ({
  getMapSettings: vi.fn(async () => ({})),
}));
vi.mock("@/components/WorkOrderMap", () => ({ default: () => null }));
vi.mock("@/components/WorkOrderStatusLegend", () => ({
  default: () => null,
}));
vi.mock("@/components/GoogleMapsLink", () => ({ default: () => null }));
vi.mock("@/components/IsoDateInput", () => ({ default: () => null }));
vi.mock("./actions", () => ({ geocodeMissingAction: vi.fn() }));

import MapPage from "./page";

const user = {
  id: "u1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: "dep-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.count.mockResolvedValue(0);
  mocks.findMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
});

describe("kart – visitbevisst datofilter", () => {
  it("filtrerer på visittoverlapp med fallback for oppdrag uten visitt", async () => {
    const today = todayInOslo();
    const todayDate = parseDateOnly(today);
    if (!todayDate) throw new Error("ugyldig testdato");
    const expectedFrom = osloDayStart(today);
    const expectedTo = osloDayStart(toDateOnly(addDaysUtc(todayDate, 1)));

    const element = await MapPage({
      searchParams: Promise.resolve({
        dateFrom: today,
        dateTo: today,
      }),
    });
    const html = renderToStaticMarkup(element);

    const where = mocks.findMany.mock.calls[0][0].where;
    const dateFilter = where.AND.find(
      (condition: { OR?: unknown[] }) => condition.OR,
    );

    expect(dateFilter.OR[0].visits.some).toEqual({
      status: { not: "CANCELLED" },
      endsAt: { gt: expectedFrom },
      startsAt: { lt: expectedTo },
    });
    expect(dateFilter.OR[1].AND[0]).toEqual({ visits: { none: {} } });
    expect(html).toContain("orders.map.visitsToday");
    expect(html).toContain("orders.map.visitsHint");
  });
});
