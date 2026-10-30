import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  getCapacityOverview: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => "nb"),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));
vi.mock("@/server/dispatch", () => ({
  getCapacityOverview: mocks.getCapacityOverview,
}));

import CapacityPage from "./page";

const user = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.getCapacityOverview.mockResolvedValue({
    ok: true,
    data: {
      from: "2026-11-02",
      to: "2026-11-02",
      totals: { capacityMinutes: 480, loadMinutes: 120 },
      days: [
        {
          date: "2026-11-02",
          departmentId: "dep-1",
          departmentName: "Hovedavdeling",
          capacityMinutes: 480,
          loadMinutes: 120,
          technicians: [
            {
              id: "tech-1",
              name: "Ola",
              capacityMinutes: 480,
              loadMinutes: 120,
              visitCount: 1,
            },
          ],
        },
      ],
    },
  });
});

describe("kapasitetssiden", () => {
  it("sender brukeren til innlogging uten økt", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(
      CapacityPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/api/auth/signin");
  });

  it("henter kapasitet for valgt periode og viser tallene", async () => {
    const element = await CapacityPage({
      searchParams: Promise.resolve({
        fra: "2026-11-02",
        til: "2026-11-02",
      }),
    });

    expect(element).toBeTruthy();
    expect(mocks.getCapacityOverview).toHaveBeenCalledWith(
      user,
      new Date("2026-11-02T00:00:00.000Z"),
      new Date("2026-11-02T00:00:00.000Z"),
    );
  });
});
