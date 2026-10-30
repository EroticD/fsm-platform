import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    upload: { count: vi.fn(), findMany: vi.fn() },
    product: { count: vi.fn(), findMany: vi.fn() },
    contract: { count: vi.fn(), findMany: vi.fn() },
    visit: { findMany: vi.fn(), findFirst: vi.fn() },
    customerSite: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    trackingLink: { updateMany: vi.fn(), create: vi.fn() },
    review: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  resolvePortalAccess: vi.fn(),
  requirePortalCapability: vi.fn(),
  listMessageThreads: vi.fn(),
  getMessageThread: vi.fn(),
  sendThreadMessage: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("./portal-access", () => ({
  resolvePortalAccess: mocks.resolvePortalAccess,
  requirePortalCapability: mocks.requirePortalCapability,
}));
vi.mock("./messaging", () => ({
  listMessageThreads: mocks.listMessageThreads,
  getMessageThread: mocks.getMessageThread,
  sendThreadMessage: mocks.sendThreadMessage,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import {
  PORTAL_LIST_PAGE_SIZE,
  createPortalSite,
  createPortalTrackingLink,
  requestPortalReview,
  getPortalContracts,
  getPortalDocuments,
  getPortalEquipment,
  getPortalMessageThreads,
  getPortalSites,
  getPortalVisitTimeline,
  sendPortalMessage,
} from "./portal-expansion";

const actor: ServiceActor = {
  id: "u1",
  name: "Kontakt",
  email: "kontakt@example.test",
  role: "CUSTOMER",
  isActive: true,
  departmentId: null,
  customerId: "cust-1",
  contactId: null,
  permissions: [],
  permissionsCustomized: false,
  roleDefinition: null,
};

const access = {
  actor,
  customerId: "cust-1",
  contactId: null,
  delegation: null,
  capabilities: {
    canBook: true,
    canViewDocuments: true,
    canViewContracts: true,
    canViewEquipment: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePortalAccess.mockResolvedValue({ ok: true, data: access });
  mocks.requirePortalCapability.mockResolvedValue({ ok: true, data: access });
  mocks.prisma.upload.count.mockResolvedValue(0);
  mocks.prisma.upload.findMany.mockResolvedValue([]);
  mocks.prisma.product.count.mockResolvedValue(0);
  mocks.prisma.product.findMany.mockResolvedValue([]);
  mocks.prisma.contract.count.mockResolvedValue(0);
  mocks.prisma.contract.findMany.mockResolvedValue([]);
  mocks.prisma.visit.findMany.mockResolvedValue([]);
  mocks.prisma.customerSite.findMany.mockResolvedValue([]);
  mocks.prisma.customerSite.count.mockResolvedValue(0);
  mocks.prisma.customerSite.create.mockResolvedValue({
    id: "site-1",
    name: "Lager",
    address: null,
    postalCode: null,
    city: null,
    isPrimary: true,
  });
  mocks.prisma.trackingLink.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.trackingLink.create.mockResolvedValue({ id: "tl-1" });
  mocks.prisma.review.upsert.mockResolvedValue({
    id: "rev-1",
    tokenHash: "hash",
    submittedAt: null,
  });
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
});

describe("portalens dokumentliste", () => {
  it("bruker sidestørrelse og canReadUpload per rad", async () => {
    mocks.prisma.upload.count.mockResolvedValue(2);
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        id: "up-1",
        storedName: "en.pdf",
        originalName: "en.pdf",
        mimeType: "application/pdf",
        size: 10,
        createdAt: new Date("2026-10-30T10:00:00Z"),
        ownerType: "CUSTOMER",
        ownerId: "cust-1",
        departmentId: null,
        customerId: "cust-1",
        uploadedById: "u1",
      },
      {
        id: "up-2",
        storedName: "fremmed.pdf",
        originalName: "fremmed.pdf",
        mimeType: "application/pdf",
        size: 10,
        createdAt: new Date("2026-10-30T10:00:00Z"),
        ownerType: "CUSTOMER",
        ownerId: "cust-2",
        departmentId: null,
        customerId: "cust-2",
        uploadedById: "u2",
      },
    ]);

    const result = await getPortalDocuments(actor, { page: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.map((item) => item.id)).toEqual(["up-1"]);
    expect(result.data.page).toBe(1);
    expect(mocks.prisma.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: PORTAL_LIST_PAGE_SIZE,
        where: { ownerType: "CUSTOMER", customerId: "cust-1" },
      }),
    );
  });

  it("avviser dokumenter uten dokumentkapabilitet", async () => {
    mocks.requirePortalCapability.mockResolvedValue({
      ok: false,
      reason: "forbidden",
    });
    await expect(getPortalDocuments(actor)).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(mocks.prisma.upload.findMany).not.toHaveBeenCalled();
  });
});

