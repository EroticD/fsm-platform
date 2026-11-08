import type { Coordinates } from "@/lib/geo";

/**
 * Leverandørene rutinglaget kan svare med.
 *
 * `osrm` er en vanlig ruteserver basert på OpenStreetMap uten sanntidstrafikk.
 * `google` er Google Routes API (Google Maps Platform), som kan svare med
 * trafikkbevisst varighet når `GOOGLE_ROUTES_API_KEY` er satt. `haversine` er
 * den lokale reserveberegningen (luftlinje × veifaktor).
 */
export type RoutingProviderName = "osrm" | "haversine" | "google";

/** Reisetid og avstand mellom to punkter. */
export type TravelEstimate = {
  distanceKm: number;
  durationMinutes: number;
  /** Leverandøren som faktisk svarte. */
  provider: RoutingProviderName;
  /**
   * True når varigheten er beregnet med trafikk. En trafikkleverandør som
   * faller tilbake til OSRM eller haversine setter dette til false.
   */
  traffic?: boolean;
};

/**
 * Grensesnittet dispatch og kart bruker. Leverandøren skal aldri kalles fra
 * klienten: miljøvariabler og eventuelle nøkler blir liggende på serveren.
 */
export type RoutingProvider = {
  name: RoutingProviderName;
  route(from: Coordinates, to: Coordinates): Promise<TravelEstimate>;
  matrix(
    origins: Coordinates[],
    destinations: Coordinates[],
  ): Promise<TravelEstimate[][]>;
};

export class RoutingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Routing request exceeded ${timeoutMs} ms`);
    this.name = "RoutingTimeoutError";
  }
}
