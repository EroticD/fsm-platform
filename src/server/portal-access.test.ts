import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    customer: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    portalDelegation: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  portalAccessAllows,
  portalCapabilitiesFor,
  resolvePortalAccess,
} from "./portal-access";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "u1",
    name: "Kontakt",
    email: "kontakt@example.test",
    role: "CUSTOMER",
    isActive: true,
    departmentId: null,
    customerId: "cust-1",
    contactId: "contact-1",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: null,
    ...overrides,
  };
}

const delegation = (overrides: Record<string, unknown> = {}) => ({
  id: "del-1",
  canBook: true,
  canViewDocuments: false,
  canViewContracts: false,
  canViewEquipment: true,
  isActive: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" });
  mocks.prisma.contact.findFirst.mockResolvedValue({ id: "contact-1" });
  mocks.prisma.portalDelegation.findUnique.mockResolvedValue(null);
});

describe("resolvePortalAccess", () => {
  it("gir full tilgang når kontakten ikke har en delegasjonsrad", async () => {
    const result = await resolvePortalAccess(actor());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.capabilities).toEqual({
      canBook: true,
      canViewDocuments: true,
      canViewContracts: true,
      canViewEquipment: true,
    });
    expect(portalAccessAllows(result.data, "canViewDocuments")).toBe(true);
  });

  it("bruker delegasjonsmatrisen for alle fire kapabiliteter", async () => {
    mocks.prisma.portalDelegation.findUnique.mockResolvedValue(
      delegation({
        canBook: false,
        canViewDocuments: true,
        canViewContracts: false,
        canViewEquipment: false,
      }),
    );
    const result = await resolvePortalAccess(actor());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.capabilities).toEqual({
      canBook: false,
      canViewDocuments: true,
      canViewContracts: false,
      canViewEquipment: false,
    });
  });

  it("stenger portalen for en inaktiv delegasjon", async () => {
    mocks.prisma.portalDelegation.findUnique.mockResolvedValue(
      delegation({ isActive: false }),
    );
    await expect(resolvePortalAccess(actor())).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("avviser en kontakt som ikke tilhører kunden", async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(null);
    await expect(resolvePortalAccess(actor())).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("avviser slettet kunde, manglende kunde og andre roller", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue(null);
    await expect(resolvePortalAccess(actor())).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
    mocks.prisma.customer.findFirst.mockResolvedValue({ id: "cust-1" });
    await expect(
      resolvePortalAccess(actor({ role: "OFFICE" })),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(
      resolvePortalAccess(actor({ customerId: null })),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("portalCapabilitiesFor", () => {
  it("returnerer full tilgang uten delegasjon", () => {
    expect(portalCapabilitiesFor(null)).toEqual({
      canBook: true,
      canViewDocuments: true,
      canViewContracts: true,
      canViewEquipment: true,
    });
  });

  it("kopierer bare de eksplisitte flaggene", () => {
    expect(
      portalCapabilitiesFor({
        canBook: true,
        canViewDocuments: false,
        canViewContracts: true,
        canViewEquipment: false,
        isActive: true,
      }),
    ).toEqual({
      canBook: true,
      canViewDocuments: false,
      canViewContracts: true,
      canViewEquipment: false,
    });
  });
});
