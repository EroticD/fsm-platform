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

import AdminDashboard from "./page";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("felles inngang /", () => {
  it("sender montøren videre til I dag", async () => {
    mocks.getCurrentUser.mockResolvedValue(technician);

    await expect(
      AdminDashboard({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/mine-oppdrag");
  });

  it("sender kundeportalbrukere til portalen", async () => {
    mocks.getCurrentUser.mockResolvedValue(customer);

    await expect(
      AdminDashboard({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/kundeportal");
  });
});
