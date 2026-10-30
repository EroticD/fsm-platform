import { describe, expect, it } from "vitest";
import {
  DEFAULT_AVERAGE_SPEED_KMH,
  ROAD_FACTOR,
  averageSpeedKmh,
  estimateEta,
  estimateTravelMinutes,
  haversineKm,
  isValidCoordinates,
} from "./geo";

const OSLO = { lat: 59.9139, lng: 10.7522 };
const BERGEN = { lat: 60.3913, lng: 5.3221 };

describe("haversine", () => {
  it("beregner kjent luftlinje mellom Oslo og Bergen", () => {
    const distance = haversineKm(OSLO, BERGEN);
    expect(distance).toBeGreaterThan(300);
    expect(distance).toBeLessThan(315);
  });

  it("gir null for samme punkt og avviser ugyldige koordinater", () => {
    expect(haversineKm(OSLO, OSLO)).toBeCloseTo(0, 6);
    expect(Number.isNaN(haversineKm(OSLO, { lat: 95, lng: 10 }))).toBe(true);
  });

  it("validerer bredde- og lengdegrader", () => {
    expect(isValidCoordinates(60, 5)).toBe(true);
    expect(isValidCoordinates(-90, -180)).toBe(true);
    expect(isValidCoordinates(90.1, 0)).toBe(false);
    expect(isValidCoordinates(0, Number.NaN)).toBe(false);
    expect(isValidCoordinates("60", 5)).toBe(false);
  });
});

describe("ETA-fallback", () => {
  it("bruker veifaktor og konfigurert gjennomsnittsfart", () => {
    const minutes = estimateTravelMinutes(100 * ROAD_FACTOR, 50);
    expect(minutes).toBe(162);
  });

  it("runder opp og gir minst ett minutt for korte reiser", () => {
    expect(estimateTravelMinutes(0)).toBe(0);
    expect(estimateTravelMinutes(0.01, 50)).toBe(1);
  });

  it("leser fart fra miljøet og avgrenser urimelige verdier", () => {
    expect(averageSpeedKmh({ TRACKING_AVERAGE_SPEED_KMH: "70" })).toBe(70);
    expect(averageSpeedKmh({ TRACKING_AVERAGE_SPEED_KMH: "1" })).toBe(5);
    expect(averageSpeedKmh({ TRACKING_AVERAGE_SPEED_KMH: "500" })).toBe(120);
    expect(averageSpeedKmh({})).toBe(DEFAULT_AVERAGE_SPEED_KMH);
  });

  it("estimerer ankomst fra et faktisk punkt", () => {
    const now = new Date("2026-10-30T10:00:00.000Z");
    const eta = estimateEta({
      from: OSLO,
      to: BERGEN,
      now,
      speedKmh: 80,
    });

    expect(eta).not.toBeNull();
    expect(eta!.roadKm).toBeCloseTo(eta!.straightLineKm * ROAD_FACTOR, 6);
    expect(eta!.minutes).toBeGreaterThan(200);
    expect(eta!.estimatedArrivalAt.getTime()).toBe(
      now.getTime() + eta!.minutes * 60_000,
    );
  });

  it("gir ingen ETA uten posisjon eller destinasjon", () => {
    expect(estimateEta({ from: null, to: BERGEN })).toBeNull();
    expect(estimateEta({ from: OSLO, to: null })).toBeNull();
    expect(
      estimateEta({ from: { lat: 100, lng: 10 }, to: BERGEN }),
    ).toBeNull();
  });
});
