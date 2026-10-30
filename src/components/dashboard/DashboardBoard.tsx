import Link from "next/link";
import Icon from "@/components/icons";
import { formatDateRangeLocalized } from "@/lib/dates";
import type {
  BoardColumn,
  BoardColumnKey,
  DashboardOrder,
} from "./helpers";
import StatusPill, { statusLabel } from "./StatusPill";

const COLUMN_META: Record<
  BoardColumnKey,
  { labelKey: string; dotClass: string; cardClass: string }
> = {
  overdue: {
    labelKey: "dashboard.kpi.overdue",
    dotClass: "bg-[var(--risk,#f04427)]",
    cardClass:
      "border-l-4 border-l-[var(--risk,#f04427)] bg-[#fdf1ef] hover:bg-[#fbe7e3]",
  },
  today: {
    labelKey: "dashboard.kpi.today",
    dotClass: "bg-[var(--ink,#101310)]",
    cardClass: "bg-[var(--surface,#fffdf8)] hover:bg-[#f4f7e8]",
  },
  inProgress: {
    labelKey: "dashboard.kpi.inProgress",
    dotClass: "bg-[var(--signal,#d8ff3e)] ring-1 ring-[var(--ink,#101310)]",
    cardClass: "bg-[var(--surface,#fffdf8)] hover:bg-[#f4f7e8]",
  },
  unassigned: {
    labelKey: "dashboard.kpi.unassigned",
    dotClass: "bg-[#c78b16]",
    cardClass: "bg-[var(--surface,#fffdf8)] hover:bg-[#fdf5e4]",
  },
};

export default function DashboardBoard({
  columns,
  hrefs,
  locale,
  title,
  t,
}: {
  columns: Array<BoardColumn<DashboardOrder>>;
  hrefs: Record<BoardColumnKey, string>;
  locale: string;
  title: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <section aria-labelledby="dashboard-board-title">
      <h2 id="dashboard-board-title" className="sr-only">
        {title}
      </h2>
      <div className="-mx-1 flex max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0 lg:pb-0">
        {columns.map((column) => {
          const meta = COLUMN_META[column.key];
          return (
            <section
              key={column.key}
              aria-labelledby={`board-column-${column.key}`}
              className="office-card flex min-w-[17rem] max-w-[85vw] snap-start flex-col overflow-hidden lg:min-w-0 lg:max-w-none"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] px-3 py-2.5">
                <h3
                  id={`board-column-${column.key}`}
                  className="flex min-w-0 items-center gap-2 text-sm font-black tracking-tight text-[var(--ink,#101310)]"
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotClass}`}
                  />
                  <Link
                    href={hrefs[column.key]}
                    prefetch={false}
                    className="truncate underline decoration-transparent decoration-2 underline-offset-4 transition hover:decoration-[var(--signal,#d8ff3e)]"
                  >
                    {t(meta.labelKey)}
                  </Link>
                </h3>
                <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1.5 py-0.5 text-xs font-black tabular-nums text-[var(--ink,#101310)]">
                  {column.total}
                </span>
              </div>

              <div className="flex-1 space-y-2 p-2.5">
                {column.orders.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--line,#dedcd1)] px-3 py-5 text-xs font-bold text-[var(--muted,#62685f)]">
                    <Icon name="check" className="h-4 w-4 shrink-0" />
                    {t("dashboard.board.empty")}
                  </p>
                ) : (
                  column.orders.map((order) => {
                    const technicianNames = order.technicians
                      .map((technician) => technician.name)
                      .filter(Boolean)
                      .join(", ");

                    return (
                      <Link
                        key={order.id}
                        href={`/oppdrag/${order.id}`}
                        className={`group block rounded-xl border border-[var(--line,#dedcd1)] p-3 transition ${meta.cardClass}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`text-[11px] font-black tabular-nums ${
                              column.key === "overdue"
                                ? "text-[var(--risk-text,#b42318)]"
                                : "text-[var(--muted,#62685f)]"
                            }`}
                          >
                            {formatDateRangeLocalized(
                              order.scheduledFor,
                              order.scheduledTo,
                              locale,
                            ) || t("dashboard.orderList.noDate")}
                          </span>
                          <StatusPill
                            status={order.status}
                            label={statusLabel(t, order.status)}
                          />
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm font-black leading-5 text-[var(--ink,#101310)]">
                          {order.title}
                        </p>
                        <p className="mt-1 truncate text-xs font-medium text-[var(--muted,#62685f)]">
                          {order.customer?.name ||
                            t("dashboard.orderList.noCustomer")}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                          <span
                            className={`truncate font-bold ${
                              technicianNames
                                ? "text-[var(--ink,#101310)]"
                                : "text-[var(--risk-text,#b42318)]"
                            }`}
                          >
                            {technicianNames ||
                              t("dashboard.orderList.unassigned")}
                          </span>
                          <Icon
                            name="chevronRight"
                            className="h-4 w-4 shrink-0 text-[var(--muted,#62685f)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink,#101310)]"
                          />
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>

              {column.total > 0 ? (
                <div className="border-t border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2">
                  <Link
                    href={hrefs[column.key]}
                    prefetch={false}
                    className="flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--ink,#101310)] hover:underline"
                  >
                    <span>
                      {t("dashboard.board.viewAll", { count: column.total })}
                    </span>
                    <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}
