import Link from "next/link";
import Icon from "@/components/icons";
import { formatDateRangeLocalized } from "@/lib/dates";
import type {
  DashboardOrder,
  QueueKey,
  QueueRow,
  QueueSort,
} from "./helpers";
import StatusPill, { statusLabel } from "./StatusPill";

const SORT_OPTIONS: Array<{
  key: QueueSort;
  labelKey: string;
  summaryKey: string;
}> = [
  {
    key: "dato",
    labelKey: "dashboard.queue.sortDate",
    summaryKey: "dashboard.queue.sortOldestFirst",
  },
  {
    key: "kunde",
    labelKey: "dashboard.queue.sortCustomer",
    summaryKey: "dashboard.queue.sortCustomerAsc",
  },
  {
    key: "status",
    labelKey: "dashboard.queue.sortStatus",
    summaryKey: "dashboard.queue.sortStatusAsc",
  },
  {
    key: "tittel",
    labelKey: "dashboard.queue.sortTitle",
    summaryKey: "dashboard.queue.sortTitleAsc",
  },
];

const QUEUE_LABEL_KEYS: Record<QueueKey, string> = {
  overdue: "dashboard.kpi.overdue",
  today: "dashboard.kpi.today",
  unassigned: "dashboard.kpi.unassigned",
};

const QUEUE_LABEL_TONE: Record<QueueKey, string> = {
  overdue: "text-[var(--risk-text,#b42318)]",
  today: "text-[#3f4a1a]",
  unassigned: "text-[#7a5a12]",
};

export default function PriorityQueue({
  rows,
  sort,
  sortLinks,
  filterHref,
  locale,
  t,
}: {
  rows: Array<QueueRow<DashboardOrder>>;
  sort: QueueSort;
  sortLinks: Record<QueueSort, string>;
  filterHref: string;
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const activeSort =
    SORT_OPTIONS.find((option) => option.key === sort) ?? SORT_OPTIONS[0];

  return (
    <section
      className="office-card overflow-visible"
      aria-labelledby="queue-title"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line,#dedcd1)] px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2
              id="queue-title"
              className="text-xl font-black tracking-tight text-[var(--ink,#101310)]"
            >
              {t("dashboard.queue.title")}
            </h2>
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--ink,#101310)] px-1.5 py-0.5 text-xs font-black tabular-nums text-[var(--paper,#f2efe6)]">
              {rows.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs font-bold text-[var(--muted,#62685f)]">
            {t(activeSort.summaryKey)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <details className="group relative">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] [&::-webkit-details-marker]:hidden">
              <span>
                {t("dashboard.queue.sortLabel")}: {t(activeSort.labelKey)}
              </span>
              <Icon
                name="chevronDown"
                className="h-3.5 w-3.5 transition group-open:rotate-180"
              />
            </summary>
            <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1 shadow-[0_16px_34px_-18px_rgba(16,19,16,0.4)]">
              {SORT_OPTIONS.map((option) => {
                const active = option.key === sort;
                return (
                  <Link
                    key={option.key}
                    href={sortLinks[option.key]}
                    prefetch={false}
                    aria-current={active ? "true" : undefined}
                    className={`flex min-h-9 items-center justify-between gap-3 rounded-lg px-2.5 text-xs font-bold transition ${
                      active
                        ? "bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                        : "text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
                    }`}
                  >
                    {t(option.labelKey)}
                    {active ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
                  </Link>
                );
              })}
            </div>
          </details>

          <Link
            href={filterHref}
            prefetch={false}
            aria-label={t("dashboard.queue.filter")}
            title={t("dashboard.queue.filter")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
          >
            <Icon name="filter" className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-7 text-sm">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--signal,#d8ff3e)] text-sm font-black text-[var(--ink,#101310)]"
            aria-hidden
          >
            <Icon name="check" className="h-4 w-4" />
          </span>
          <p className="font-bold text-[var(--ink,#101310)]">
            {t("dashboard.queue.empty")}
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-[var(--line,#dedcd1)]">
          {rows.map(({ order, queueKey }) => {
            const overdue = queueKey === "overdue";
            const technicianNames = order.technicians
              .map((technician) => technician.name)
              .filter(Boolean)
              .join(", ");

            return (
              <li key={order.id}>
                <Link
                  href={`/oppdrag/${order.id}`}
                  className={`group flex flex-col gap-2 border-l-4 px-3 py-3 transition sm:flex-row sm:items-center sm:gap-4 sm:px-4 ${
                    overdue
                      ? "border-l-[var(--risk,#f04427)] bg-[#fdf1ef] hover:bg-[#fbe7e3]"
                      : "border-l-transparent hover:bg-[#f4f7e8]"
                  }`}
                >
                  <div className="flex shrink-0 items-center gap-2 sm:w-28 sm:flex-col sm:items-start sm:gap-1">
                    <span
                      className={`text-xs font-black tabular-nums ${
                        overdue
                          ? "text-[var(--risk-text,#b42318)]"
                          : "text-[var(--ink,#101310)]"
                      }`}
                    >
                      {formatDateRangeLocalized(
                        order.scheduledFor,
                        order.scheduledTo,
                        locale,
                      ) || t("dashboard.orderList.noDate")}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-[0.08em] ${QUEUE_LABEL_TONE[queueKey]}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          overdue
                            ? "bg-[var(--risk,#f04427)]"
                            : queueKey === "today"
                              ? "bg-[var(--signal,#d8ff3e)] ring-1 ring-[var(--ink,#101310)]"
                              : "bg-[#c78b16]"
                        }`}
                        aria-hidden
                      />
                      {t(QUEUE_LABEL_KEYS[queueKey])}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-sm font-black leading-5 text-[var(--ink,#101310)] sm:text-base">
                        {order.title}
                      </p>
                      <Icon
                        name="chevronRight"
                        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted,#62685f)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink,#101310)] sm:hidden"
                      />
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-[var(--muted,#62685f)]">
                      {order.customer?.name ||
                        t("dashboard.orderList.noCustomer")}
                      <span aria-hidden> · </span>
                      {technicianNames || t("dashboard.orderList.unassigned")}
                    </p>
                    <div className="mt-1.5 sm:hidden">
                      <StatusPill
                        status={order.status}
                        label={statusLabel(t, order.status)}
                      />
                    </div>
                  </div>

                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    <StatusPill
                      status={order.status}
                      label={statusLabel(t, order.status)}
                    />
                    <Icon
                      name="chevronRight"
                      className="h-4 w-4 text-[var(--muted,#62685f)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink,#101310)]"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
