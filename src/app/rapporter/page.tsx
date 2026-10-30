import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { formatDateLocalized } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { canAccessWorkOrder, staffWhere } from "@/lib/access";
import { reportWorkOrderScope } from "@/lib/report-scope";
import {
  reportAcknowledgement,
  reportDisplayName,
  reportUnitSummary,
} from "@/lib/report-display";
import { pageWindow, parsePage } from "@/lib/pagination";
import PageHeader from "@/components/PageHeader";
import Icon, { type IconName } from "@/components/icons";
import Pagination, { paginationLabels } from "@/components/Pagination";
import {
  HMS_TYPE_MESSAGE_KEYS,
  isHmsReport,
} from "@/lib/template-categories";
import {
  parseReportListParams,
  reportListHref,
  reportListOrderBy,
  reportListWhere,
  REPORTS_PAGE_SIZE,
  type ReportListFilters,
  type ReportRangeKey,
  type ReportSortKey,
} from "./search-params";

/** Rapporter per side. */
const PAGE_SIZE = REPORTS_PAGE_SIZE;

/** Et begrenset antall filtervalg – lister skal aldri hente hele tabellen. */
const FILTER_OPTION_LIMIT = 300;

// Command Center-verdier. Fallbackene matcher office-card/signal-button/
// ink-button-tokenene, slik at rapportlisten står riktig også før de er lastet.
const CARD = "office-card";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const QUIET_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]";
const FIELD =
  "min-h-10 w-full rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
