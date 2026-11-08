import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser, isOffice } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Icon from "@/components/icons";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import Card from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import {
  getProfitability,
  type ProfitabilityData,
} from "@/server/bi";
import type { BiFirstTimeFixOutcome } from "@/lib/bi";
import { formatDateLocalized } from "@/lib/dates";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.lonnsomhet") };
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hours(minutes: number, locale: string): string {
  const value = minutes / 60;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: value > 0 && value < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function percent(value: number | null, locale: string): string {
  if (value === null) return "–";
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value)} %`;
}

function money(ore: number | null, locale: string): string {
  if (ore === null) return "–";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(ore / 100);
}

function count(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function exportHref(data: ProfitabilityData): string {
  const params = new URLSearchParams();
  params.set("fra", data.filters.from);
  params.set("til", data.filters.to);
  if (data.filters.departmentId) params.set("avdeling", data.filters.departmentId);
  if (data.filters.customerId) params.set("kunde", data.filters.customerId);
  if (data.filters.technicianId) params.set("tekniker", data.filters.technicianId);
  return `/api/lonnsomhet/eksport?${params.toString()}`;
}

function statusLabel(
  status: string,
  t: (key: string) => string,
): string {
  const key = `bi.status.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

function firstTimeFixLabel(
  outcome: BiFirstTimeFixOutcome,
  t: (key: string) => string,
): string {
  return t(`bi.firstTimeFix.${outcome}`);
}

