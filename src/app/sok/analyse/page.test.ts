import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  getSearchAnalytics: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
  getLocale: vi.fn(async () => "nb-NO"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/search-analytics", () => ({
  getSearchAnalytics: mocks.getSearchAnalytics,
}));

import SearchAnalyticsPage from "./page";

const staffUser = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
  customerId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: { permissions: ["audit.view"] },
};

const analyticsData = {
  days: 7,
  totalSearches: 0,
  zeroResultCount: 0,
  zeroResultRate: 0,
  averageLatencyMs: 0,
  topQueries: [],
  topZeroResultQueries: [],
  daily: [],
};

function render(days?: string) {
  return SearchAnalyticsPage({
    searchParams: Promise.resolve({ days }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/sok/analyse", () => {
  it("sender uinnloggede til innlogging uten å hente analyse", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("REDIRECT:/api/auth/signin");
    expect(mocks.getSearchAnalytics).not.toHaveBeenCalled();
  });

  it("avviser brukere uten audit.view eller administratorrettighet", async () => {
    mocks.getCurrentUser.mockResolvedValue(staffUser);
    mocks.getSearchAnalytics.mockResolvedValue({
      ok: false,
      reason: "forbidden",
    });

    await expect(render("7")).rejects.toThrow("REDIRECT:/");
    expect(mocks.getSearchAnalytics).toHaveBeenCalledWith(staffUser, 7);
  });

  it("bruker 30 dager når tidsrommet mangler eller er ukjent", async () => {
    mocks.getCurrentUser.mockResolvedValue(staffUser);
    mocks.getSearchAnalytics.mockResolvedValue({
      ok: false,
      reason: "forbidden",
    });

    await expect(render("14")).rejects.toThrow("REDIRECT:/");
    expect(mocks.getSearchAnalytics).toHaveBeenCalledWith(staffUser, 30);
  });

  it("viser analysen til autoriserte brukere", async () => {
    mocks.getCurrentUser.mockResolvedValue(staffUser);
    mocks.getSearchAnalytics.mockResolvedValue({
      ok: true,
      data: analyticsData,
    });

    await expect(render("7")).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getSearchAnalytics).toHaveBeenCalledWith(staffUser, 7);
  });
});