const EYEBROW =
  "text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const MUTED = "text-[var(--muted,#62685f)]";
const FILTER_CHIP =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition";
const ACTIVE_CHIP =
  "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]";
const INACTIVE_CHIP =
  "border-[var(--line,#dedcd1)] bg-white text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]";

const RANGES = [
  { key: "denne-maneden", labelKey: "orders.reportsPage.thisMonth", icon: "calendar" },
  { key: "forrige-maned", labelKey: "orders.reportsPage.lastMonth", icon: "calendar" },
  { key: "alle", labelKey: "orders.reportsPage.all", icon: "folder" },
] as const satisfies ReadonlyArray<{
  key: ReportRangeKey;
  labelKey: string;
  icon: IconName;
}>;

const SORTS = [
  { key: "dato-desc", labelKey: "orders.reportsPage.sortNewest" },
  { key: "dato-asc", labelKey: "orders.reportsPage.sortOldest" },
  { key: "kunde", labelKey: "orders.reportsPage.sortCustomer" },
  { key: "montor", labelKey: "orders.reportsPage.sortTechnician" },
] as const satisfies ReadonlyArray<{
  key: ReportSortKey;
  labelKey: string;
}>;

type AcknowledgementFilter = "ja" | "nei" | null;

/** Kvitteringsfilteret holdes utenfor de delte søkeparametrene. */
function readAcknowledgementFilter(
  value: string | string[] | undefined,
): AcknowledgementFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "ja" || raw === "nei" ? raw : null;
}

function acknowledgementWhere(
  filter: Exclude<AcknowledgementFilter, null>,
): Prisma.ReportWhereInput {
  return filter === "ja"
    ? { customerAcknowledgedAt: { not: null } }
    : { customerAcknowledgedAt: null };
}

function withAcknowledgementFilter(
  href: string,
  filter: AcknowledgementFilter,
): string {
  if (!filter) return href;
  return `${href}${href.includes("?") ? "&" : "?"}kvittering=${filter}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.rapporter") };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  // Kundeportalbrukere slipper inn for å se egne PDF-er via kundeportalen,
  // men selve rapportlisten er en intern oversikt.
  if (user.role === "CUSTOMER") redirect("/kundeportal");
  if (!hasPermission(user, "reports.view")) redirect("/");

  const rawParams = await searchParams;
  const filters = parseReportListParams(rawParams);
  const acknowledgementFilter = readAcknowledgementFilter(
    rawParams.kvittering,
  );
  const acknowledgementClause = acknowledgementFilter
    ? acknowledgementWhere(acknowledgementFilter)
    : null;
  const excludeCancelled = user.role === "TECHNICIAN";
  const reportScope = reportWorkOrderScope(user);
  const baseWhere = reportListWhere(filters, excludeCancelled, reportScope);
  const where: Prisma.ReportWhereInput = acknowledgementClause
    ? { AND: [baseWhere, acknowledgementClause] }
    : baseWhere;
  const whereForRange = (range: ReportRangeKey): Prisma.ReportWhereInput => {
    const rangeWhere = reportListWhere(
      { ...filters, range },
      excludeCancelled,
      reportScope,
    );
    return acknowledgementClause
      ? { AND: [rangeWhere, acknowledgementClause] }
      : rangeWhere;
  };

  // Rapporter vises på tvers av avdelinger bare for administrator og ansatte
  // som er eksplisitt gitt reports.viewAllDepartments. Oppdragslistene er
  // fortsatt avdelingsavgrensede, og oppdragslenken under vises bare når
  // brukeren faktisk har tilgang til oppdraget.
  const total = await prisma.report.count({ where });
  const pageParam = Array.isArray(rawParams.side)
    ? rawParams.side[0]
    : rawParams.side;
  const window = pageWindow(parsePage(pageParam), total, PAGE_SIZE);

  const [reports, thisMonth, lastMonth, allReports] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: reportListOrderBy(filters.sort),
      skip: window.skip,
      take: window.take,
      include: {
        template: { select: { title: true } },
        workOrder: {
          select: {
            id: true,
            title: true,
            orderNumber: true,
            status: true,
            departmentId: true,
            customerId: true,
            department: { select: { isActive: true } },
            customer: { select: { name: true } },
          },
        },
        units: { select: { id: true, status: true, label: true } },
      },
    }),
    prisma.report.count({ where: whereForRange("denne-maneden") }),
    prisma.report.count({ where: whereForRange("forrige-maned") }),
    prisma.report.count({ where: whereForRange("alle") }),
  ]);

  const showCustomers = hasPermission(user, "customers.view");
  const showTechnicians = hasPermission(user, "workorders.view");
  const canWriteReports = hasPermission(user, "reports.write");

  // Filtervalgene er begrenset og bare en bekvemmelighet; selve filteret
  // valideres på nytt mot id-formatet i `parseReportListParams`.
  let customers: Array<{ id: string; name: string }> = [];
  let technicians: Array<{
    id: string;
    name: string | null;
    email: string | null;
  }> = [];
  try {
    [customers, technicians] = await Promise.all([
      showCustomers
        ? prisma.customer.findMany({
            where: { deletedAt: null },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
            take: FILTER_OPTION_LIMIT,
          })
        : Promise.resolve([]),
      showTechnicians
        ? prisma.user.findMany({
            where: staffWhere(),
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
            take: FILTER_OPTION_LIMIT,
          })
        : Promise.resolve([]),
    ]);
  } catch (error) {
    console.error("Kunne ikke hente filtervalg for rapportlisten", error);
  }

  const technicianOptions = technicians
    .map((technician) => ({
      id: technician.id,
      name: technician.name || technician.email || "",
    }))
    .filter((technician) => technician.name.length > 0);

  const listHref = (
    overrides: Partial<ReportListFilters> = {},
    page?: number,
    ack: AcknowledgementFilter = acknowledgementFilter,
  ) =>
    withAcknowledgementFilter(
      reportListHref({ filters, overrides, page }),
      ack,
    );

  const rangeLabel = (key: ReportRangeKey) =>
    key === "denne-maneden"
      ? t("orders.reportsPage.thisMonth")
      : key === "forrige-maned"
        ? t("orders.reportsPage.lastMonth")
        : t("orders.reportsPage.allHistory");

  const rangeCounts: Record<ReportRangeKey, number> = {
    "denne-maneden": thisMonth,
    "forrige-maned": lastMonth,
    alle: allReports,
  };

  const hasActiveFilters = Boolean(
    filters.customer ||
      filters.technician ||
      filters.deviationOnly ||
      filters.q ||
      filters.category ||
      acknowledgementFilter,
  );
  const resetHref = listHref(
    {
      customer: undefined,
      technician: undefined,
      deviationOnly: false,
      q: "",
      sort: "dato-desc",
      category: undefined,
    },
    undefined,
    null,
  );
  const currentPageHref = listHref({}, window.page);
  const reportHref = (workOrderId: string, reportId: string) =>
    `/rapporter/${workOrderId}?rapport=${encodeURIComponent(reportId)}&returnTo=${encodeURIComponent(currentPageHref)}`;
  const revisionsHref = (workOrderId: string, reportId: string) =>
    `/rapporter/${workOrderId}/revisjoner?rapport=${encodeURIComponent(reportId)}&returnTo=${encodeURIComponent(currentPageHref)}`;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          title={t("orders.reportsPage.title")}
          subtitle={`${t("orders.reportsPage.subtitle")} · ${t("orders.reportsPage.count", { count: total })} (${rangeLabel(filters.range)})`}
          icon={<Icon name="clipboard" className="h-5 w-5" />}
          actions={
            <>
              <Link href="/" className={INK_BUTTON}>
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("orders.reportsPage.dashboard")}
              </Link>
              <Link href="/oppdrag" className={INK_BUTTON}>
                <Icon name="folder" className="h-4 w-4 shrink-0" />
                {t("orders.reportsPage.orders")}
              </Link>
            </>
          }
        />

        {/* TIDSROM, TYPE OG KVITTERING */}
        <section className={`${CARD} space-y-2.5 p-3 sm:p-4`}>
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGES.map((range) => {
              const active = range.key === filters.range;
              return (
                <Link
                  key={range.key}
                  href={listHref({ range: range.key })}
                  aria-current={active ? "page" : undefined}
                  className={`${FILTER_CHIP} ${active ? ACTIVE_CHIP : INACTIVE_CHIP}`}
                >
                  <Icon name={range.icon} className="h-3.5 w-3.5 shrink-0" />
                  <span>{t(range.labelKey)}</span>
                  <span
                    className={`rounded-full px-1.5 text-[11px] font-black tabular-nums ${
                      active
                        ? "bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                        : "border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
                    }`}
                  >
                    {rangeCounts[range.key]}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line,#dedcd1)] pt-2.5">
            <span className={`${EYEBROW} mr-1`}>
              {t("orders.reportsPage.filterLabel")}
            </span>
            <Link
              href={listHref({ category: undefined })}
              className={`${FILTER_CHIP} ${!filters.category ? ACTIVE_CHIP : INACTIVE_CHIP}`}
            >
              {t("orders.reportsPage.filterAll")}
            </Link>
            <Link
              href={listHref({ category: "HMS" })}
              className={`${FILTER_CHIP} ${filters.category === "HMS" ? ACTIVE_CHIP : INACTIVE_CHIP}`}
            >
              <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
              {t("orders.templateGroups.hms")}
            </Link>
            <span className={`${EYEBROW} ml-0 mr-1 sm:ml-3`}>
              {t("customers.reportList.acknowledgement")}
            </span>
            <Link
              href={listHref({}, undefined, null)}
              aria-current={!acknowledgementFilter ? "page" : undefined}
              className={`${FILTER_CHIP} ${!acknowledgementFilter ? ACTIVE_CHIP : INACTIVE_CHIP}`}
            >
              {t("customers.reportList.ackAll")}
            </Link>
            <Link
              href={listHref({}, undefined, "ja")}
              aria-current={
                acknowledgementFilter === "ja" ? "page" : undefined
              }
              className={`${FILTER_CHIP} ${acknowledgementFilter === "ja" ? ACTIVE_CHIP : INACTIVE_CHIP}`}
            >
              {t("customers.reportList.acknowledged")}
            </Link>
            <Link
              href={listHref({}, undefined, "nei")}
              aria-current={
                acknowledgementFilter === "nei" ? "page" : undefined
              }
              className={`${FILTER_CHIP} ${acknowledgementFilter === "nei" ? ACTIVE_CHIP : INACTIVE_CHIP}`}
            >
              {t("customers.reportList.notAcknowledged")}
            </Link>
          </div>

          {/* FILTRE OG SORTERING */}
          <form
            action="/rapporter"
            method="get"
            className="grid grid-cols-1 gap-2.5 border-t border-[var(--line,#dedcd1)] pt-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {filters.range !== "denne-maneden" && (
              <input type="hidden" name="vis" value={filters.range} />
            )}
            {filters.category && (
              <input type="hidden" name="type" value={filters.category} />
            )}
            {acknowledgementFilter && (
              <input
                type="hidden"
                name="kvittering"
                value={acknowledgementFilter}
              />
            )}

            <div className="sm:col-span-2 lg:col-span-4">
              <label htmlFor="report-filter-q" className={LABEL}>
                {t("orders.reportsPage.freeText")}
              </label>
              <input
                id="report-filter-q"
                type="search"
                name="q"
                defaultValue={filters.q}
                maxLength={100}
                placeholder={t("orders.reportsPage.freeTextPlaceholder")}
                className={FIELD}
              />
            </div>

            {showCustomers && (
              <div>
                <label htmlFor="report-filter-customer" className={LABEL}>
                  {t("orders.reportsPage.customer")}
                </label>
                <select
                  id="report-filter-customer"
                  name="kunde"
                  defaultValue={filters.customer ?? ""}
                  className={FIELD}
                >
                  <option value="">{t("orders.reportsPage.allCustomers")}</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showTechnicians && technicianOptions.length > 0 && (
              <div>
                <label htmlFor="report-filter-technician" className={LABEL}>
                  {t("orders.reportsPage.technician")}
                </label>
                <select
                  id="report-filter-technician"
                  name="montor"
                  defaultValue={filters.technician ?? ""}
                  className={FIELD}
                >
                  <option value="">{t("orders.reportsPage.allTechnicians")}</option>
                  {technicianOptions.map((technician) => (
                    <option key={technician.id} value={technician.id}>
                      {technician.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="report-filter-sort" className={LABEL}>
                {t("orders.reportsPage.sort")}
              </label>
              <select
                id="report-filter-sort"
                name="sorter"
                defaultValue={filters.sort}
                className={FIELD}
              >
                {SORTS.map((sort) => (
                  <option key={sort.key} value={sort.key}>
                    {t(sort.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 text-sm font-bold text-[var(--ink,#101310)]">
                <input
                  type="checkbox"
                  name="avvik"
                  value="1"
                  defaultChecked={filters.deviationOnly}
                  className="h-4 w-4 rounded border-[var(--line,#dedcd1)] accent-[var(--ink,#101310)]"
                />
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
                  {t("orders.reportsPage.deviationOnly")}
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
              <button type="submit" className={INK_BUTTON}>
                <Icon name="filter" className="h-3.5 w-3.5 shrink-0" />
                {t("orders.reportsPage.applyFilters")}
              </button>
              {hasActiveFilters && (
                <Link href={resetHref} className={QUIET_BUTTON}>
                  {t("orders.reportsPage.resetFilters")}
                </Link>
              )}
            </div>
          </form>
        </section>

        {/* LISTE */}
        {reports.length === 0 ? (
          <div className={`${CARD} p-8 text-center`}>
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
              <Icon name="clipboard" className="h-5 w-5" />
            </span>
            <h2 className="mt-3 text-base font-extrabold text-[var(--ink,#101310)]">
              {hasActiveFilters
                ? t("orders.reportsPage.emptyFilteredTitle")
                : t("orders.reportsPage.emptyTitle", {
                    range: rangeLabel(filters.range),
                  })}
            </h2>
            <p className={`mx-auto mt-1 max-w-md text-sm ${MUTED}`}>
              {hasActiveFilters
                ? t("orders.reportsPage.emptyFilteredDescription")
                : t("orders.reportsPage.emptyDescription")}
            </p>
            {(hasActiveFilters || filters.range !== "alle") && (
              <div className="mt-4 flex justify-center">
                <Link
                  href={
                    hasActiveFilters
                      ? resetHref
                      : listHref({ range: "alle" })
                  }
                  className={SIGNAL_BUTTON}
                >
                  {hasActiveFilters
                    ? t("orders.reportsPage.resetFilters")
                    : t("orders.reportsPage.all")}
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className={`${CARD} overflow-hidden`}>
            <div className="hidden items-center gap-2 border-b border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]/60 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)] md:flex">
              <span className="min-w-0 flex-1">
                {t("orders.reportsPage.tableReport")}
              </span>
              <span className="w-56 shrink-0">
                {t("orders.reportsPage.tableCustomer")}
              </span>
              <span className="w-28 shrink-0">
                {t("orders.reportsPage.tableDate")}
              </span>
              <span className="w-64 shrink-0">
                {t("orders.reportsPage.tableStatus")}
              </span>
              <span className="ml-auto shrink-0 text-right">
                {t("orders.reportsPage.tableActions")}
              </span>
            </div>
            <div className="divide-y divide-[var(--line,#dedcd1)]">
              {reports.map((report) => {
                const summary = reportUnitSummary(report);
                const unitCount = summary.unitCount;
                const deviations = summary.deviationCount;
                const acknowledgement = reportAcknowledgement(report);
                const unitNames = summary.usesUnits
                  ? report.units
                      .map((unit) => unit.label)
                      .filter((label): label is string => Boolean(label))
                  : [];
                const shownUnitNames = unitNames.slice(0, 2);
                const extraUnits = unitNames.length - shownUnitNames.length;
                const hms = isHmsReport(report);
                const workOrder = report.workOrder;
                const canOpenWorkOrder =
                  Boolean(workOrder) &&
                  canAccessWorkOrder(user, {
                    departmentId: workOrder!.departmentId,
                    customerId: workOrder!.customerId,
                    departmentIsActive: workOrder!.department?.isActive,
                  }) &&
                  (user.role !== "TECHNICIAN" ||
                    workOrder!.status !== "CANCELLED");
                // Skjemaet kan bare åpnes av brukere som faktisk har
                // skrivetilgang til oppdraget. Rapporten må fortsatt være ulåst.
                const canOpenForm =
                  canWriteReports &&
                  canOpenWorkOrder &&
                  !report.isLocked &&
                  Boolean(report.templateId);
                const formReturnTo =
                  user.role === "ADMIN" || user.role === "OFFICE"
                    ? `/oppdrag/${report.workOrderId}`
                    : `/mine-oppdrag/${report.workOrderId}`;
                const lockTitle = report.isLocked
                  ? report.lockedAt
                    ? t("customers.reportList.lockTooltip", {
                        date: formatDateLocalized(report.lockedAt, locale),
                        name:
                          report.lockedByName ||
                          t("customers.reportList.unknownUser"),
                      })
                    : report.lockedByName
                      ? t("customers.reportList.lockTooltipNoDate", {
                          name: report.lockedByName,
                        })
                      : undefined
                  : undefined;
                const acknowledgementTitle = acknowledgement.by
                  ? t("customers.reportList.acknowledgedBy", {
                      name: acknowledgement.by,
                    })
                  : undefined;
                const hasMoreActions =
                  canOpenForm || canOpenWorkOrder || report.revision > 0;

                return (
                  <div
                    key={report.id}
                    className="flex flex-col gap-2 px-3 py-2.5 transition hover:bg-[var(--paper,#f2efe6)]/50 md:flex-row md:items-start"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {hms && (
                          <span className="inline-flex items-center gap-1 rounded border border-[var(--ink,#101310)] bg-[var(--paper,#f2efe6)] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[var(--ink,#101310)]">
                            <Icon name="shield" className="h-3 w-3 shrink-0" />
                            {t("orders.templateGroups.hmsBadge")}
                          </span>
                        )}
                        <Link
                          href={reportHref(report.workOrderId, report.id)}
                          className="min-w-0 truncate text-sm font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]"
                        >
                          {reportDisplayName(
                            report,
                            t("orders.reportsPage.defaultTitle"),
                          )}
                        </Link>
                      </div>
                      <p className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs ${MUTED}`}>
                        {report.reportNumber && (
                          <span className="font-bold tabular-nums">
                            {t("orders.reportsPage.reportNumber", {
                              number: report.reportNumber,
                            })}
                          </span>
                        )}
                        {report.reportNumber && hms && report.hmsType && (
                          <span aria-hidden>·</span>
                        )}
                        {hms && report.hmsType && (
                          <span>{t(HMS_TYPE_MESSAGE_KEYS[report.hmsType])}</span>
                        )}
                        {report.revision > 0 && (
                          <>
                            <span aria-hidden>·</span>
                            <span>
                              {t("customers.reportList.revision", {
                                count: report.revision,
                              })}
                            </span>
                          </>
                        )}
                      </p>
                      {shownUnitNames.length > 0 && (
                        <p
                          className={`mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs ${MUTED}`}
                          title={unitNames.join(", ")}
                        >
                          <Icon name="wrench" className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {t("customers.reportList.unitNames", {
                              count: unitCount,
                              names: shownUnitNames.join(", "),
                            })}
                            {extraUnits > 0
                              ? ` ${t("customers.reportList.moreUnits", {
                                  count: extraUnits,
                                })}`
                              : ""}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="min-w-0 md:w-56 md:shrink-0">
                      <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)]">
                        <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {workOrder?.customer?.name ||
                            t("orders.reportsPage.internalOrder")}
                        </span>
                      </p>
                      <p className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs ${MUTED}`}>
                        <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {workOrder?.title ||
                            t("orders.reportsPage.unknownWorkOrder")}
                          {workOrder?.orderNumber
                            ? ` · #${workOrder.orderNumber}`
                            : ""}
                        </span>
                      </p>
                    </div>

                    <div className="md:w-28 md:shrink-0">
                      <p className="flex items-center gap-1.5 whitespace-nowrap text-xs font-bold tabular-nums text-[var(--ink,#101310)]">
                        <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
                        {formatDateLocalized(
                          report.completedAt,
                          locale,
                          undefined,
                          t("orders.reportsPage.noDate"),
                        )}
                      </p>
                      <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${MUTED}`}>
                        <Icon name="pen" className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {report.technicianName ||
                            report.lockedByName ||
                            t("orders.reportsPage.unsigned")}
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1 md:w-64 md:shrink-0">
                      {summary.usesUnits && unitCount > 0 ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${
                            deviations > 0
                              ? "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]"
                              : "border-[var(--line,#dedcd1)] bg-white text-[var(--ink,#101310)]"
                          }`}
                        >
                          <Icon
                            name={deviations > 0 ? "alert" : "check"}
                            className="h-3 w-3 shrink-0"
                          />
                          {deviations > 0
                            ? t("orders.reportsPage.deviations", {
                                count: deviations,
                              })
                            : t("orders.reportsPage.units", {
                                count: unitCount,
                              })}
                        </span>
                      ) : !summary.usesUnits ? (
                        <span className={`inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold ${MUTED}`}>
                          <Icon name="wrench" className="h-3 w-3 shrink-0" />
                          {t("orders.reportsPage.noUnits")}
                        </span>
                      ) : null}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${
                          report.isLocked
                            ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                            : "border-[#dfc98b] bg-[#fdf5e4] text-[#6b4808]"
                        }`}
                        title={lockTitle}
                      >
                        <Icon
                          name={report.isLocked ? "shield" : "pen"}
                          className="h-3 w-3 shrink-0"
                        />
                        {report.isLocked
                          ? t("orders.reportsPage.locked")
                          : t("orders.reportsPage.openForEdit")}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${
                          acknowledgement.acknowledged
                            ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                            : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
                        }`}
                        title={acknowledgementTitle}
                      >
                        <Icon
                          name={acknowledgement.acknowledged ? "check" : "clock"}
                          className="h-3 w-3 shrink-0"
                        />
                        {acknowledgement.acknowledged
                          ? t("customers.reportList.acknowledgedWithDate", {
                              date: formatDateLocalized(
                                acknowledgement.at,
                                locale,
                                undefined,
                                t("orders.reportsPage.noDate"),
                              ),
                            })
                          : t("customers.reportList.notAcknowledged")}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 md:ml-auto md:shrink-0 md:justify-end">
                      <Link
                        href={reportHref(report.workOrderId, report.id)}
                        className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--ink,#101310)] px-2.5 py-1 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
                      >
                        <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                        {t("customers.reportList.open")}
                      </Link>
                      {hasMoreActions && (
                        <details className="relative">
                          <summary
                            aria-label={t("customers.reportList.moreActions")}
                            title={t("customers.reportList.moreActions")}
                            className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--line,#dedcd1)] bg-white text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)] [&::-webkit-details-marker]:hidden"
                          >
                            <Icon name="more" className="h-4 w-4" />
                          </summary>
                          <div className={`${CARD} absolute right-0 z-30 mt-1 w-56 space-y-0.5 p-2 shadow-xl`}>
                            {report.revision > 0 && (
                              <Link
                                href={revisionsHref(
                                  report.workOrderId,
                                  report.id,
                                )}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                              >
                                <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                                {t("customers.reportList.revision", {
                                  count: report.revision,
                                })}
                              </Link>
                            )}
                            {canOpenForm && (
                              <Link
                                href={`/mine-oppdrag/${report.workOrderId}/skjema/${report.templateId}?returnTo=${encodeURIComponent(formReturnTo)}`}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-[#6b4808] transition hover:bg-[#fdf5e4]"
                              >
                                <Icon name="pen" className="h-3.5 w-3.5 shrink-0" />
                                {t("orders.reportsPage.openForm")}
                              </Link>
                            )}
                            {canOpenWorkOrder && (
                              <Link
                                href={`/oppdrag/${report.workOrderId}`}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                              >
                                <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                                {t("orders.reportsPage.openWorkOrder")}
                              </Link>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {total > 0 && (
          <Pagination
            page={window.page}
            totalPages={window.totalPages}
            hrefFor={(targetPage) => listHref({}, targetPage)}
            labels={paginationLabels(t)}
            summary={t("orders.reportsPage.showingPage", {
              page: window.page,
              totalPages: window.totalPages,
              total,
            })}
          />
        )}
      </div>
    </div>
  );
}
