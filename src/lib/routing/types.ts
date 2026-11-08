import type { Coordinates } from "@/lib/geo";

/**
 * Leverandørene rutinglaget kan svare med.
 *
 * `tomtom` og `here` er trafikkbevisste: reisetiden er hentet med
 * sanntidstrafikk. `osrm` er en vanlig ruteserver uten trafikk, og
 * `haversine` er den lokale reserveberegningen (luftlinje × veifaktor).
 */
export type RoutingProviderName =
  | "osrm"
  | "haversine"
  | "tomtom"
  | "here";

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
