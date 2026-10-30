import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    trackingLink: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    visit: { findFirst: vi.fn() },
    visitLocationPing: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  allowRequestDb: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));

import {
  cleanupVisitLocationPings,
  createTrackingLink,
  getPublicTracking,
  hashTrackingToken,
  recordLocationPing,
  revokeTrackingLink,
  revokeTrackingLinksForVisit,
  TRACKING_LINK_TTL_AFTER_VISIT_MS,
  TRACKING_TOKEN_PATTERN,
} from "./tracking";

const TOKEN = "a".repeat(64);
const NOW = new Date("2026-10-30T12:00:00.000Z");
const VISIT_ENDS_AT = new Date(Date.now() + 2 * 60 * 60_000);

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "tech-1",
    name: "Kari Nordmann",
    email: "kari@example.test",
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "dep-1",
    permissionsCustomized: true,
    permissions: ["workorders.edit", "workorders.update"],
    roleDefinition: null,
    ...overrides,
  };
}

function visit(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-1",
    workOrderId: "wo-1",
    endsAt: VISIT_ENDS_AT,
    status: "ASSIGNED",
    workOrder: {
      title: "Årlig service",
      department: { trackingEnabled: true },
    },
    ...overrides,
  };
}

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    expiresAt: new Date("2026-10-30T16:00:00.000Z"),
    revokedAt: null,
    visitId: "visit-1",
    visit: {
      status: "EN_ROUTE",
      technicians: [{ user: { name: "Kari Nordmann" } }],
      workOrder: {
        latitude: 60.3913,
        longitude: 5.3221,
        department: { trackingEnabled: true },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (client: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.visit.findFirst.mockResolvedValue(visit());
  mocks.prisma.visitLocationPing.create.mockResolvedValue({
    id: "ping-1",
    recordedAt: NOW,
  });
  mocks.prisma.visitLocationPing.findFirst.mockResolvedValue(null);
  mocks.prisma.trackingLink.update.mockResolvedValue({});
  mocks.prisma.trackingLink.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.trackingLink.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "link-new",
      ...data,
    }),
  );
  mocks.prisma.trackingLink.findUnique.mockResolvedValue(link());
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.audit.mockResolvedValue(undefined);
});

