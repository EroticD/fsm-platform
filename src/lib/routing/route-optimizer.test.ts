import { describe, expect, it } from "vitest";
import { optimiseRoute, type RouteWindow } from "./route-optimizer";
import type { TravelEstimate } from "./types";

function leg(minutes: number, km = minutes / 2): TravelEstimate {
  return { durationMinutes: minutes, distanceKm: km, provider: "haversine" };
}

function matrix(values: number[][]): TravelEstimate[][] {
  return values.map((row) => row.map((minutes) => leg(minutes)));
}

const start = { latitude: 60, longitude: 10 };
const point = (lat: number) => ({ latitude: lat, longitude: 10 });

function visit(
  id: string,
  startsAt: string,
  endsAt: string,
  latitude: number,
  serviceMinutes = 60,
): RouteWindow {
  return {
    id,
    point: point(latitude),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    serviceMinutes,
  };
}

describe("ruteoptimalisering", () => {
  it("velger nærmeste nabo og forbedrer med 2-opt", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
      visit("b", "2026-11-02T10:00:00.000Z", "2026-11-02T12:00:00.000Z", 62),
      visit("c", "2026-11-02T11:00:00.000Z", "2026-11-02T13:00:00.000Z", 63),
    ];
    // Rad 0 er startpunktet, rad 1–3 er a, b og c.
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 10, 50, 30],
        [10, 0, 5, 20],
        [50, 5, 0, 4],
        [30, 20, 4, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    });

    expect(result.order.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(result.totalTravelMinutes).toBe(19);
    expect(result.skipped).toEqual([]);
  });

  it("planlegger en visitt utenfor tidsvinduet med flagg i stedet for å hoppe over", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
      // Reisen fra a tar 120 minutter, så b kan ikke nås før 12:00.
      visit("b", "2026-11-02T10:30:00.000Z", "2026-11-02T11:30:00.000Z", 62),
    ];
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 10, 10],
        [10, 0, 120],
        [10, 120, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    });

    expect(result.order.map((row) => row.id)).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([]);
    expect(result.unassigned).toEqual([]);
    const b = result.stops.find((stop) => stop.visit.id === "b");
    expect(b?.outsideTimeWindow).toBe(true);
    expect(b?.outsideWorkingHours).toBe(false);
    expect(b?.overtimeMinutes).toBe(0);
  });

  it("er deterministisk ved lik reisetid", () => {
    const visits = [
      visit("b", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
      visit("a", "2026-11-02T10:00:00.000Z", "2026-11-02T12:00:00.000Z", 62),
    ];
    const input = {
      visits,
      matrix: matrix([
        [0, 10, 10],
        [10, 0, 10],
        [10, 10, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    };
    expect(optimiseRoute(input)).toEqual(optimiseRoute(input));
  });

  it("returnerer stopp med ankomst, ventetid og kjøretid", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
    ];
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 10],
        [10, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    });

    expect(result.totalWaitingMinutes).toBe(50);
    expect(result.stops).toEqual([
      expect.objectContaining({
        arrivalAt: new Date("2026-11-02T08:10:00.000Z"),
        startsAt: new Date("2026-11-02T09:00:00.000Z"),
        endsAt: new Date("2026-11-02T10:00:00.000Z"),
        waitMinutes: 50,
        travelMinutes: 10,
        distanceKm: 5,
      }),
    ]);
  });

  it("rapporterer visiter uten koordinater som hoppet over", () => {
    const result = optimiseRoute({
      visits: [
        {
          id: "uten",
          point: null,
          startsAt: new Date("2026-11-02T09:00:00.000Z"),
          endsAt: new Date("2026-11-02T10:00:00.000Z"),
        },
      ],
      matrix: matrix([[0]]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    });

    expect(result.stops).toEqual([]);
    expect(result.skipped).toEqual(["uten"]);
    expect(result.unassigned).toEqual([
      { id: "uten", reason: "missing_coordinates" },
    ]);
  });

  it("beregner spart kjøretid og avstand mot opprinnelig rekkefølge", () => {
    const visits = [
      visit("b", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 62),
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
    ];
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 5, 30],
        [5, 0, 5],
        [30, 5, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
      indexById: new Map([
        ["a", 1],
        ["b", 2],
      ]),
    });

    expect(result.order.map((row) => row.id)).toEqual(["a", "b"]);
    expect(result.baseline.order).toEqual(["b", "a"]);
    expect(result.baselineTravelMinutes).toBe(35);
    expect(result.totalTravelMinutes).toBe(10);
    expect(result.savedTravelMinutes).toBe(25);
    expect(result.savedDistanceKm).toBeGreaterThan(0);
    expect(result.changed).toBe(true);
  });

  it("rapporterer en allerede ordnet dag uten endring", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
      visit("b", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 62),
    ];
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 5, 30],
        [5, 0, 5],
        [30, 5, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    });

    expect(result.order.map((row) => row.id)).toEqual(["a", "b"]);
    expect(result.changed).toBe(false);
    expect(result.savedTravelMinutes).toBe(0);
    expect(result.savedDistanceKm).toBe(0);
  });

  it("filtrerer visiter som mangler kompetanse", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
      {
        ...visit("b", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 62),
        requiredSkillIds: ["el-kontroll"],
      },
    ];
    const input = {
      visits,
      matrix: matrix([
        [0, 10, 10],
        [10, 0, 5],
        [10, 5, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    };

    const without = optimiseRoute({ ...input, technicianSkillIds: [] });
    expect(without.order.map((row) => row.id)).toEqual(["a"]);
    expect(without.unassigned).toEqual([
      { id: "b", reason: "missing_skills" },
    ]);

    const withSkill = optimiseRoute({
      ...input,
      technicianSkillIds: ["el-kontroll"],
    });
    expect(withSkill.order.map((row) => row.id)).toEqual(["a", "b"]);
    expect(withSkill.unassigned).toEqual([]);
  });

  it("planlegger en visitt etter arbeidstid med overtid", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T10:00:00.000Z", 61),
      visit("b", "2026-11-02T15:30:00.000Z", "2026-11-02T17:00:00.000Z", 62),
    ];
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 10, 10],
        [10, 0, 5],
        [10, 5, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
      workingHours: {
        start: new Date("2026-11-02T08:00:00.000Z"),
        end: new Date("2026-11-02T16:00:00.000Z"),
      },
    });

    expect(result.order.map((row) => row.id)).toEqual(["a", "b"]);
    expect(result.unassigned).toEqual([]);
    const b = result.stops.find((stop) => stop.visit.id === "b");
    expect(b?.outsideWorkingHours).toBe(true);
    expect(b?.outsideTimeWindow).toBe(false);
    expect(b?.overtimeMinutes).toBe(30);
    expect(result.totalOvertimeMinutes).toBe(30);
  });

  it("rapporterer overtime_limit når en hard overtidsgrense overskrides", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T10:00:00.000Z", 61),
      visit("b", "2026-11-02T15:30:00.000Z", "2026-11-02T17:00:00.000Z", 62),
    ];
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 10, 10],
        [10, 0, 5],
        [10, 5, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
      workingHours: {
        start: new Date("2026-11-02T08:00:00.000Z"),
        end: new Date("2026-11-02T16:00:00.000Z"),
      },
      maxOvertimeMinutes: 15,
    });

    expect(result.order.map((row) => row.id)).toEqual(["a"]);
    expect(result.skipped).toEqual(["b"]);
    expect(result.unassigned).toEqual([
      { id: "b", reason: "overtime_limit" },
    ]);
    expect(result.totalOvertimeMinutes).toBe(0);
  });

  it("kan slå av overtid helt med allowOvertime=false", () => {
    const result = optimiseRoute({
      visits: [
        visit("b", "2026-11-02T15:30:00.000Z", "2026-11-02T17:00:00.000Z", 62),
      ],
      matrix: matrix([
        [0, 10],
        [10, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
      workingHours: {
        start: new Date("2026-11-02T08:00:00.000Z"),
        end: new Date("2026-11-02T16:00:00.000Z"),
      },
      allowOvertime: false,
    });

    expect(result.stops).toEqual([]);
    expect(result.unassigned).toEqual([
      { id: "b", reason: "overtime_limit" },
    ]);
  });

  it("bruker prioritet som deterministisk tie-break", () => {
    const visits = [
      visit("a", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 61),
      {
        ...visit("b", "2026-11-02T09:00:00.000Z", "2026-11-02T12:00:00.000Z", 62),
        priority: 3,
      },
    ];
    const result = optimiseRoute({
      visits,
      matrix: matrix([
        [0, 10, 10],
        [10, 0, 5],
        [10, 5, 0],
      ]),
      start,
      startAt: new Date("2026-11-02T08:00:00.000Z"),
      startIndex: 0,
    });

    expect(result.order.map((row) => row.id)).toEqual(["b", "a"]);
  });
});
