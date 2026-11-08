import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitStatus, WorkStatus } from "@prisma/client";
import type { ServiceActor } from "./actor";
import type { RoutingProvider, TravelEstimate } from "@/lib/routing/types";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findMany: vi.fn() },
    visit: { findMany: vi.fn(), update: vi.fn() },
    absence: { findMany: vi.fn() },
    businessHours: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  recomputeWorkOrderSchedule: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("./visits", () => ({
  recomputeWorkOrderSchedule: mocks.recomputeWorkOrderSchedule,
}));

import {
  applyRouteOrder,
  getRoutePlan,
  planTechnicianRoute,
  ROUTE_ERROR_CODES,
} from "./route-plan";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "office-1",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: ["workorders.view", "workorders.assign"],
    },
    ...overrides,
  };
}

function leg(minutes: number, km = minutes): TravelEstimate {
  return { durationMinutes: minutes, distanceKm: km, provider: "haversine" };
}

function provider(values: number[][]): RoutingProvider {
  return {
    name: "osrm",
    route: vi.fn(async () => leg(10)),
    matrix: vi.fn(async () =>
      values.map((row) => row.map((minutes) => leg(minutes))),
    ),
  };
}

function visitRow(overrides: {
  id: string;
  startsAt: string;
  endsAt: string;
  userId?: string;
  lat?: number | null;
  lng?: number | null;
  title?: string;
  status?: string;
  workOrderStatus?: string;
  requiredSkills?: Array<{ skillId: string; mandatory: boolean }>;
}) {
  return {
    id: overrides.id,
    workOrderId: `wo-${overrides.id}`,
    startsAt: new Date(overrides.startsAt),
    endsAt: new Date(overrides.endsAt),
    status: (overrides.status ?? "PLANNED") as VisitStatus,
    sequence: 0,
    technicians: [{ userId: overrides.userId ?? "tech-1" }],
    workOrder: {
      id: `wo-${overrides.id}`,
      title: overrides.title ?? `Oppdrag ${overrides.id}`,
      address: "Storgata 1",
      postalCode: "6002",
      city: "Ålesund",
      latitude: overrides.lat === undefined ? 62.47 : overrides.lat,
      longitude: overrides.lng === undefined ? 6.15 : overrides.lng,
      legalHold: false,
      status: (overrides.workOrderStatus ?? "OPEN") as WorkStatus,
      skillRequirements: overrides.requiredSkills ?? [],
      slaClocks: [],
      site: null,
      customer: {
        id: "cust-1",
        name: "Kunde AS",
        address: "Storgata 1",
        postalCode: "6002",
        city: "Ålesund",
        sites: [],
      },
    },
  };
}

const technician = { id: "tech-1", name: "Ola Montør", email: "ola@example.test" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.user.findMany.mockResolvedValue([technician]);
  mocks.prisma.visit.findMany.mockResolvedValue([]);
  mocks.prisma.visit.update.mockResolvedValue({});
  mocks.prisma.absence.findMany.mockResolvedValue([]);
  mocks.prisma.businessHours.findMany.mockResolvedValue([]);
  mocks.audit.mockResolvedValue(undefined);
  mocks.recomputeWorkOrderSchedule.mockResolvedValue(undefined);
});

