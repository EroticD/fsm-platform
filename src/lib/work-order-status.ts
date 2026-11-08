import { WorkStatus } from "@prisma/client";

/**
 * Én kilde til sannhet for lovlige statusoverganger på oppdrag.
 *
 * Hvilke statuser som er lukkede, planlagte eller åpne kan konfigureres av
 * administrator. Standardoppsettet bevarer den opprinnelige oppførselen:
 * COMPLETED og CANCELLED er lukket, PLANNED/WAITING/IN_PROGRESS er planlagt,
 * og OPEN/PENDING er åpne. PENDING er standard for nye oppdrag og betyr
 * «åpen, venter på planlegging».
 *
 * Rekkefølgen mellom åpne statuser er en arbeidsflyt, ikke en tvungen
 * tilstandsmaskin: kontoret og montørene må kunne rette opp statusen uansett
 * hvor i flyten oppdraget står. En lukket tilstand kan bare gjenåpnes av
 * administrator, og det gjøres eksplisitt i `canTransition`.
 */

export type WorkOrderStatusCategory = "OPEN" | "PLANNED" | "CLOSED";

export type WorkOrderStatusConfigEntry = {
  category: WorkOrderStatusCategory;
  sortOrder: number;
  isActive: boolean;
};

export type WorkOrderStatusConfig = Record<
  WorkStatus,
  WorkOrderStatusConfigEntry
>;

/** Standard listene, bevart for bakoverkompatibilitet og tester. */
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

export const DEFAULT_WORK_ORDER_STATUS_CONFIG: WorkOrderStatusConfig = {
  OPEN: { category: "OPEN", sortOrder: 10, isActive: true },
  PENDING: { category: "OPEN", sortOrder: 20, isActive: true },
  PLANNED: { category: "PLANNED", sortOrder: 30, isActive: true },
  WAITING: { category: "PLANNED", sortOrder: 40, isActive: true },
  IN_PROGRESS: { category: "PLANNED", sortOrder: 50, isActive: true },
  COMPLETED: { category: "CLOSED", sortOrder: 60, isActive: true },
  CANCELLED: { category: "CLOSED", sortOrder: 70, isActive: true },
};

let currentConfig: WorkOrderStatusConfig = DEFAULT_WORK_ORDER_STATUS_CONFIG;

/** Oppdaterer den prosesslokale konfigurasjonen. Kalles av serverlaget. */
export function setWorkOrderStatusConfig(
  config: Partial<WorkOrderStatusConfig> | null | undefined,
): void {
  currentConfig = { ...DEFAULT_WORK_ORDER_STATUS_CONFIG, ...(config ?? {}) };
}

export function getWorkOrderStatusConfig(): WorkOrderStatusConfig {
  return currentConfig;
}

export function statusCategory(status: WorkStatus): WorkOrderStatusCategory {
  return currentConfig[status]?.category ?? "OPEN";
}

export function isStatusActive(status: WorkStatus): boolean {
  return currentConfig[status]?.isActive ?? true;
}

export function statusKeysByCategory(
  category: WorkOrderStatusCategory,
): WorkStatus[] {
  return (Object.values(WorkStatus) as WorkStatus[])
    .filter(
      (status) =>
        currentConfig[status]?.category === category &&
        (currentConfig[status]?.isActive ?? true),
    )
    .sort(
      (a, b) =>
        (currentConfig[a]?.sortOrder ?? 0) -
          (currentConfig[b]?.sortOrder ?? 0) || a.localeCompare(b),
    );
}

/** Er oppdraget avsluttet (konfigurert som lukket)? */
export function isClosedStatus(status: WorkStatus): boolean {
  return statusCategory(status) === "CLOSED";
}

/** Er oppdraget fortsatt under arbeid (åpen eller planlagt)? */
export function isOpenStatus(status: WorkStatus): boolean {
  return !isClosedStatus(status);
}

export function canTransition(
  from: WorkStatus,
  to: WorkStatus,
  isAdmin: boolean,
): boolean {
  if (from === to) return false;
  // Alle åpne statuser kan byttes fritt, også til en lukket status.
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
  return (Object.values(WorkStatus) as WorkStatus[]).filter(
    (status) => status !== from,
  );
}

/** Rekkefølgen statusene vises i på oppdragsdetaljene. */
export const STATUS_OPTION_ORDER: readonly WorkStatus[] = [
  "OPEN",
  "PLANNED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

/**
 * Valgbare statuser i UI-et, bygget på `allowedTransitions` og den
 * konfigurerte rekkefølgen/aktiveringen. PENDING er systemets startstatus og
 * skal ikke settes manuelt; den vises bare når den allerede er gjeldende.
 */
export function statusSelectOptions(
  from: WorkStatus,
  isAdmin: boolean,
): WorkStatus[] {
  const allowed = new Set(allowedTransitions(from, isAdmin));
  return (Object.values(WorkStatus) as WorkStatus[])
    .filter(
      (status) =>
        status !== "PENDING" &&
        isStatusActive(status) &&
        allowed.has(status),
    )
    .sort(
      (a, b) =>
        (currentConfig[a]?.sortOrder ?? 0) -
          (currentConfig[b]?.sortOrder ?? 0) || a.localeCompare(b),
    );
}
