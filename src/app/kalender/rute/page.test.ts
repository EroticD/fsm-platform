import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  userFindMany: vi.fn(),
  getRoutePlan: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "nb"),
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/lib/access", () => ({ staffScope: () => ({}) }));
vi.mock("@/lib/prisma", () => ({
  default: { user: { findMany: mocks.userFindMany } },
}));
vi.mock("@/server/map-settings", () => ({
  getMapSettings: vi.fn(async () => ({
    provider: "osm",
    apiKey: null,
    defaultLayer: "osm",
    defaultZoom: 6,
    centerLat: null,
    centerLng: null,
    scrollWheelZoom: true,
  })),
}));
vi.mock("@/server/route-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/route-plan")>();
  return { ...actual, getRoutePlan: mocks.getRoutePlan };
});
vi.mock("@/components/WorkOrderMap", () => ({ default: () => null }));
vi.mock("@/components/IsoDateInput", () => ({ default: () => null }));
vi.mock("@/app/kalender/CalendarShell", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./actions", () => ({ applyRouteOrderAction: vi.fn() }));

import RoutePage from "./page";

const user = {
  id: "office-1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
};

function stop(overrides: Record<string, unknown> = {}) {
  return {
    visitId: "visit-1",
    workOrderId: "wo-1",
    workOrderTitle: "Årlig service",
    customerName: "Kunde AS",
    address: "Storgata 1, 6002 Ålesund",
    status: "PLANNED",
    sequence: 1,
    plannedStartsAt: new Date("2026-11-03T09:00:00.000Z"),
    plannedEndsAt: new Date("2026-11-03T10:00:00.000Z"),
    arrivalAt: new Date("2026-11-03T08:50:00.000Z"),
    startsAt: new Date("2026-11-03T09:00:00.000Z"),
    endsAt: new Date("2026-11-03T10:00:00.000Z"),
    waitMinutes: 10,
    travelMinutes: 20,
    distanceKm: 12,
    point: { latitude: 62.47, longitude: 6.15 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.hasPermission.mockReturnValue(true);
  mocks.userFindMany.mockResolvedValue([{ id: "tech-1", name: "Ola Montør" }]);
  mocks.getRoutePlan.mockResolvedValue({
    ok: true,
    data: {
      date: "2026-11-03",
      plans: [
        {
          technicianId: "tech-1",
          technicianName: "Ola Montør",
          technicianEmail: "ola@example.test",
          stops: [stop()],
          skipped: [
            {
              visitId: "visit-2",
              workOrderId: "wo-2",
              workOrderTitle: "Uten adresse",
              reason: "missing_coordinates",
            },
          ],
          totalDistanceKm: 12,
          totalTravelMinutes: 20,
          totalWaitingMinutes: 10,
          startAt: new Date("2026-11-03T09:00:00.000Z"),
          finishAt: new Date("2026-11-03T10:00:00.000Z"),
          provider: "haversine",
          fallbackUsed: false,
        },
      ],
    },
  });
});

describe("ruteplan-side", () => {
  it("viser per-stopp-ETA og knappen for å bruke rekkefølgen", async () => {
    const html = renderToStaticMarkup(
      await RoutePage({ searchParams: Promise.resolve({ dato: "2026-11-03" }) }),
    );

    expect(html).toContain("Ola Montør");
    expect(html).toContain("calendar.route.totalDrive");
    expect(html).toContain("calendar.route.applyOrder");
    expect(html).toContain("calendar.route.skippedMissingCoordinates");
    expect(html).toContain('name="visitId"');
    expect(html).toContain('value="visit-1"');
  });

  it("redirecter brukere uten tildelingsrettighet", async () => {
    mocks.hasPermission.mockReturnValue(false);

    await expect(
      RoutePage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/kalender");
    expect(mocks.getRoutePlan).not.toHaveBeenCalled();
  });
});
