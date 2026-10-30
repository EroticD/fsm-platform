import type { Coordinates } from "@/lib/geo";

/** Reisetid og avstand mellom to punkter. */
export type TravelEstimate = {
  distanceKm: number;
  durationMinutes: number;
  /** `osrm` når en ekstern ruteleverandør svarte, ellers `haversine`. */
  provider: "osrm" | "haversine";
};

/**
 * Grensesnittet dispatch og kart bruker. Leverandøren skal aldri kalles fra
 * klienten: miljøvariabler og eventuelle nøkler blir liggende på serveren.
 */
export type RoutingProvider = {
  name: "osrm" | "haversine";
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
