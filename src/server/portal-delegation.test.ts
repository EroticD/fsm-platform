import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    contact: { findFirst: vi.fn() },
    portalDelegation: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { savePortalDelegation } from "./portal-delegation";

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

const saved = {
  contactId: "contact-1",
  isActive: true,
  canBook: false,
  canViewDocuments: true,
  canViewContracts: false,
  canViewEquipment: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.contact.findFirst.mockResolvedValue({
    id: "contact-1",
    name: "Kontakt",
  });
  mocks.prisma.portalDelegation.upsert.mockResolvedValue(saved);
  mocks.audit.mockResolvedValue(undefined);
});

describe("portaldelegering", () => {
  it("lagrer eksplisitte flagg, også når de er av", async () => {
    const result = await savePortalDelegation(actor(), "cust-1", {
      contactId: "contact-1",
      isActive: "true",
      canBook: undefined,
      canViewDocuments: "true",
      canViewContracts: undefined,
      canViewEquipment: "true",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.portalDelegation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId: "contact-1" },
        create: expect.objectContaining({
          contactId: "contact-1",
          isActive: true,
          canBook: false,
          canViewDocuments: true,
          canViewContracts: false,
          canViewEquipment: true,
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("avviser en kontakt som ikke tilhører kunden", async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(null);

    const result = await savePortalDelegation(actor(), "cust-1", {
      contactId: "annens-kontakt",
      isActive: "true",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_contact" });
    expect(mocks.prisma.portalDelegation.upsert).not.toHaveBeenCalled();
  });

  it("krever customers.manage", async () => {
    const result = await savePortalDelegation(
      actor({ permissionsCustomized: true, permissions: ["customers.view"] }),
      "cust-1",
      { contactId: "contact-1", isActive: "true" },
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
