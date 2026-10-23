import { WorkStatus } from "@prisma/client";

/**
 * Én kilde til sannhet for lovlige statusoverganger på oppdrag.
 *
 * COMPLETED og CANCELLED er lukkede tilstander. Bare administrator kan gjenåpne
 * dem, og det gjøres eksplisitt i `canTransition`.
 */
export const TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  OPEN: ["PLANNED", "CANCELLED"],
  PLANNED: ["IN_PROGRESS", "WAITING", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "PLANNED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "WAITING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  PENDING: ["PLANNED", "CANCELLED"],
};

export function canTransition(
  from: WorkStatus,
  to: WorkStatus,
  isAdmin: boolean,
): boolean {
  if (from === to) return false;
  if (isAdmin && (from === "COMPLETED" || from === "CANCELLED")) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statusene brukeren kan velge fra en gitt tilstand (til UI-et). */
export function allowedTransitions(
  from: WorkStatus,
  isAdmin: boolean,
): WorkStatus[] {
  if (isAdmin && (from === "COMPLETED" || from === "CANCELLED")) {
    return Object.values(WorkStatus).filter((status) => status !== from);
  }
  return TRANSITIONS[from] ?? [];
}