describe("planTechnicianRoute", () => {
  it("velger en deterministisk nærmeste-nabo-rute og beregner ETA", async () => {
    const visits = [
      visitRow({
        id: "a",
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T10:00:00.000Z",
        lat: 62.47,
      }),
      visitRow({
        id: "b",
        startsAt: "2026-11-03T10:00:00.000Z",
        endsAt: "2026-11-03T11:00:00.000Z",
        lat: 62.48,
      }),
      visitRow({
        id: "c",
        startsAt: "2026-11-03T11:00:00.000Z",
        endsAt: "2026-11-03T12:00:00.000Z",
        lat: 62.49,
      }),
    ];
    const routing = provider([
      [0, 10, 50, 30],
      [10, 0, 5, 20],
      [50, 5, 0, 4],
      [30, 20, 4, 0],
    ]);
    const input = {
      technician,
      visits,
      routing,
      startAt: new Date("2026-11-03T08:00:00.000Z"),
    };

    const result = await planTechnicianRoute(input);

    expect(result.stops.map((stop) => stop.visitId)).toEqual(["a", "b", "c"]);
    expect(result.totalTravelMinutes).toBe(19);
    expect(result.stops[0].startsAt).toEqual(
      new Date("2026-11-03T09:00:00.000Z"),
    );
    expect(result.stops[1].startsAt).toEqual(
      new Date("2026-11-03T10:05:00.000Z"),
    );
    expect(result.stops[0].arrivalAt).toEqual(
      new Date("2026-11-03T08:10:00.000Z"),
    );
    expect(result.finishAt).toEqual(new Date("2026-11-03T12:09:00.000Z"));
    expect(result).toEqual(await planTechnicianRoute(input));
  });

  it("håndterer tom og én stopp uten matrisefeil", async () => {
    const empty = await planTechnicianRoute({
      technician,
      visits: [],
      routing: provider([]),
      startAt: new Date("2026-11-03T08:00:00.000Z"),
    });
    expect(empty.stops).toEqual([]);
    expect(empty.skipped).toEqual([]);
    expect(empty.finishAt).toBeNull();

    const single = await planTechnicianRoute({
      technician,
      visits: [
        visitRow({
          id: "a",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        }),
      ],
      routing: provider([
        [0, 0],
        [0, 0],
      ]),
      startAt: new Date("2026-11-03T08:00:00.000Z"),
    });
    expect(single.stops).toHaveLength(1);
    expect(single.totalTravelMinutes).toBe(0);
    expect(single.stops[0].waitMinutes).toBe(60);
  });

  it("hopper over visiter uten koordinater", async () => {
    const result = await planTechnicianRoute({
      technician,
      visits: [
        visitRow({
          id: "a",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        }),
        visitRow({
          id: "uten",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
          lat: null,
          lng: null,
        }),
      ],
      routing: provider([
        [0, 0],
        [0, 0],
      ]),
      startAt: new Date("2026-11-03T08:00:00.000Z"),
    });

    expect(result.stops.map((stop) => stop.visitId)).toEqual(["a"]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        visitId: "uten",
        reason: "missing_coordinates",
      }),
    ]);
  });

  it("rapporterer manglende kompetanse som årsak", async () => {
    const result = await planTechnicianRoute({
      technician,
      visits: [
        visitRow({
          id: "a",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        }),
        visitRow({
          id: "b",
          startsAt: "2026-11-03T10:00:00.000Z",
          endsAt: "2026-11-03T11:00:00.000Z",
          requiredSkills: [{ skillId: "el-kontroll", mandatory: true }],
        }),
      ],
      routing: provider([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
      startAt: new Date("2026-11-03T08:00:00.000Z"),
      technicianSkillIds: [],
    });

    expect(result.stops.map((stop) => stop.visitId)).toEqual(["a"]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        visitId: "b",
        reason: "missing_skills",
      }),
    ]);
  });

  it("respekterer arbeidstid og rapporterer årsak", async () => {
    const result = await planTechnicianRoute({
      technician,
      visits: [
        visitRow({
          id: "a",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        }),
        visitRow({
          id: "sen",
          startsAt: "2026-11-03T15:30:00.000Z",
          endsAt: "2026-11-03T17:00:00.000Z",
        }),
      ],
      routing: provider([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
      startAt: new Date("2026-11-03T08:00:00.000Z"),
      workingHours: {
        start: new Date("2026-11-03T08:00:00.000Z"),
        end: new Date("2026-11-03T16:00:00.000Z"),
      },
    });

    expect(result.stops.map((stop) => stop.visitId)).toEqual(["a"]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ visitId: "sen", reason: "working_hours" }),
    ]);
  });

  it("merker en allerede ordnet dag uten endring", async () => {
    const result = await planTechnicianRoute({
      technician,
      visits: [
        visitRow({
          id: "a",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        }),
        visitRow({
          id: "b",
          startsAt: "2026-11-03T10:00:00.000Z",
          endsAt: "2026-11-03T11:00:00.000Z",
        }),
      ],
      routing: provider([
        [0, 5, 30],
        [5, 0, 5],
        [30, 5, 0],
      ]),
      startAt: new Date("2026-11-03T08:00:00.000Z"),
    });

    expect(result.stops.map((stop) => stop.visitId)).toEqual(["a", "b"]);
    expect(result.orderChanged).toBe(false);
    expect(result.savedTravelMinutes).toBe(0);
    expect(result.savedDistanceKm).toBe(0);
  });

  it("rapporterer fravær som konfliktårsak", async () => {
    const result = await planTechnicianRoute({
      technician,
      visits: [
        visitRow({
          id: "a",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        }),
        visitRow({
          id: "b",
          startsAt: "2026-11-03T10:00:00.000Z",
          endsAt: "2026-11-03T11:00:00.000Z",
        }),
      ],
      routing: provider([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
      startAt: new Date("2026-11-03T08:00:00.000Z"),
      absences: [
        {
          startsAt: new Date("2026-11-03T10:15:00.000Z"),
          endsAt: new Date("2026-11-03T10:45:00.000Z"),
        },
      ],
    });

    expect(result.stops.map((stop) => stop.visitId)).toEqual(["a"]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ visitId: "b", reason: "absence" }),
    ]);
  });

  it("faller tilbake til haversine når leverandøren kaster", async () => {
    const routing: RoutingProvider = {
      name: "osrm",
      route: vi.fn(),
      matrix: vi.fn(async () => {
        throw new Error("nede");
      }),
    };

    const result = await planTechnicianRoute({
      technician,
      visits: [
        visitRow({
          id: "a",
          startsAt: "2026-11-03T09:00:00.000Z",
          endsAt: "2026-11-03T10:00:00.000Z",
        }),
      ],
      routing,
      startAt: new Date("2026-11-03T08:00:00.000Z"),
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.provider).toBe("haversine");
    expect(result.stops).toHaveLength(1);
    expect(result.totalTravelMinutes).toBe(0);
  });
});

