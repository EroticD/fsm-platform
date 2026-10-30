import { describe, expect, it, vi } from "vitest";
import { createHaversineProvider } from "./haversine";
import { createOsrmProvider, resolveRoutingProvider } from "./osrm";
import { estimateFromHaversine, HAVERSINE_ROAD_FACTOR } from "./haversine";

const a = { latitude: 59.91, longitude: 10.75 };
const b = { latitude: 60.39, longitude: 5.32 };

describe("ruting", () => {
  it("bruker haversine × veifaktor uten ekstern leverandør", async () => {
    const provider = createHaversineProvider();
    const estimate = await provider.route(a, b);
    const straight = estimate.distanceKm / HAVERSINE_ROAD_FACTOR;
    expect(estimate.provider).toBe("haversine");
    expect(estimate.distanceKm).toBeCloseTo(straight * HAVERSINE_ROAD_FACTOR, 3);
    expect(estimate.durationMinutes).toBeGreaterThan(0);
  });

  it("faller tilbake til haversine når OSRM feiler", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("nede");
    });
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const estimate = await provider.route(a, b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(estimate.provider).toBe("haversine");
  });

  it("cacher ruter per koordinatnøkkel", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{ distance: 5000, duration: 600 }],
      }),
    }));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const first = await provider.route(a, b);
    const second = await provider.route(a, b);
    expect(first).toEqual(second);
    expect(first.provider).toBe("osrm");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gjør ingen nettverkskall når OSRM ikke er konfigurert", async () => {
    const fetchImpl = vi.fn();
    const provider = resolveRoutingProvider({}, fetchImpl as unknown as typeof fetch);
    expect(provider.name).toBe("haversine");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("estimerer veifaktor og minutter", () => {
    expect(estimateFromHaversine(100).distanceKm).toBe(135);
    expect(estimateFromHaversine(100).durationMinutes).toBe(162);
  });
});