function UtilisationBar({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      role="img"
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-line"
    >
      <div
        aria-hidden="true"
        className="h-full rounded-full bg-ink"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function BreakdownTable({
  title,
  description,
  rows,
  kind,
  locale,
  t,
}: {
  title: string;
  description: string;
  rows: Array<{
    id: string;
    name: string;
    orders: number;
    completed: number;
    workMinutes: number;
    travelMinutes: number;
    totalMinutes: number;
    firstTimeFixRate: number | null;
    estimatedRevenueOre: number;
    actualRevenueOre: number | null;
    utilizationPercent?: number | null;
    availableMinutes?: number;
  }>;
  kind: "technician" | "customer";
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <Card as="section" className="min-w-0 p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="type-title-3 text-ink">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={<Icon name="chart" className="h-6 w-6" />}
          title={t("bi.empty.period")}
        />
      ) : (
        <div
          className="overflow-x-auto"
          role="region"
          aria-label={title}
          tabIndex={0}
        >
          <table className="office-table min-w-[720px]">
            <thead>
              <tr>
                <th scope="col">
                  {t(kind === "technician" ? "bi.table.technician" : "bi.table.customer")}
                </th>
                <th scope="col" className="text-right">
                  {t("bi.table.orders")}
                </th>
                <th scope="col" className="text-right">
                  {t("bi.table.work")}
                </th>
                <th scope="col" className="text-right">
                  {t("bi.table.travel")}
                </th>
                <th scope="col" className="text-right">
                  {t("bi.table.total")}
                </th>
                {kind === "technician" ? (
                  <>
                    <th scope="col" className="text-right">
                      {t("bi.table.available")}
                    </th>
                    <th scope="col">{t("bi.table.utilisation")}</th>
                  </>
                ) : null}
                <th scope="col" className="text-right">
                  {t("bi.table.firstTimeFix")}
                </th>
                <th scope="col" className="text-right">
                  {t("bi.table.estimatedRevenue")}
                </th>
                <th scope="col" className="text-right">
                  {t("bi.table.actualRevenue")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${kind}-${row.id}`}>
                  <td className="max-w-[220px] font-semibold text-ink">
                    <span className="block truncate">{row.name}</span>
                    {kind === "technician" ? (
                      <span className="block text-xs font-normal text-muted">
                        {t("bi.table.completedOf", {
                          completed: row.completed,
                          total: row.orders,
                        })}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">
                    {count(row.orders, locale)}
                  </td>
                  <td className="text-right tabular-nums">
                    {hours(row.workMinutes, locale)}
                  </td>
                  <td className="text-right tabular-nums">
                    {hours(row.travelMinutes, locale)}
                  </td>
                  <td className="text-right font-bold tabular-nums">
                    {hours(row.totalMinutes, locale)}
                  </td>
                  {kind === "technician" ? (
                    <>
                      <td className="text-right tabular-nums">
                        {hours(row.availableMinutes ?? 0, locale)}
                      </td>
                      <td className="w-32">
                        <UtilisationBar
                          value={row.utilizationPercent ?? null}
                          label={t("bi.chart.utilisationAria", {
                            name: row.name,
                            percent: percent(row.utilizationPercent ?? null, locale),
                          })}
                        />
                        <span className="mt-1 block text-right text-xs font-bold tabular-nums text-ink">
                          {percent(row.utilizationPercent ?? null, locale)}
                        </span>
                      </td>
                    </>
                  ) : null}
                  <td className="text-right tabular-nums">
                    {percent(row.firstTimeFixRate, locale)}
                  </td>
                  <td className="text-right font-bold tabular-nums text-ink">
                    {money(row.estimatedRevenueOre, locale)}
                  </td>
                  <td className="text-right font-bold tabular-nums text-ink">
                    {money(row.actualRevenueOre, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("bi");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!isOffice(user.role) || !hasPermission(user, "reports.view")) {
    redirect("/");
  }

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const result = await getProfitability(user, {
    from: firstParam(params.fra),
    to: firstParam(params.til),
    departmentId: firstParam(params.avdeling),
    customerId: firstParam(params.kunde),
    technicianId: firstParam(params.tekniker),
  });

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader
          title={t("bi.title")}
          subtitle={t("bi.subtitle")}
          icon={<Icon name="chart" className="h-5 w-5" />}
        />
        <ErrorBanner
          message={
            result.reason === "too_large"
              ? t("bi.errors.tooLarge")
              : result.reason === "forbidden"
                ? t("bi.errors.forbidden")
                : t("bi.errors.invalid")
          }
        />
      </PageShell>
    );
  }

  const data = result.data;
  const summarySubtitle =
    data.filters.from === data.filters.to
      ? formatDateLocalized(data.filters.from, locale) ?? data.filters.from
      : `${formatDateLocalized(data.filters.from, locale) ?? data.filters.from} – ${
          formatDateLocalized(data.filters.to, locale) ?? data.filters.to
        }`;

  const kpis = [
    {
      label: t("bi.kpis.orders"),
      value: count(data.orders.total, locale),
      sub: t("bi.kpis.ordersSub", {
        completed: data.orders.completed,
        cancelled: data.orders.cancelled,
      }),
    },
    {
      label: t("bi.kpis.completionRate"),
      value: percent(data.orders.completionRate, locale),
      sub: t("bi.kpis.completionRateSub"),
    },
    {
      label: t("bi.kpis.firstTimeFix"),
      value: percent(data.firstTimeFix.rate, locale),
      sub: t("bi.kpis.firstTimeFixSub", {
        fixed: data.firstTimeFix.fixed,
        eligible: data.firstTimeFix.eligible,
      }),
    },
    {
      label: t("bi.kpis.hours"),
      value: `${hours(data.time.totalMinutes, locale)} h`,
      sub: t("bi.kpis.hoursSub", {
        work: hours(data.time.workMinutes, locale),
        travel: hours(data.time.travelMinutes, locale),
      }),
    },
    {
      label: t("bi.kpis.utilisation"),
      value: percent(data.capacity.utilizationPercent, locale),
      sub: t("bi.kpis.utilisationSub", {
        available: hours(data.capacity.availableMinutes, locale),
      }),
    },
    {
      label: t("bi.kpis.revenue"),
      value: money(data.revenue.estimatedRevenueOre, locale),
      sub: t("bi.kpis.revenueSub", {
        orders: data.revenue.estimatedRevenueOrders,
      }),
    },
    {
      label: t("bi.kpis.actualRevenue"),
      value: money(data.revenue.actualRevenueOre, locale),
      sub: data.revenue.actualAvailable
        ? t("bi.kpis.actualRevenueSub", {
            invoices: data.revenue.actualInvoiceCount,
            orders: data.revenue.actualOrderCount,
          })
        : t("bi.kpis.actualRevenueUnavailable"),
    },
    {
      label: t("bi.kpis.profit"),
      value: money(data.revenue.estimatedProfitOre, locale),
      sub:
        data.revenue.costBasis === "internal_rate"
          ? t("bi.kpis.profitSub", {
              rate: money(data.revenue.costRateOrePerHour, locale),
            })
          : t("bi.kpis.profitMissing"),
    },
  ];

  const maxTechnicianMinutes = Math.max(
    1,
    ...data.perTechnician.map((row) => row.totalMinutes),
  );

  return (
    <PageShell>
      <PageHeader
        title={t("bi.title")}
        subtitle={t("bi.subtitle")}
        icon={<Icon name="chart" className="h-5 w-5" />}
        actions={
          <>
            <span className="hidden rounded-full border border-line bg-surface px-3 py-2 text-xs font-bold text-ink sm:inline-flex">
              {summarySubtitle}
            </span>
            <Link
              href={exportHref(data)}
              className={buttonClassName({ variant: "primary", size: "sm" })}
            >
              <Icon name="arrowRight" className="h-4 w-4" />
              {t("bi.export")}
            </Link>
          </>
        }
      />

      {/* FILTER */}
      <Card as="section" className="p-4 sm:p-5" aria-labelledby="bi-filter-title">
        <h2 id="bi-filter-title" className="sr-only">
          {t("bi.filters.title")}
        </h2>
        <form
          action="/lonnsomhet"
          method="get"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6"
        >
          <Field id="bi-from" label={t("bi.filters.from")} className="min-w-0">
            <Input id="bi-from" type="date" name="fra" defaultValue={data.filters.from} />
          </Field>
          <Field id="bi-to" label={t("bi.filters.to")} className="min-w-0">
            <Input id="bi-to" type="date" name="til" defaultValue={data.filters.to} />
          </Field>
          <Field id="bi-department" label={t("bi.filters.department")} className="min-w-0">
            <Select
              id="bi-department"
              name="avdeling"
              defaultValue={data.filters.departmentId ?? ""}
            >
              <option value="">{t("bi.filters.allDepartments")}</option>
              {data.options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="bi-customer" label={t("bi.filters.customer")} className="min-w-0">
            <Select
              id="bi-customer"
              name="kunde"
              defaultValue={data.filters.customerId ?? ""}
            >
              <option value="">{t("bi.filters.allCustomers")}</option>
              {data.options.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="bi-technician" label={t("bi.filters.technician")} className="min-w-0">
            <Select
              id="bi-technician"
              name="tekniker"
              defaultValue={data.filters.technicianId ?? ""}
            >
              <option value="">{t("bi.filters.allTechnicians")}</option>
              {data.options.technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className={`${buttonClassName({ variant: "primary" })} flex-1`}
            >
              {t("bi.filters.apply")}
            </button>
            <Link
              href="/lonnsomhet"
              className={buttonClassName({ variant: "secondary" })}
            >
              {t("bi.filters.reset")}
            </Link>
          </div>
        </form>
      </Card>

      {/* ESTIMAT-MERKING */}
      <section
        aria-labelledby="bi-estimate-title"
        className="rounded-xl border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] p-4 text-sm text-[var(--warning-text,#7a4f0c)]"
      >
        <div className="flex items-start gap-3">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 id="bi-estimate-title" className="font-extrabold">
              {data.revenue.actualAvailable
                ? t("bi.actual.availableTitle")
                : t("bi.estimate.title")}
            </h2>
            <p className="mt-0.5 leading-6">
              {data.revenue.actualAvailable
                ? t("bi.actual.availableDescription", {
                    invoices: data.revenue.actualInvoiceCount,
                  })
                : t("bi.actual.unavailableDescription")}
            </p>
            <p className="mt-1 text-xs font-semibold">
              {t("bi.estimate.basis", {
                basis: t(`bi.basis.${data.revenue.basis}`),
                coverage: percent(data.revenue.coveragePercent, locale),
              })}
              {data.revenue.costBasis === "missing"
                ? ` ${t("bi.estimate.costMissing")}`
                : ` ${t("bi.estimate.costConfigured", {
                    rate: money(data.revenue.costRateOrePerHour, locale),
                  })}`}
            </p>
          </div>
        </div>
      </section>

      {/* KPI-er */}
      <section
        data-bi-kpis
        aria-label={t("bi.kpis.title")}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {kpis.map((kpi, index) => (
          <Card key={kpi.label} className="relative overflow-hidden p-4">
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 top-0 h-1 ${
                index === 0
                  ? "bg-signal"
                  : index === 7
                    ? "bg-[var(--risk,#f04427)]"
                    : "bg-ink"
              }`}
            />
            <p className="type-eyebrow text-muted">{kpi.label}</p>
            <p className="mt-2 text-2xl font-extrabold tabular-nums text-ink sm:text-3xl">
              {kpi.value}
            </p>
            <p className="mt-1 text-xs font-medium text-muted">{kpi.sub}</p>
          </Card>
        ))}
      </section>

      {/* ENKEL CSS-GRAF */}
      <Card as="section" className="p-4 sm:p-5" aria-labelledby="bi-chart-title">
        <div className="mb-4">
          <h2 id="bi-chart-title" className="type-title-3 text-ink">
            {t("bi.chart.title")}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {t("bi.chart.description", {
              basis: t(`bi.capacityBasis.${data.capacity.basis}`),
            })}
          </p>
        </div>
        {data.perTechnician.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="chart" className="h-6 w-6" />}
            title={t("bi.empty.period")}
          />
        ) : (
          <ul className="space-y-3">
            {data.perTechnician.map((technician) => {
              const width = Math.round(
                (technician.totalMinutes / maxTechnicianMinutes) * 100,
              );
              return (
                <li key={technician.id} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-semibold text-ink">
                      {technician.name}
                    </span>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-muted">
                      {t("bi.chart.hoursOf", {
                        hours: hours(technician.totalMinutes, locale),
                        utilisation: percent(
                          technician.utilizationPercent,
                          locale,
                        ),
                      })}
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={t("bi.chart.hoursAria", {
                      name: technician.name,
                      hours: hours(technician.totalMinutes, locale),
                      utilisation: percent(
                        technician.utilizationPercent,
                        locale,
                      ),
                    })}
                    className="mt-1 h-4 w-full overflow-hidden rounded-md bg-paper"
                  >
                    <div
                      aria-hidden="true"
                      className="h-full rounded-md bg-ink"
                      style={{ width: `${Math.max(width, 2)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          {t("bi.chart.note", {
            work: hours(data.time.workMinutes, locale),
            travel: hours(data.time.travelMinutes, locale),
          })}
        </p>
      </Card>

      {data.orders.total === 0 ? (
        <EmptyState
          icon={<Icon name="chart" className="h-6 w-6" />}
          title={t("bi.empty.title")}
          description={t("bi.empty.description")}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <BreakdownTable
              title={t("bi.tables.technicians")}
              description={t("bi.tables.techniciansDescription")}
              rows={data.perTechnician.map((row) => ({
                id: row.id,
                name: row.name,
                orders: row.orders,
                completed: row.completed,
                workMinutes: row.workMinutes,
                travelMinutes: row.travelMinutes,
                totalMinutes: row.totalMinutes,
                firstTimeFixRate: row.firstTimeFixRate,
                estimatedRevenueOre: row.estimatedRevenueOre,
                actualRevenueOre: row.actualRevenueOre,
                utilizationPercent: row.utilizationPercent,
                availableMinutes: row.availableMinutes,
              }))}
              kind="technician"
              locale={locale}
              t={t}
            />
            <BreakdownTable
              title={t("bi.tables.customers")}
              description={t("bi.tables.customersDescription")}
              rows={data.perCustomer.map((row) => ({
                id: row.id ?? "none",
                name: row.name,
                orders: row.orders,
                completed: row.completed,
                workMinutes: row.workMinutes,
                travelMinutes: row.travelMinutes,
                totalMinutes: row.totalMinutes,
                firstTimeFixRate: row.firstTimeFixRate,
                estimatedRevenueOre: row.estimatedRevenueOre,
                actualRevenueOre: row.actualRevenueOre,
              }))}
              kind="customer"
              locale={locale}
              t={t}
            />
          </div>

          <Card
            as="section"
            className="min-w-0 p-4 sm:p-5"
            aria-labelledby="bi-orders-title"
          >
            <div className="mb-3">
              <h2 id="bi-orders-title" className="type-title-3 text-ink">
                {t("bi.tables.orders")}
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {t("bi.tables.ordersDescription", {
                  count: data.perOrder.length,
                })}
              </p>
            </div>
            <div
              className="overflow-x-auto"
              role="region"
              aria-label={t("bi.tables.orders")}
              tabIndex={0}
            >
              <table className="office-table min-w-[960px]">
                <thead>
                  <tr>
                    <th scope="col">{t("bi.table.order")}</th>
                    <th scope="col">{t("bi.table.customer")}</th>
                    <th scope="col">{t("bi.table.status")}</th>
                    <th scope="col">{t("bi.table.technician")}</th>
                    <th scope="col" className="text-right">{t("bi.table.total")}</th>
                    <th scope="col">{t("bi.table.firstTimeFix")}</th>
                    <th scope="col" className="text-right">{t("bi.table.estimatedRevenue")}</th>
                    <th scope="col" className="text-right">{t("bi.table.actualRevenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perOrder.map((order) => (
                    <tr key={order.id}>
                      <td className="max-w-[260px] font-semibold text-ink">
                        <span className="block truncate">{order.title}</span>
                        <span className="block text-xs font-normal text-muted">
                          {order.reference}
                          {order.scheduledFor
                            ? ` · ${formatDateLocalized(order.scheduledFor, locale) ?? order.scheduledFor}`
                            : ""}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate">
                        {order.customerName}
                      </td>
                      <td>{statusLabel(order.status, t)}</td>
                      <td className="max-w-[160px] truncate">
                        {order.technicians || "–"}
                      </td>
                      <td className="text-right tabular-nums">
                        {hours(order.totalMinutes, locale)}
                      </td>
                      <td>{firstTimeFixLabel(order.firstTimeFix, t)}</td>
                      <td className="text-right font-bold tabular-nums text-ink">
                        {money(order.estimatedRevenueOre, locale)}
                      </td>
                      <td className="text-right font-bold tabular-nums text-ink">
                        {money(order.actualRevenueOre, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </PageShell>
  );
}
