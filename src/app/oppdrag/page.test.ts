import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryArgs = { where?: unknown };

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => key),
  searchWorkOrderIds: vi.fn(async (_search: string) => [] as string[]),
  groupBy: vi.fn(async (_args: { by: string[]; where?: unknown }) => []),
  count: vi.fn(async (_args: QueryArgs) => 0),
  findMany: vi.fn(async (_args: QueryArgs) => []),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
  getLocale: vi.fn(async () => "nb"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/search-sql", () => ({
  searchWorkOrderIds: mocks.searchWorkOrderIds,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: {
      groupBy: mocks.groupBy,
      count: mocks.count,
      findMany: mocks.findMany,
    },
  },
}));

import WorkOrdersPage from "./page";
import { workOrderScope } from "@/lib/access";
import {
  workOrderListSearchWhere,
  workOrderTagWhere,
} from "@/lib/search-filters";

const officeUser = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
  department: null,
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: { permissions: ["workorders.view"] },
};

function render(params: { vis?: string; q?: string; tag?: string; side?: string } = {}) {
  return WorkOrdersPage({ searchParams: Promise.resolve(params) });
}

/** Samme filter som siden bygger: søk og tag, uten statusvalg. */
function expectedFilters(search: string, tag: string) {
  return {
    AND: [workOrderListSearchWhere(search, []), workOrderTagWhere(tag)],
  };
}

function expectedVisibleStatus() {
  // `workOrderScope` krever Prisma-brukeren med avdeling; testen bruker bare
  // feltene den faktisk leser.
  return { AND: [workOrderScope(officeUser as never), {}] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(officeUser);
  mocks.searchWorkOrderIds.mockResolvedValue([]);
  mocks.groupBy.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.findMany.mockResolvedValue([]);
});

describe("/oppdrag fanetall", () => {
  it("bruker søkefilteret i statusgrupperingen, ikke bare synlighetsfilteret", async () => {
    await render({ q: "zzz" });

    expect(mocks.searchWorkOrderIds).toHaveBeenCalledWith("zzz");
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: {
        AND: [expectedVisibleStatus(), expectedFilters("zzz", "")],
      },
      _count: { _all: true },
    });
  });

  it("bruker tagfilteret i statusgrupperingen", async () => {
    await render({ tag: "VIP" });

    expect(mocks.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [expectedVisibleStatus(), expectedFilters("", "VIP")],
        },
      }),
    );
  });

  it("beholder filtre i dag-, forfalt- og ikke-tildelt-tallene", async () => {
    await render({ q: "zzz", tag: "VIP" });

    const filters = expectedFilters("zzz", "VIP");
    const whereForCounts = mocks.count.mock.calls.map(([args]) => args.where);

    // Tre visningstellinger (i dag, forfalte, ikke tildelt) pluss total.
    expect(whereForCounts).toHaveLength(4);
    for (const where of whereForCounts.slice(0, 3)) {
      expect(where).toMatchObject({
        AND: [expectedVisibleStatus(), expect.anything(), filters],
      });
    }
  });

  it("bruker samme where for total og oppdragslisten", async () => {
    await render({ q: "zzz", tag: "VIP" });

    expect(mocks.count).toHaveBeenCalledTimes(4);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual(
      mocks.count.mock.calls[3][0].where,
    );
  });
});
