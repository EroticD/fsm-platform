import {
  DEFAULT_AVERAGE_SPEED_KMH,
  ROAD_FACTOR,
  haversineKm,
} from "@/lib/geo";
import type { RoutingProvider, TravelEstimate } from "./types";

/**
 * Standardveifaktor når vi ikke har en ekstern ruteleverandør. Den deles med
 * ETA-beregningen i `src/lib/geo.ts`, slik at sporing og dispatch aldri kan
 * love ulik reisetid for samme strekning.
 */
export const HAVERSINE_ROAD_FACTOR = ROAD_FACTOR;

/** Gjennomsnittsfart for blandet by/landevei. */
export const HAVERSINE_AVG_SPEED_KMH = DEFAULT_AVERAGE_SPEED_KMH;

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