describe("portalens utstyr og avtaler", () => {
  it("begrenser utstyrslisten og tar med fase 3-data", async () => {
    mocks.prisma.product.count.mockResolvedValue(1);
    mocks.prisma.product.findMany.mockResolvedValue([
      {
        id: "p1",
        model: "Pumpe",
        serialNumber: "SN1",
        location: "Kjeller",
        status: "ACTIVE",
        criticality: 1,
        warrantyUntil: new Date("2027-01-01T00:00:00Z"),
        installDate: null,
        meterUnit: "timer",
        site: { name: "Hovedadresse" },
        category: { name: "Pumper" },
        meterReadings: [
          { value: 12.5, readAt: new Date("2026-10-01T00:00:00Z") },
        ],
        _count: { maintenancePlans: 2 },
      },
    ]);

    const result = await getPortalEquipment(actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]).toMatchObject({
      model: "Pumpe",
      siteName: "Hovedadresse",
      categoryName: "Pumper",
      activePlanCount: 2,
      lastReading: { value: 12.5 },
    });
    expect(mocks.prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: PORTAL_LIST_PAGE_SIZE }),
    );
  });

  it("begrenser avtaler og viser dekningslinjer", async () => {
    mocks.prisma.contract.count.mockResolvedValue(1);
    mocks.prisma.contract.findMany.mockResolvedValue([
      {
        id: "c1",
        title: "Serviceavtale",
        contractNumber: "A-1",
        status: "ACTIVE",
        isActive: true,
        intervalMonths: 12,
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: null,
        nextServiceDate: new Date("2027-01-01T00:00:00Z"),
        renewalMode: "MANUAL",
        slaPolicy: { name: "Standard" },
        lines: [
          {
            id: "l1",
            scope: "Alle pumper",
            visitsPerYear: 2,
            responseMinutes: 240,
            resolutionMinutes: 480,
            product: { model: "Pumpe" },
          },
        ],
      },
    ]);

    const result = await getPortalContracts(actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]).toMatchObject({
      contractNumber: "A-1",
      slaPolicyName: "Standard",
      lines: [{ productModel: "Pumpe", visitsPerYear: 2 }],
    });
    expect(mocks.prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: PORTAL_LIST_PAGE_SIZE }),
    );
  });
});

describe("portalens besøkstidslinje", () => {
  it("deler kommende og tidligere besøk og markerer sporing", async () => {
    const base = {
      allDay: false,
      technicians: [{ user: { name: "Kari" } }],
      trackingLinks: [{ id: "tl-1" }],
      reviews: [{ submittedAt: null }],
      workOrder: {
        id: "wo-1",
        title: "Service",
        address: null,
        postalCode: null,
        city: null,
        customer: {
          address: "Gate 1",
          postalCode: "0001",
          city: "Oslo",
        },
        site: null,
        department: { trackingEnabled: true },
      },
    };
    mocks.prisma.visit.findMany
      .mockResolvedValueOnce([
        {
          ...base,
          id: "v1",
          startsAt: new Date("2026-11-01T09:00:00Z"),
          endsAt: new Date("2026-11-01T10:00:00Z"),
          status: "EN_ROUTE",
        },
      ])
      .mockResolvedValueOnce([
        {
          ...base,
          id: "v2",
          startsAt: new Date("2026-10-01T09:00:00Z"),
          endsAt: new Date("2026-10-01T10:00:00Z"),
          status: "DONE",
          trackingLinks: [],
          reviews: [{ submittedAt: new Date("2026-10-02T00:00:00Z") }],
        },
      ]);

    const result = await getPortalVisitTimeline(actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.upcoming[0]).toMatchObject({
      id: "v1",
      canTrack: true,
      hasActiveTracking: true,
      address: "Gate 1, 0001, Oslo",
    });
    expect(result.data.past[0]).toMatchObject({
      id: "v2",
      canReview: false,
      reviewSubmitted: true,
    });
    expect(mocks.prisma.visit.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("portalens meldinger og steder", () => {
  it("sender melding gjennom meldingstjenesten sin kundesjekk", async () => {
    mocks.sendThreadMessage.mockResolvedValue({ ok: true, data: { id: "m" } });
    await sendPortalMessage(actor, "thread-1", "Hei");
    expect(mocks.sendThreadMessage).toHaveBeenCalledWith(
      actor,
      "thread-1",
      "Hei",
    );
  });

  it("henter bare kundens egne steder", async () => {
    await getPortalSites(actor);
    expect(mocks.prisma.customerSite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: "cust-1" },
        take: 50,
      }),
    );
  });

  it("oppretter sted med kundens id, aldri en klientstyrt kunde", async () => {
    const result = await createPortalSite(actor, { name: "Lager" });
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
  });

  it("lar listefunksjonen bruke sidestørrelse", async () => {
    mocks.listMessageThreads.mockResolvedValue({ ok: true, data: {} });
    await getPortalMessageThreads(actor, { page: 2 });
    expect(mocks.listMessageThreads).toHaveBeenCalledWith(actor, {
      page: 2,
      customerId: "cust-1",
    });
  });
});

describe("portalens sporing og omtale", () => {
  const visitRow = {
    id: "v1",
    workOrderId: "wo-1",
    endsAt: new Date(Date.now() + 60 * 60_000),
    status: "EN_ROUTE",
    workOrder: {
      title: "Service",
      department: { trackingEnabled: true },
    },
  };

  it("lager en ny sporingslenke for et aktivt besøk", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(visitRow);
    const result = await createPortalTrackingLink(actor, "v1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token).toHaveLength(64);
    expect(mocks.prisma.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { visitId: "v1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.prisma.trackingLink.create).toHaveBeenCalledTimes(1);
  });

  it("avviser sporing når avdelingen har slått det av", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue({
      ...visitRow,
      workOrder: { title: "Service", department: { trackingEnabled: false } },
    });
    await expect(createPortalTrackingLink(actor, "v1")).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("ber om omtale bare for et fullført besøk", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue({
      id: "v1",
      workOrderId: "wo-1",
      status: "DONE",
      workOrder: { title: "Service" },
    });
    mocks.prisma.review.upsert.mockImplementation(
      async (args: { create: { tokenHash: string } }) => ({
        id: "rev-1",
        tokenHash: args.create.tokenHash,
        submittedAt: null,
      }),
    );

    const result = await requestPortalReview(actor, "v1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token).toHaveLength(64);
  });
});
