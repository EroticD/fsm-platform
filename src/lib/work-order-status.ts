import { WorkStatus } from "@prisma/client";

/**
 * Én kilde til sannhet for lovlige statusoverganger på oppdrag.
 *
 * Bare COMPLETED og CANCELLED er lukkede tilstander. Et åpent oppdrag kan
 * fritt byttes til en annen åpen status, eller lukkes. Rekkefølgen mellom
 * åpne statuser er en arbeidsflyt, ikke en tvungen tilstandsmaskin: kontoret
 * og montørene må kunne rette opp statusen uansett hvor i flyten oppdraget
 * står. En lukket tilstand kan bare gjenåpnes av administrator, og det gjøres
 * eksplisitt i `canTransition` (tjenesten krever i tillegg en grunn).
 *
 * Rapportens lås (`Report.isLocked`) er uavhengig av dette. Den hindrer
 * redigering av rapporten, ikke statusendring på oppdraget.
 */
export const OPEN_STATUSES: readonly WorkStatus[] = [
  "OPEN",
  "PENDING",
  "PLANNED",
  "WAITING",
  "IN_PROGRESS",
];

export const CLOSED_STATUSES: readonly WorkStatus[] = [
  "COMPLETED",
  "CANCELLED",
];

/** Er oppdraget avsluttet (fullført eller kansellert)? */
export function isClosedStatus(status: WorkStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/** Er oppdraget fortsatt under arbeid? */
export function isOpenStatus(status: WorkStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function canTransition(
  from: WorkStatus,
  to: WorkStatus,
  isAdmin: boolean,
): boolean {
  if (from === to) return false;
  // Alle åpne statuser kan byttes fritt, også til COMPLETED eller CANCELLED.
  if (isOpenStatus(from)) return true;
  // Et lukket oppdrag er avsluttet historikk. Bare administrator kan gjenåpne
  // det, og da til hvilken som helst annen status.
  return isAdmin;
}

/** Statusene brukeren kan velge fra en gitt tilstand (til UI-et). */
export function allowedTransitions(
  from: WorkStatus,
  isAdmin: boolean,
): WorkStatus[] {
  if (!isOpenStatus(from) && !isAdmin) return [];
  return Object.values(WorkStatus).filter((status) => status !== from);
}
