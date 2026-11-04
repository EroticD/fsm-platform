import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    customer: { findFirst: vi.fn() },
    customerSite: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  searchNormalizedIds: vi.fn(async () => [] as Array<{ id: string; score: number; total: number }>),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/search-sql", () => ({
  searchNormalizedIds: mocks.searchNormalizedIds,
}));

import {
  createCustomerSite,
  deleteCustomerSite,
  getCustomerSiteOptions,
  listCustomerSites,
  setPrimaryCustomerSite,
  updateCustomerSite,
} from "./customer-sites";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissionsCustomized: true,
    permissions: ["customers.view", "customers.manage"],
    roleDefinition: null,
    ...overrides,
  };
}

const site = {
  id: "site-1",
  name: "Lager",
  address: "Gata 1",
  postalCode: "0001",
  city: "Oslo",
  isPrimary: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" });
  mocks.prisma.customerSite.findMany.mockResolvedValue([site]);
  mocks.prisma.customerSite.findFirst.mockResolvedValue(site);
  mocks.prisma.customerSite.count.mockResolvedValue(0);
  mocks.prisma.customerSite.create.mockResolvedValue(site);
  mocks.prisma.customerSite.update.mockResolvedValue(site);
  mocks.prisma.customerSite.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.customerSite.delete.mockResolvedValue({});
  mocks.audit.mockResolvedValue(undefined);
  mocks.searchNormalizedIds.mockResolvedValue([]);
});

describe("kundesteder", () => {
  it("avgrenser listen til kunden", async () => {
    const result = await listCustomerSites(actor(), "cust-1");
    expect(result.ok).toBe(true);
    expect(mocks.prisma.customerSite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-1" } }),
    );
  });

  it("avgrenser stedsvalgene til kunden og søker bare i kundens rader", async () => {
    mocks.searchNormalizedIds.mockResolvedValue([
      { id: "site-1", score: 1, total: 1 },
    ]);

    const result = await getCustomerSiteOptions(actor(), "cust-1", {
      query: "lager",
    });

    expect(result.ok).toBe(true);
    expect(mocks.searchNormalizedIds).toHaveBeenCalledWith(
      "CustomerSite",
      "lager",
      100,
      undefined,
      false,
      { customerId: "cust-1" },
    );
    expect(mocks.prisma.customerSite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: "cust-1", id: { in: ["site-1"] } },
      }),
    );
  });

  it("nekter stedsvalg uten relevante rettigheter", async () => {
    const result = await getCustomerSiteOptions(
      actor({ permissions: ["reports.view"] }),
      "cust-1",
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.customerSite.findMany).not.toHaveBeenCalled();
  });

  it("avviser ukjent eller slettet kunde", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue(null);

    const result = await getCustomerSiteOptions(actor(), "borte");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.customerSite.findMany).not.toHaveBeenCalled();
  });

  it("første sted blir primært og revisjonslogges", async () => {    const result = await createCustomerSite(actor(), "cust-1", {
      name: "Lager",
      address: "Gata 1",
    });
    expect(result.ok).toBe(true);
    expect(mocks.prisma.customerSite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "cust-1",
          name: "Lager",
          isPrimary: true,
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("avviser redigering av et sted som tilhører en annen kunde", async () => {
    mocks.prisma.customerSite.findFirst.mockResolvedValue(null);

    const result = await updateCustomerSite(actor(), "cust-1", {
      id: "annens-sted",
      name: "Fremmed",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.customerSite.update).not.toHaveBeenCalled();
  });

  it("avviser sletting av et sted som tilhører en annen kunde", async () => {
    mocks.prisma.customerSite.findFirst.mockResolvedValue(null);

    const result = await deleteCustomerSite(actor(), "cust-1", {
      id: "annens-sted",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.customerSite.delete).not.toHaveBeenCalled();
  });

  it("forfremmer neste sted når primærstedet slettes", async () => {
    mocks.prisma.customerSite.findFirst
      .mockResolvedValueOnce({ ...site, isPrimary: true })
      .mockResolvedValueOnce({ id: "site-2" });

    const result = await deleteCustomerSite(actor(), "cust-1", {
      id: "site-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.customerSite.delete).toHaveBeenCalledWith({
      where: { id: "site-1" },
    });
    expect(mocks.prisma.customerSite.update).toHaveBeenCalledWith({
      where: { id: "site-2" },
      data: { isPrimary: true },
    });
  });

  it("fjerner primærflagget fra de andre ved nytt primærvalg", async () => {
    const result = await setPrimaryCustomerSite(actor(), "cust-1", {
      id: "site-1",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.customerSite.updateMany).toHaveBeenCalledWith({
      where: { customerId: "cust-1" },
      data: { isPrimary: false },
    });
    expect(mocks.prisma.customerSite.update).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { isPrimary: true },
    });
  });

  it("krever customers.manage for skriving", async () => {
    const result = await createCustomerSite(
      actor({ permissionsCustomized: true, permissions: ["customers.view"] }),
      "cust-1",
      { name: "Lager" },
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
