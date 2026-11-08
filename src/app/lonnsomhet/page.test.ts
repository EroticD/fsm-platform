import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
  requireModulePage: vi.fn(),
  getCurrentUser: vi.fn(),
  getProfitability: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => "nb"),
}));
vi.mock("@/lib/module-guards", () => ({
  requireModulePage: mocks.requireModulePage,
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isOffice: (role?: string | null) => role === "ADMIN" || role === "OFFICE",
}));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));
vi.mock("@/lib/dates", () => ({
  formatDateLocalized: (value: string) => value,
}));
vi.mock("@/server/bi", () => ({
  getProfitability: mocks.getProfitability,
}));

import ProfitabilityPage from "./page";

const office = {
  id: "office-1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
};

const emptyData = {
  filters: {
    from: "2026-11-01",
    to: "2026-11-30",
    departmentId: null,
    customerId: null,
    technicianId: null,
    departmentName: null,
    customerName: null,
    technicianName: null,
  },
  options: { departments: [], customers: [], technicians: [] },
  orders: {
    total: 0,
    completed: 0,
    cancelled: 0,
    open: 0,
    completionRate: null,
    byStatus: {},
  },
  firstTimeFix: {
    eligible: 0,
    fixed: 0,
    rate: null,
    deviations: 0,
    remediationOrders: 0,
  },
  time: {
    travelToMinutes: 0,
    workMinutes: 0,
    travelFromMinutes: 0,
    totalMinutes: 0,
    travelMinutes: 0,
    sessions: 0,
    completedSessions: 0,
    ongoingSessions: 0,
  },
  capacity: {
    availableMinutes: 0,
    basis: "none",
    utilizationPercent: null,
    workUtilizationPercent: null,
  },
  revenue: {
    actualAvailable: false,
    actualRevenueOre: null,
    actualInvoiceCount: 0,
    actualOrderCount: 0,
    estimatedRevenueOre: 0,
    estimatedRevenueOrders: 0,
    ordersWithoutRate: 0,
    coveragePercent: null,
    basis: "missing",
    estimatedCostOre: null,
    estimatedProfitOre: null,
    costBasis: "missing",
    costRateOrePerHour: null,
  },
  perTechnician: [],
  perCustomer: [],
  perOrder: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModulePage.mockResolvedValue(undefined);
  mocks.getCurrentUser.mockResolvedValue(office);
  mocks.getProfitability.mockResolvedValue({ ok: true, data: emptyData });
});

describe("lønnsomhetssiden", () => {
  it("kaller modulvakten og gir 404 når bi er av", async () => {
    mocks.requireModulePage.mockRejectedValue(new Error("NOT_FOUND"));

    await expect(
      ProfitabilityPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.requireModulePage).toHaveBeenCalledWith("bi");
  });

  it("sender brukeren til innlogging uten økt", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(
      ProfitabilityPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/api/auth/signin");
  });

  it("sender montør bort fra kontorsiden", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...office, role: "TECHNICIAN" });

    await expect(
      ProfitabilityPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/");
  });

  it("sender filtre videre og tegner tom tilstand", async () => {
    const element = await ProfitabilityPage({
      searchParams: Promise.resolve({
        fra: "2026-11-01",
        til: "2026-11-30",
        avdeling: "dep-a",
        kunde: "cust-1",
        tekniker: "tech-1",
      }),
    });

    expect(element).toBeTruthy();
    expect(mocks.getProfitability).toHaveBeenCalledWith(office, {
      from: "2026-11-01",
      to: "2026-11-30",
      departmentId: "dep-a",
      customerId: "cust-1",
      technicianId: "tech-1",
    });
  });

  it("viser faktisk omsetning ved siden av estimatet når den er tilgjengelig", async () => {
    mocks.getProfitability.mockResolvedValue({
      ok: true,
      data: {
        ...emptyData,
        revenue: {
          ...emptyData.revenue,
          actualAvailable: true,
          actualRevenueOre: 123_400,
          actualInvoiceCount: 2,
          actualOrderCount: 1,
        },
      },
    });

    const element = await ProfitabilityPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("bi.actual.availableTitle");
    expect(html).toContain("bi.kpis.actualRevenue");
  });

  it("forklarer hvorfor faktisk omsetning mangler", async () => {
    const element = await ProfitabilityPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("bi.actual.unavailableDescription");
    expect(html).toContain("bi.kpis.actualRevenueUnavailable");
  });
});
