import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import type { getStatistics } from "@/server/settings";

type StatisticsData = Extract<
  Awaited<ReturnType<typeof getStatistics>>,
  { ok: true }
>["data"];

type StatisticsTabProps = {
  data: StatisticsData;
  dateFrom: string;
  dateTo: string;
  statusFilter: string;
  customerFilter: string;
  technicianFilter: string;
};

const STATUS_OPTIONS = [
  "",
  "PLANNED",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "CANCELLED",
  "OPEN",
  "PENDING",
] as const;

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button whitespace-nowrap text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

export default async function StatisticsTab({
  data,
  dateFrom,
  dateTo,
  statusFilter,
  customerFilter,
  technicianFilter,
}: StatisticsTabProps) {
  const t = await getTranslations("common");
  const {
    statsCustomers,
    statsTechnicians,
    totalWorkOrders,
    byStatus,
    byTechnician,
    byCustomer,
    monthlyTrend,
  } = data;

  const kpis = [
    { label: t("settings.statistics.total"), value: totalWorkOrders, accent: "bg-[var(--signal,#d8ff3e)]" },
    { label: t("settings.statistics.planned"), value: byStatus.PLANNED || 0, accent: "bg-[var(--ink,#101310)]" },
    { label: t("settings.statistics.inProgress"), value: byStatus.IN_PROGRESS || 0, accent: "bg-[var(--line,#dedcd1)]" },
    { label: t("settings.statistics.completed"), value: byStatus.COMPLETED || 0, accent: "bg-[var(--ink,#101310)]" },
  ];

  return (
    <section className="office-card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
        <Icon name="chart" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
        <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("settings.statistics.title")}
        </h2>
      </div>
      <p className="mb-5 text-sm text-[var(--muted,#62685f)]">
        {t("settings.statistics.desc")}
      </p>

      {/* FILTER */}
      <div className="mb-6 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4">
        <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input type="hidden" name="tab" value="statistikk" />
          <input
            type="date"
            name="dateFrom"
            aria-label={t("settings.statistics.fromDate")}
            placeholder={t("settings.statistics.fromDate")}
            defaultValue={dateFrom}
            className={FIELD}
          />
          <input
            type="date"
            name="dateTo"
            aria-label={t("settings.statistics.toDate")}
            placeholder={t("settings.statistics.toDate")}
            defaultValue={dateTo}
            className={FIELD}
          />
          <select
            name="status"
            aria-label={t("status")}
            defaultValue={statusFilter || ""}
            className={FIELD}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status || "all"} value={status}>
                {status
                  ? t(`settings.statistics.statuses.${status}`)
                  : t("settings.statistics.allStatuses")}
              </option>
            ))}
          </select>
          <select
            name="customer"
            aria-label={t("customer")}
            defaultValue={customerFilter || ""}
            className={FIELD}
          >
            <option value="">{t("settings.statistics.allCustomers")}</option>
            {statsCustomers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
          <select
            name="technician"
            aria-label={t("technician")}
            defaultValue={technicianFilter || ""}
            className={FIELD}
          >
            <option value="">{t("settings.statistics.allTechnicians")}</option>
            {statsTechnicians.map((technician) => (
              <option key={technician.id} value={technician.id}>{technician.name}</option>
            ))}
          </select>
          <button type="submit" className={SIGNAL_BUTTON}>
            {t("settings.statistics.filter")}
          </button>
          {(dateFrom || dateTo || statusFilter || customerFilter || technicianFilter) && (
            <Link href="?tab=statistikk" className={INK_BUTTON}>
              {t("settings.statistics.reset")}
            </Link>
          )}
        </form>
      </div>

      {/* STATISTIKK KORT */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="relative overflow-hidden rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4"
          >
            <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${kpi.accent}`} />
            <p className="text-xs font-bold uppercase leading-4 tracking-[0.08em] text-[var(--muted,#62685f)]">
              {kpi.label}
            </p>
            <p className="mt-2 text-3xl font-extrabold text-[var(--ink,#101310)] tabular-nums">
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* MÅNEDLIG TREND */}
      <div className="mb-6 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 sm:p-5">
        <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("settings.statistics.monthlyTrend")}
        </h3>
        <div className="mt-4 flex h-40 items-end gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
          {Object.entries(monthlyTrend as Record<string, number>)
            .sort()
            .slice(-6)
            .map(([month, count]: [string, number]) => {
              const maxCount = Math.max(...Object.values(monthlyTrend));
              const height = maxCount > 0 ? Math.max(10, (count / maxCount) * 100) : 10;
              return (
                <div key={month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-sm bg-[var(--ink,#101310)]"
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--muted,#62685f)]">{month.slice(5)}</span>
                  <span className="text-xs font-bold text-[var(--ink,#101310)]">{count}</span>
                </div>
              );
            })}
        </div>
        <p className="mt-2 text-right text-xs text-[var(--muted,#62685f)]">
          {t("settings.statistics.last6Months")}
        </p>
      </div>

      {/* PER MONTØR */}
      <div className="mb-6 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("settings.statistics.perTechnician")}
        </h3>
        <div className="space-y-2">
          {Object.entries(byTechnician as Record<string, number>)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-2.5">
                <span className="min-w-0 break-words text-sm font-medium text-[var(--ink,#101310)]">{name}</span>
                <span className="shrink-0 text-xs font-bold text-[var(--muted,#62685f)]">{t("settings.statistics.workOrdersCount", { count })}</span>
              </div>
            ))}
          {Object.keys(byTechnician).length === 0 && (
            <p className="py-4 text-center text-sm italic text-[var(--muted,#62685f)]">{t("settings.statistics.noData")}</p>
          )}
        </div>
      </div>

      {/* PER KUNDE */}
      <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("settings.statistics.perCustomer")}
        </h3>
        <div className="space-y-2">
          {Object.entries(byCustomer as Record<string, number>)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => (
              <div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-2.5">
                <span className="min-w-0 max-w-xs truncate text-sm font-medium text-[var(--ink,#101310)]">{name}</span>
                <span className="shrink-0 text-xs font-bold text-[var(--muted,#62685f)]">{t("settings.statistics.workOrdersCount", { count })}</span>
              </div>
            ))}
          {Object.keys(byCustomer).length === 0 && (
            <p className="py-4 text-center text-sm italic text-[var(--muted,#62685f)]">{t("settings.statistics.noData")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