describe("sporingslenke", () => {
  it("lagrer bare hash og bruker visittens slutt + to timer", async () => {
    const result = await createTrackingLink(actor(), "visit-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.token).toMatch(TRACKING_TOKEN_PATTERN);
    expect(mocks.prisma.trackingLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenHash: hashTrackingToken(result.data.token),
          visitId: "visit-1",
          workOrderId: "wo-1",
          expiresAt: new Date(
            VISIT_ENDS_AT.getTime() + TRACKING_LINK_TTL_AFTER_VISIT_MS,
          ),
        }),
      }),
    );
    // Klarteksttokenet skal ikke finnes i noe databaseargument.
    const stored = JSON.stringify(
      mocks.prisma.trackingLink.create.mock.calls[0][0],
    );
    expect(stored).not.toContain(result.data.token);
  });

  it("tilbakekaller eksisterende lenker for samme visitt", async () => {
    await createTrackingLink(actor(), "visit-1");

    expect(mocks.prisma.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { visitId: "visit-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("nekter når avdelingen ikke har sporing på", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(
      visit({
        workOrder: {
          title: "Årlig service",
          department: { trackingEnabled: false },
        },
      }),
    );

    const result = await createTrackingLink(actor(), "visit-1");

    expect(result).toMatchObject({
      ok: false,
      reason: "forbidden",
      details: { code: "tracking.errors.disabled" },
    });
    expect(mocks.prisma.trackingLink.create).not.toHaveBeenCalled();
  });

  it("nekter lenker for avsluttede visiter", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(visit({ status: "DONE" }));

    const result = await createTrackingLink(actor(), "visit-1");

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "tracking.errors.visitLocked" },
    });
  });

  it("tilbakekalling er idempotent", async () => {
    const revokedAt = new Date("2026-10-30T11:00:00.000Z");
    mocks.prisma.trackingLink.findFirst.mockResolvedValue({
      id: "link-1",
      workOrderId: "wo-1",
      visitId: "visit-1",
      revokedAt,
      workOrder: { title: "Årlig service" },
    });

    const result = await revokeTrackingLink(actor(), "link-1");

    expect(result).toEqual({ ok: true, data: { revokedAt } });
    expect(mocks.prisma.trackingLink.update).not.toHaveBeenCalled();
  });

  it("masse-tilbakekaller alle aktive lenker for en avsluttet visitt", async () => {
    const count = await revokeTrackingLinksForVisit(
      mocks.prisma as never,
      "visit-1",
    );

    expect(count).toBe(1);
    expect(mocks.prisma.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { visitId: "visit-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe("offentlig sporing", () => {
  it("viser fornavn, status og ETA uten koordinater", async () => {
    mocks.prisma.visitLocationPing.findFirst.mockResolvedValue({
      latitude: 59.9139,
      longitude: 10.7522,
      recordedAt: new Date("2026-10-30T11:59:00.000Z"),
    });

    const result = await getPublicTracking(TOKEN, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      technicianFirstName: "Kari",
      status: "EN_ROUTE",
      lastUpdatedAt: new Date("2026-10-30T11:59:00.000Z"),
    });
    expect(result.data.etaMinutes).toBeGreaterThan(0);
    expect(result.data.estimatedArrivalAt).toBeInstanceOf(Date);
    expect(result.data).not.toHaveProperty("latitude");
    expect(result.data).not.toHaveProperty("longitude");
    expect(JSON.stringify(result.data)).not.toContain("59.9139");
  });

  it("gir ingen ETA uten et posisjonsping", async () => {
    const result = await getPublicTracking(TOKEN, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.etaMinutes).toBeNull();
    expect(result.data.estimatedArrivalAt).toBeNull();
    expect(result.data.lastUpdatedAt).toBeNull();
  });

  it("gir 404 etter utløp", async () => {
    mocks.prisma.trackingLink.findUnique.mockResolvedValue(
      link({ expiresAt: new Date("2026-10-30T11:59:00.000Z") }),
    );

    await expect(getPublicTracking(TOKEN, NOW)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("gir 404 etter tilbakekalling", async () => {
    mocks.prisma.trackingLink.findUnique.mockResolvedValue(
      link({ revokedAt: new Date("2026-10-30T11:00:00.000Z") }),
    );

    await expect(getPublicTracking(TOKEN, NOW)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("gir 404 når visitten er DONE, også om et gammelt ping finnes", async () => {
    mocks.prisma.trackingLink.findUnique.mockResolvedValue(
      link({
        visit: {
          ...link().visit,
          status: "DONE",
        },
      }),
    );

    await expect(getPublicTracking(TOKEN, NOW)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.prisma.visitLocationPing.findFirst).not.toHaveBeenCalled();
  });

  it("avviser ugyldig tokenformat før databasen", async () => {
    await expect(getPublicTracking("abc", NOW)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.prisma.trackingLink.findUnique).not.toHaveBeenCalled();
  });

  it("rate-limiter per gyldig token", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });

    await expect(getPublicTracking(TOKEN, NOW)).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 42,
    });
  });
});

describe("posisjonsping", () => {
  it("lagrer ping for tildelt montør på EN_ROUTE-visitt", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue({ id: "visit-1" });

    const result = await recordLocationPing(actor(), {
      visitId: "visit-1",
      latitude: 59.9139,
      longitude: 10.7522,
    });

    expect(result).toEqual({
      ok: true,
      data: { id: "ping-1", recordedAt: NOW },
    });
    expect(mocks.prisma.visit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "visit-1",
          status: "EN_ROUTE",
          technicians: { some: { userId: "tech-1" } },
          workOrder: {
            deletedAt: null,
            department: { isActive: true, trackingEnabled: true },
          },
        }),
      }),
    );
    expect(mocks.prisma.visitLocationPing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visitId: "visit-1",
          userId: "tech-1",
          latitude: 59.9139,
          longitude: 10.7522,
        }),
      }),
    );
  });

  it("avviser ugyldige koordinater før oppslag", async () => {
    const result = await recordLocationPing(actor(), {
      visitId: "visit-1",
      latitude: 91,
      longitude: 10,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      details: { code: "tracking.errors.invalidCoordinates" },
    });
    expect(mocks.prisma.visit.findFirst).not.toHaveBeenCalled();
  });

  it("avviser montør som ikke er tildelt visitten", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue(null);

    const result = await recordLocationPing(actor(), {
      visitId: "visit-1",
      latitude: 59.9139,
      longitude: 10.7522,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.visitLocationPing.create).not.toHaveBeenCalled();
  });

  it("rydder ping eldre enn 24 timer", async () => {
    mocks.prisma.visitLocationPing.deleteMany.mockResolvedValue({ count: 7 });

    const deleted = await cleanupVisitLocationPings(NOW);

    expect(deleted).toBe(7);
    expect(mocks.prisma.visitLocationPing.deleteMany).toHaveBeenCalledWith({
      where: {
        recordedAt: { lt: new Date(NOW.getTime() - 24 * 60 * 60_000) },
      },
    });
  });
});
