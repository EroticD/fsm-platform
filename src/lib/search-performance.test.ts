import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    customer: { findMany: vi.fn(), count: vi.fn() },
    contact: { findMany: vi.fn(), count: vi.fn() },
    product: { findMany: vi.fn(), count: vi.fn() },
    workOrder: { findMany: vi.fn(), count: vi.fn() },
    tag: { findMany: vi.fn(), count: vi.fn() },
    report: { findMany: vi.fn() },
    comment: { findMany: vi.fn(), count: vi.fn() },
    user: { findMany: vi.fn(), count: vi.fn() },
    template: { findMany: vi.fn(), count: vi.fn() },
    documentFolder: { findMany: vi.fn(), count: vi.fn() },
    document: { findMany: vi.fn(), count: vi.fn() },
  },
  searchByName: vi.fn(),
  searchBySubstring: vi.fn(),
  searchNormalizedIds: vi.fn(),
  searchDocuments: vi.fn(),
  searchReports: vi.fn(),
  searchWorkOrderIdsWithTotal: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/access", () => ({
  workOrderScope: () => ({}),
  departmentUsersScope: () => ({}),
}));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));
vi.mock("@/lib/search-sql", () => ({
  searchByName: mocks.searchByName,
  searchBySubstring: mocks.searchBySubstring,
  searchNormalizedIds: mocks.searchNormalizedIds,
  searchDocuments: mocks.searchDocuments,
  searchReports: mocks.searchReports,
  searchWorkOrderIdsWithTotal: mocks.searchWorkOrderIdsWithTotal,
}));

import { performSearch } from "./search";
import type { AccessUser } from "@/lib/access";

const user = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: "dep-a",
  customerId: null,
  permissions: null,
  permissionsCustomized: false,
  roleDefinition: null,
} as unknown as AccessUser;

function emptyRows() {
  for (const model of Object.values(mocks.prisma)) {
    if ("findMany" in model) model.findMany.mockResolvedValue([]);
    if ("count" in model) model.count.mockResolvedValue(0);
  }
  mocks.searchByName.mockResolvedValue([]);
  mocks.searchBySubstring.mockResolvedValue([]);
  mocks.searchNormalizedIds.mockResolvedValue([]);
  mocks.searchDocuments.mockResolvedValue([]);
  mocks.searchReports.mockResolvedValue([]);
  mocks.searchWorkOrderIdsWithTotal.mockResolvedValue({ ids: [], total: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  emptyRows();
});

describe("performSearch – ytelse og paginering", () => {
  it("teller bare grupper brukeren faktisk har valgt", async () => {
    mocks.searchByName.mockImplementation(async () => []);
    mocks.searchNormalizedIds.mockResolvedValue([
      { id: "c1", score: 0.9, total: 1 },
    ]);
    mocks.prisma.customer.findMany.mockResolvedValue([
      {
        id: "c1",
        name: "Pumpe Kunde",
        customerNumber: null,
        orgNumber: null,
        city: null,
        phone: null,
        email: null,
      },
    ]);
    mocks.prisma.customer.count.mockResolvedValue(1);

    await performSearch("pumpe", { user, filters: { types: ["customer"] } });

    expect(mocks.prisma.customer.count).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.workOrder.count).not.toHaveBeenCalled();
    expect(mocks.prisma.report.findMany).not.toHaveBeenCalled();
    expect(mocks.searchReports).not.toHaveBeenCalled();
  });

  it("eksponerer et ærlig tak når kandidatgrensen er nådd", async () => {
    const hits = Array.from({ length: 500 }, (_, index) => ({
      id: `c${index}`,
      score: 0.9,
      total: 800,
    }));
    mocks.searchByName.mockResolvedValue(hits);
    mocks.searchNormalizedIds.mockResolvedValue([]);
    mocks.prisma.customer.findMany.mockResolvedValue(
      hits.slice(0, 5).map((hit) => ({
        id: hit.id,
        name: "Pumpe Kunde",
        customerNumber: null,
        orgNumber: null,
        city: null,
        phone: null,
        email: null,
      })),
    );
    mocks.prisma.customer.count.mockResolvedValue(500);

    const result = await performSearch("pumpe", {
      user,
      filters: { types: ["customer"] },
    });

    const customer = result.groups.find((group) => group.kind === "customer");
    expect(customer).toMatchObject({ total: 500, capped: true });
    expect(result.capped).toBe(true);
  });
});
