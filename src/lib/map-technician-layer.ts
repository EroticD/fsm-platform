import type { Coordinates } from "@/lib/geo";

/**
 * Integrasjonspunkt for teknikerlaget på kartet.
 *
 * Phase 5C legger til `VisitLocationPing` og fyller denne funksjonen med de
 * aktive posisjonene (bare EN_ROUTE/ON_SITE, ingen historikk). Phase 6 skal
 * ikke legge til modellen eller skrive posisjoner. Kartet kaller derfor denne
 * funksjonen allerede nå, men får en tom liste inntil 5C kobler på kilden.
 */
export type TechnicianMapMarker = {
  visitId: string;
  userId: string;
  name: string;
  status: string;
  updatedAt: Date;
  point: Coordinates;
};

export type TechnicianMapLayer = {
  /** False inntil 5C har koblet på posisjonskilden. */
  enabled: boolean;
  markers: TechnicianMapMarker[];
};

export async function loadTechnicianMapLayer(): Promise<TechnicianMapLayer> {
  return { enabled: false, markers: [] };
}
