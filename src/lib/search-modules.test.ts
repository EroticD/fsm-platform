import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readModuleStates: vi.fn(),
  searchByName: vi.fn(),
  searchBySubstring: vi.fn(),
  searchDocuments: vi.fn(),
  searchNormalizedIds: vi.fn(),
  searchReports: vi.fn(),
  searchWorkOrderIdsWithTotal: vi.fn(),
}));

vi.mock("@/server/modules", () => ({
  readModuleStates: mocks.readModuleStates,
}));
vi.mock("@/lib/search-sql", () => ({
  searchByName: mocks.searchByName,
  searchBySubstring: mocks.searchBySubstring,
  searchDocuments: mocks.searchDocuments,
  searchNormalizedIds: mocks.searchNormalizedIds,
  searchReports: mocks.searchReports,
  searchWorkOrderIdsWithTotal: mocks.searchWorkOrderIdsWithTotal,
}));

import { performSearch } from "./search";

const equipmentOnlyUser = {
  id: "tech-1",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-a",
  permissionsCustomized: true,
  permissions: ["equipment.view", "reports.view", "documents.view"],
  roleDefinition: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("søk med avslåtte moduler", () => {
  it("returnerer ingen treff og gjør ingen modulspørringer når alle relevante moduler er av", async () => {
    mocks.readModuleStates.mockResolvedValue({
      core: true,
      equipment: false,
      reports: false,
      documents: false,
    });

    const result = await performSearch("pumpe", {
      user: equipmentOnlyUser as never,
    });

    expect(result.groups).toEqual([]);
    expect(mocks.searchByName).not.toHaveBeenCalled();
    expect(mocks.searchReports).not.toHaveBeenCalled();
    expect(mocks.searchDocuments).not.toHaveBeenCalled();
  });

});
