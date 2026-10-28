/**
 * Hendelsen som ledighetkortene sender når kunden velger en ledig dag.
 * Skjemaet lenger opp på siden lytter etter den og fyller inn dato/tekniker.
 */
export const PORTAL_SLOT_EVENT = "portal:slot-selected";

export type PortalSlotDetail = {
  date: string;
  technicianId: string;
  technicianName: string;
};