describe("ruteplan-tjeneste", () => {
  it("avviser brukere uten workorders.view", async () => {
    const noAccess = actor({
      roleDefinition: { permissions: [] },
    });

    await expect(
      getRoutePlan(noAccess, { date: "2026-11-03" }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
      details: { code: ROUTE_ERROR_CODES.forbidden },
    });
    expect(mocks.prisma.visit.findMany).not.toHaveBeenCalled();
  });

  it("grupperer dagens visiter per montør med starttid fra nå", async () => {
    const morning = visitRow({
      id: "a",
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T10:00:00.000Z",
    });
    const later = visitRow({
      id: "b",
      startsAt: "2026-11-03T11:00:00.000Z",
      endsAt: "2026-11-03T12:00:00.000Z",
    });
    mocks.prisma.visit.findMany.mockResolvedValue([morning, later]);

    const result = await getRoutePlan(
      actor(),
      { date: "2026-11-03", technicianId: "tech-1" },
      {
        now: new Date("2026-11-03T08:30:00.000Z"),
        routing: provider([
          [0, 0, 10],
          [0, 0, 10],
          [10, 10, 0],
        ]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.plans).toHaveLength(1);
    expect(result.data.plans[0].stops.map((stop) => stop.visitId)).toEqual([
      "a",
      "b",
    ]);
    expect(result.data.plans[0].startAt).toEqual(
      new Date("2026-11-03T09:00:00.000Z"),
    );
  });

  it("avviser brukere uten workorders.assign ved bruk av rekkefølgen", async () => {
    const viewOnly = actor({
      roleDefinition: { permissions: ["workorders.view"] },
    });

    await expect(
      applyRouteOrder(viewOnly, {
        date: "2026-11-03",
        technicianId: "tech-1",
        visitIds: ["a"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
      details: { code: ROUTE_ERROR_CODES.forbidden },
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser en rekkefølge som ikke matcher den viste planen", async () => {
    mocks.prisma.visit.findMany.mockResolvedValue([
      visitRow({
        id: "a",
        startsAt: "2026-11-03T09:00:00.000Z",
        endsAt: "2026-11-03T10:00:00.000Z",
      }),
    ]);

    const result = await applyRouteOrder(
      actor(),
      {
        date: "2026-11-03",
        technicianId: "tech-1",
        visitIds: ["b"],
      },
      {
        now: new Date("2026-11-03T08:00:00.000Z"),
        routing: provider([[0]]),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: ROUTE_ERROR_CODES.orderMismatch },
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("flytter visitten til foreslått tid, revisjonslogger og oppdaterer oppdraget", async () => {
    const first = visitRow({
      id: "a",
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T10:00:00.000Z",
    });
    const second = visitRow({
      id: "b",
      startsAt: "2026-11-03T10:00:00.000Z",
      endsAt: "2026-11-03T11:00:00.000Z",
    });
    mocks.prisma.visit.findMany
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([]);

    const result = await applyRouteOrder(
      actor(),
      {
        date: "2026-11-03",
        technicianId: "tech-1",
        visitIds: ["a", "b"],
      },
      {
        now: new Date("2026-11-03T08:00:00.000Z"),
        routing: provider([
          [0, 0, 45],
          [0, 0, 45],
          [45, 45, 0],
        ]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.applied).toBe(1);
    expect(mocks.prisma.visit.update).toHaveBeenCalledWith({
      where: { id: "b" },
      data: {
        startsAt: new Date("2026-11-03T10:45:00.000Z"),
        endsAt: new Date("2026-11-03T11:45:00.000Z"),
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: "Visit",
        entityId: "b",
        action: expect.stringContaining("ruteplan"),
        metadata: expect.objectContaining({
          technicianId: "tech-1",
          provider: "haversine",
          savedTravelMinutes: expect.any(Number),
          savedDistanceKm: expect.any(Number),
          orderChanged: expect.any(Boolean),
        }),
      }),
    );
    expect(mocks.recomputeWorkOrderSchedule).toHaveBeenCalledWith(
      expect.anything(),
      "wo-b",
    );
  });

  it("avbryter hele flyttingen ved fravær", async () => {
    const first = visitRow({
      id: "a",
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T10:00:00.000Z",
    });
    const second = visitRow({
      id: "b",
      startsAt: "2026-11-03T10:00:00.000Z",
      endsAt: "2026-11-03T11:00:00.000Z",
    });
    mocks.prisma.visit.findMany
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([first, second]);
    mocks.prisma.absence.findMany.mockResolvedValue([
      {
        userId: "tech-1",
        startsAt: new Date("2026-11-03T10:40:00.000Z"),
        endsAt: new Date("2026-11-03T11:00:00.000Z"),
      },
    ]);

    const result = await applyRouteOrder(
      actor(),
      {
        date: "2026-11-03",
        technicianId: "tech-1",
        visitIds: ["a", "b"],
      },
      {
        now: new Date("2026-11-03T08:00:00.000Z"),
        routing: provider([
          [0, 0, 45],
          [0, 0, 45],
          [45, 45, 0],
        ]),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: ROUTE_ERROR_CODES.absence, visitId: "b" },
    });
    expect(mocks.prisma.visit.update).not.toHaveBeenCalled();
  });

  it("avbryter når flyttingen overlapper en fast visitt", async () => {
    const first = visitRow({
      id: "a",
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T10:00:00.000Z",
    });
    const second = visitRow({
      id: "b",
      startsAt: "2026-11-03T10:00:00.000Z",
      endsAt: "2026-11-03T11:00:00.000Z",
    });
    mocks.prisma.visit.findMany
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([
        {
          id: "fast",
          startsAt: new Date("2026-11-03T10:45:00.000Z"),
          endsAt: new Date("2026-11-03T11:15:00.000Z"),
          technicians: [{ userId: "tech-1" }],
        },
      ]);

    const result = await applyRouteOrder(
      actor(),
      {
        date: "2026-11-03",
        technicianId: "tech-1",
        visitIds: ["a", "b"],
      },
      {
        now: new Date("2026-11-03T08:00:00.000Z"),
        routing: provider([
          [0, 0, 45],
          [0, 0, 45],
          [45, 45, 0],
        ]),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: ROUTE_ERROR_CODES.overlap, visitId: "b" },
    });
    expect(mocks.prisma.visit.update).not.toHaveBeenCalled();
  });
});
