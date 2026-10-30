import { haversineKm } from "@/lib/geo";
import type { RoutingProvider, TravelEstimate } from "./types";

/**
 * Standardveifaktor når vi ikke har en ekstern ruteleverandør. 1,35 er et
 * konservativt gjennomsnitt for norske veier og gjør at planleggingen ikke
 * lover kortere reiser enn den faktisk kan levere.
 */
export const HAVERSINE_ROAD_FACTOR = 1.35;

/** Gjennomsnittsfart for blandet by/landevei. */
export const HAVERSINE_AVG_SPEED_KMH = 50;

export function estimateFromHaversine(
  distanceKm: number,
  provider: TravelEstimate["provider"] = "haversine",
): TravelEstimate {
  const roadKm = distanceKm * HAVERSINE_ROAD_FACTOR;
  return {
    distanceKm: Math.round(roadKm * 1000) / 1000,
    durationMinutes:
      roadKm <= 0
        ? 0
        : Math.max(1, Math.round((roadKm / HAVERSINE_AVG_SPEED_KMH) * 60)),
    provider,
  };
}

/**
 * Luftlinje × veifaktor. Brukes både som selvstendig leverandør og som
 * reserve når OSRM er nede, svarer feil eller bruker for lang tid.
 */
export function createHaversineProvider(): RoutingProvider {
  return {
    name: "haversine",
    async route(from, to) {
      return estimateFromHaversine(haversineKm(from, to));
    },
    async matrix(origins, destinations) {
      return origins.map((origin) =>
        destinations.map((destination) =>
          estimateFromHaversine(haversineKm(origin, destination)),
        ),
      );
    },
  };
}
