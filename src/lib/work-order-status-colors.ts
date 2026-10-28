import type { WorkStatus } from "@prisma/client";

/**
 * Felles fargepalett for oppdragsstatus. Brukes av kalenderen, kartet og
 * statusforklaringene, slik at samme status alltid har samme farge.
 */
export const WORK_ORDER_STATUS_COLORS: Record<WorkStatus, string> = {
  OPEN: "#9333ea",
  PENDING: "#d97706",
  PLANNED: "#ca8a04",
  WAITING: "#ea580c",
  IN_PROGRESS: "#2563eb",
  COMPLETED: "#16a34a",
  CANCELLED: "#dc2626",
};

/** Rekkefølgen statusene vises i lister og forklaringer. */
export const WORK_ORDER_STATUS_ORDER: readonly WorkStatus[] = [
  "OPEN",
  "PENDING",
  "PLANNED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

/** Oversettelsesnøkkel for statusnavnet som vises i forklaringer. */
export const WORK_ORDER_STATUS_LABEL_KEYS: Record<WorkStatus, string> = {
  OPEN: "orders.detail.statusOpen",
  PENDING: "orders.detail.statusPending",
  PLANNED: "orders.detail.statusPlanned",
  WAITING: "orders.detail.statusWaiting",
  IN_PROGRESS: "orders.detail.statusInProgress",
  COMPLETED: "orders.detail.statusCompleted",
  CANCELLED: "orders.detail.statusCancelled",
};

/** Statusfarge med en trygg fallback for ukjente verdier. */
export function workOrderStatusColor(status: string | null | undefined): string {
  return WORK_ORDER_STATUS_COLORS[status as WorkStatus] ?? "#2563eb";
}
