/**
 * Rene hjelpere for kontordashbordet. De holder sortering og tavlefordeling
 * utenfor selve siden, slik at reglene kan testes uten database eller React.
 */

export type DashboardView = "liste" | "tavle";

export function resolveDashboardView(
  value: string | string[] | null | undefined,
): DashboardView {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "tavle" ? "tavle" : "liste";
}

export const QUEUE_SORT_KEYS = ["dato", "kunde", "status", "tittel"] as const;
export type QueueSort = (typeof QUEUE_SORT_KEYS)[number];

export function resolveQueueSort(
  value: string | string[] | null | undefined,
): QueueSort {
  const raw = Array.isArray(value) ? value[0] : value;
  return QUEUE_SORT_KEYS.includes(raw as QueueSort)
    ? (raw as QueueSort)
    : "dato";
}

export type QueueKey = "overdue" | "today" | "unassigned";

export type DashboardOrder = {
  id: string;
  title: string;
  status: string;
  scheduledFor: Date | string | null;
  scheduledTo?: Date | string | null;
  customer?: { name?: string | null } | null;
  technicians: Array<{ id?: string; name?: string | null }>;
};

export type SortableOrder = {
  id: string;
  title: string;
  status: string;
  scheduledFor: Date | string | null;
  customer?: { name?: string | null } | null;
};

export type QueueRow<T extends SortableOrder> = {
  order: T;
  queueKey: QueueKey;
};

function scheduledTime(value: Date | string | null): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function compareText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "", "nb", {
    sensitivity: "base",
  });
}

function compareByDate<T extends SortableOrder>(a: T, b: T): number {
  const left = scheduledTime(a.scheduledFor);
  const right = scheduledTime(b.scheduledFor);
  if (left === null && right === null) return compareText(a.title, b.title);
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right || compareText(a.title, b.title);
}

/**
 * Sorterer de synlige køradene. Standard er «eldste først»; udaterte oppdrag
 * havner alltid til slutt, uansett sortering.
 */
export function sortQueueRows<T extends SortableOrder>(
  rows: Array<QueueRow<T>>,
  sort: QueueSort,
): Array<QueueRow<T>> {
  return [...rows].sort((a, b) => {
    switch (sort) {
      case "kunde":
        return (
          compareText(a.order.customer?.name, b.order.customer?.name) ||
          compareByDate(a.order, b.order)
        );
      case "status":
        return (
          compareText(a.order.status, b.order.status) ||
          compareByDate(a.order, b.order)
        );
      case "tittel":
        return (
          compareText(a.order.title, b.order.title) ||
          compareByDate(a.order, b.order)
        );
      case "dato":
      default:
        return compareByDate(a.order, b.order);
    }
  });
}

export type BoardColumnKey =
  | "overdue"
  | "today"
  | "inProgress"
  | "unassigned";

/** Rekkefølgen kolonnene vises i, fra venstre mot høyre. */
export const BOARD_COLUMN_ORDER: BoardColumnKey[] = [
  "overdue",
  "today",
  "inProgress",
  "unassigned",
];

/**
 * Prioriteringen når et oppdrag kvalifiserer for flere kolonner. Forfalt går
 * foran pågående, som går foran dagens og til slutt ikke-tildelte. Dermed
 * vises aldri samme oppdrag i to kolonner.
 */
export const BOARD_PRIORITY: BoardColumnKey[] = [
  "overdue",
  "inProgress",
  "today",
  "unassigned",
];

export const BOARD_COLUMN_LIMIT = 12;

export type BoardColumn<T extends { id: string }> = {
  key: BoardColumnKey;
  orders: T[];
  total: number;
  hasMore: boolean;
};

export function buildBoardColumns<T extends { id: string }>(
  sources: Record<BoardColumnKey, T[]>,
  totals: Record<BoardColumnKey, number>,
  limit = BOARD_COLUMN_LIMIT,
): Array<BoardColumn<T>> {
  const seen = new Set<string>();
  const buckets: Record<BoardColumnKey, T[]> = {
    overdue: [],
    today: [],
    inProgress: [],
    unassigned: [],
  };

  for (const key of BOARD_PRIORITY) {
    const remaining = Math.max(0, limit - buckets[key].length);
    const unique = sources[key].filter((order) => !seen.has(order.id));
    const orders = unique.slice(0, remaining);
    orders.forEach((order) => seen.add(order.id));
    buckets[key] = orders;
  }

  return BOARD_COLUMN_ORDER.map((key) => ({
    key,
    orders: buckets[key],
    total: totals[key],
    hasMore: totals[key] > buckets[key].length,
  }));
}
