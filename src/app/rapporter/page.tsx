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
import EmptyState from "@/components/EmptyState";
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <PageHeader
          title={t("orders.reportsPage.title")}
          subtitle={`${t("orders.reportsPage.subtitle")} • ${t("orders.reportsPage.count", { count: total })} (${rangeLabel(filters.range)})`}
          icon={<Icon name="clipboard" className="h-5 w-5" />}
          actions={
            <>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
              >
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("orders.reportsPage.dashboard")}
              </Link>
              <Link
                href="/oppdrag"
                className="inline-flex items-center gap-1.5 bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
              >
                <Icon name="folder" className="h-4 w-4 shrink-0" />
                {t("orders.reportsPage.orders")}
              </Link>
            </>
          }
        />

        {/* TIDSROM */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200">
          <div className="flex gap-2 flex-wrap">
            {RANGES.map((range) => {
              const active = range.key === filters.range;
              return (
                <Link
                  key={range.key}
                  href={listHref({ range: range.key })}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border-2 transition whitespace-nowrap ${
                    active
                      ? "bg-blue-700 border-blue-700 text-white shadow-sm"
                      : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300"
                  }`}
                >
                  <Icon name={range.icon} className="h-4 w-4 shrink-0" />
                  <span>{t(range.labelKey)}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                      active ? "bg-white text-blue-800 ring-1 ring-inset ring-blue-200" : "bg-white border border-gray-200 text-gray-600"
                    }`}
                  >
                    {rangeCounts[range.key]}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs font-black text-gray-500 uppercase tracking-wider">
              {t("orders.reportsPage.filterLabel")}
            </span>
            <Link
              href={listHref({ category: undefined })}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${
                !filters.category
                  ? "bg-blue-700 border-blue-700 text-white"
                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              {t("orders.reportsPage.filterAll")}
            </Link>
            <Link
              href={listHref({ category: "HMS" })}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${
                filters.category === "HMS"
                  ? "bg-blue-700 border-blue-700 text-white"
                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
              {t("orders.templateGroups.hms")}
            </Link>
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-gray-100">
            <span className="text-xs font-black text-gray-500 uppercase tracking-wider">
              {t("customers.reportList.acknowledgement")}
            </span>
            <Link
              href={listHref({}, undefined, null)}
              aria-current={!acknowledgementFilter ? "page" : undefined}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${
                !acknowledgementFilter
                  ? "bg-blue-700 border-blue-700 text-white"
                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              {t("customers.reportList.ackAll")}
            </Link>
            <Link
              href={listHref({}, undefined, "ja")}
              aria-current={
                acknowledgementFilter === "ja" ? "page" : undefined
              }
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${
                acknowledgementFilter === "ja"
                  ? "bg-blue-700 border-blue-700 text-white"
                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              {t("customers.reportList.acknowledged")}
            </Link>
            <Link
              href={listHref({}, undefined, "nei")}
              aria-current={
                acknowledgementFilter === "nei" ? "page" : undefined
              }
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${
                acknowledgementFilter === "nei"
                  ? "bg-blue-700 border-blue-700 text-white"
                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              {t("customers.reportList.notAcknowledged")}
            </Link>
          </div>

          {/* FILTRE OG SORTERING */}
          <form
            action="/rapporter"
            method="get"
            className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2 lg:grid-cols-4"
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
              <label
                htmlFor="report-filter-q"
                className="text-xs font-bold uppercase tracking-wide text-gray-500"
              >
                {t("orders.reportsPage.freeText")}
              </label>
              <input
                id="report-filter-q"
                type="search"
                name="q"
                defaultValue={filters.q}
                maxLength={100}
                placeholder={t("orders.reportsPage.freeTextPlaceholder")}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            {showCustomers && (
              <div>
                <label
                  htmlFor="report-filter-customer"
                  className="text-xs font-bold uppercase tracking-wide text-gray-500"
                >
                  {t("orders.reportsPage.customer")}
                </label>
                <select
                  id="report-filter-customer"
                  name="kunde"
                  defaultValue={filters.customer ?? ""}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
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
                <label
                  htmlFor="report-filter-technician"
                  className="text-xs font-bold uppercase tracking-wide text-gray-500"
                >
                  {t("orders.reportsPage.technician")}
                </label>
                <select
                  id="report-filter-technician"
                  name="montor"
                  defaultValue={filters.technician ?? ""}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
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
              <label
                htmlFor="report-filter-sort"
                className="text-xs font-bold uppercase tracking-wide text-gray-500"
              >
                {t("orders.reportsPage.sort")}
              </label>
              <select
                id="report-filter-sort"
                name="sorter"
                defaultValue={filters.sort}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                {SORTS.map((sort) => (
                  <option key={sort.key} value={sort.key}>
                    {t(sort.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col justify-end">
              <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm font-bold text-gray-700">
                <input
                  type="checkbox"
                  name="avvik"
                  value="1"
                  defaultChecked={filters.deviationOnly}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                />
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
                  {t("orders.reportsPage.deviationOnly")}
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
              >
                {t("orders.reportsPage.applyFilters")}
              </button>
              {hasActiveFilters && (
                <Link
                  href={resetHref}
                  className="rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100"
                >
                  {t("orders.reportsPage.resetFilters")}
                </Link>
              )}
            </div>
          </form>
        </div>

        {/* LISTE */}
        {reports.length === 0 ? (
          <EmptyState
            icon={<Icon name="clipboard" className="h-8 w-8" />}
            title={
              hasActiveFilters
                ? t("orders.reportsPage.emptyFilteredTitle")
                : t("orders.reportsPage.emptyTitle", {
                    range: rangeLabel(filters.range),
                  })
            }
            description={
              hasActiveFilters
                ? t("orders.reportsPage.emptyFilteredDescription")
                : t("orders.reportsPage.emptyDescription")
            }
            action={
              hasActiveFilters ? (
                <Link
                  href={resetHref}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
                >
                  {t("orders.reportsPage.resetFilters")}
                </Link>
              ) : filters.range !== "alle" ? (
                <Link
                  href={listHref({ range: "alle" })}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
                >
                  {t("orders.reportsPage.all")}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2">
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
                (user.role !== "TECHNICIAN" || workOrder!.status !== "CANCELLED");
              // Skjemaet kan bare åpnes av brukere som faktisk har skrivetilgang
              // til oppdraget. Rapporten må fortsatt være ulåst.
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
                  className="bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 truncate">
                        {hms && (
                          <span className="mr-2 inline-flex items-center gap-1 bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                            <Icon name="shield" className="h-3 w-3 shrink-0" />
                            {t("orders.templateGroups.hmsBadge")}
                          </span>
                        )}
                        {reportDisplayName(report, t("orders.reportsPage.defaultTitle"))}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                        <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
                        {formatDateLocalized(
                          report.completedAt,
                          locale,
                          undefined,
                          t("orders.reportsPage.noDate"),
                        )}
                        <span aria-hidden>•</span>
                        <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                        {workOrder?.customer?.name ||
                          t("orders.reportsPage.internalOrder")}
                        <span aria-hidden>•</span>
                        <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                        {workOrder?.title || t("orders.reportsPage.unknownWorkOrder")}
                        {workOrder?.orderNumber
                          ? ` • #${workOrder.orderNumber}`
                          : ""}
                        {hms && report.hmsType
                          ? ` • ${t(HMS_TYPE_MESSAGE_KEYS[report.hmsType])}`
                          : ""}
                        {report.reportNumber
                          ? ` • ${t("orders.reportsPage.reportNumber", {
                              number: report.reportNumber,
                            })}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {summary.usesUnits && unitCount > 0 ? (
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full border ${
                            deviations > 0
                              ? "bg-red-50 text-red-800 border-red-200"
                              : "bg-green-50 text-green-800 border-green-200"
                          }`}
                        >
                          {deviations > 0 ? (
                            t("orders.reportsPage.deviations", { count: deviations })
                          ) : (
                            <>
                              <Icon name="check" className="h-3 w-3 shrink-0" />
                              {t("orders.reportsPage.units", { count: unitCount })}
                            </>
                          )}
                        </span>
                      ) : !summary.usesUnits ? (
                        <span className="text-xs font-bold px-2 py-1 rounded-full border bg-gray-50 text-gray-700 border-gray-200">
                          {t("orders.reportsPage.noUnits")}
                        </span>
                      ) : null}
                      <span
                        className={`text-xs font-bold px-2 py-1 rounded-full border ${
                          report.isLocked
                            ? "bg-gray-100 text-gray-700 border-gray-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }`}
                        title={lockTitle}
                      >
                        {report.isLocked ? t("orders.reportsPage.locked") : t("orders.reportsPage.openForEdit")}
                      </span>
                      <span
                        className={`text-xs font-bold px-2 py-1 rounded-full border ${
                          acknowledgement.acknowledged
                            ? "bg-green-50 text-green-800 border-green-200"
                            : "bg-gray-50 text-gray-600 border-gray-200"
                        }`}
                        title={acknowledgementTitle}
                      >
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
                  </div>

                  {shownUnitNames.length > 0 && (
                    <p
                      className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-gray-500"
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

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-bold text-gray-600">
                      <Icon name="pen" className="h-3.5 w-3.5 shrink-0" />
                      {report.technicianName || report.lockedByName || t("orders.reportsPage.unsigned")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Link
                        href={reportHref(report.workOrderId, report.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3 py-1.5 font-bold text-white transition hover:bg-blue-800"
                      >
                        <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                        {t("customers.reportList.open")}
                      </Link>
                      {hasMoreActions && (
                        <details className="relative">
                          <summary
                            aria-label={t("customers.reportList.moreActions")}
                            title={t("customers.reportList.moreActions")}
                            className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-gray-200 bg-white font-black text-gray-600 transition hover:bg-gray-100 [&::-webkit-details-marker]:hidden"
                          >
                            <Icon name="more" className="h-4 w-4" />
                          </summary>
                          <div className="absolute right-0 z-30 mt-1 w-56 space-y-1 rounded-xl border-2 border-gray-200 bg-white p-2 shadow-xl">
                            {report.revision > 0 && (
                              <Link
                                href={revisionsHref(report.workOrderId, report.id)}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 font-bold text-gray-700 transition hover:bg-gray-100"
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
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 font-bold text-amber-800 transition hover:bg-amber-50"
                              >
                                <Icon name="pen" className="h-3.5 w-3.5 shrink-0" />
                                {t("orders.reportsPage.openForm")}
                              </Link>
                            )}
                            {canOpenWorkOrder && (
                              <Link
                                href={`/oppdrag/${report.workOrderId}`}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-2 font-bold text-gray-700 transition hover:bg-gray-100"
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
                </div>
              );
            })}
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
