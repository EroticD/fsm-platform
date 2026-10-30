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

  it("bryter aldri et tidsvindu", () => {
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

    expect(result.order.map((row) => row.id)).toEqual(["a"]);
    expect(result.skipped).toEqual(["b"]);
    for (const row of result.order) {
      expect(row.startsAt.getTime()).toBeLessThan(row.endsAt.getTime());
    }
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
});
