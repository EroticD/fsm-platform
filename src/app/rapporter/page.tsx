import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { formatDate } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { canAccessWorkOrder } from "@/lib/access";
import { reportWhereFor } from "@/lib/report-filters";
import {
  reportDisplayName,
  reportUnitSummary,
} from "@/lib/report-display";
import { pageWindow, parsePage } from "@/lib/pagination";
import {
  HMS_TYPE_MESSAGE_KEYS,
  isHmsReport,
} from "@/lib/template-categories";

/** Rapporter per side. Listen kan bla gjennom hele historikken. */
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

/**
 * Tidsrom for rapportlisten. «denne-maneden» er standard, slik at listen viser
 * nøyaktig det samme som «Rapporter i mnd.» på dashbordet.
 */
const RANGES = [
  { key: "denne-maneden", labelKey: "orders.reportsPage.thisMonth", icon: "📆" },
  { key: "forrige-maned", labelKey: "orders.reportsPage.lastMonth", icon: "🗓️" },
  { key: "alle", labelKey: "orders.reportsPage.all", icon: "📂" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function isRangeKey(value: string): value is RangeKey {
  return RANGES.some((r) => r.key === value);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ vis?: string; side?: string; type?: string }>;
}) {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  // Kundeportalbrukere slipper inn for å se egne PDF-er via kundeportalen,
  // men selve rapportlisten er en intern oversikt.
  if (user.role === "CUSTOMER") redirect("/kundeportal");
  if (!hasPermission(user, "reports.view")) redirect("/");

  const { vis, side, type } = await searchParams;
  const range: RangeKey = vis && isRangeKey(vis) ? vis : "denne-maneden";
  // Bare den ene, eksplisitte kategorien støttes. Ukjente verdier ignoreres,
  // slik at en gammel lenke fortsatt viser alle rapporter.
  const category = type === "HMS" ? ("HMS" as const) : undefined;
  const excludeCancelled = user.role === "TECHNICIAN";
  const where = reportWhereFor(range, excludeCancelled, category);

  // Rapporter er delbare på tvers av avdelinger for ansatte med reports.view.
  // Oppdragslistene er fortsatt avdelingsavgrensede, og oppdragslenken under
  // vises bare når brukeren faktisk har tilgang til oppdraget.
  const total = await prisma.report.count({ where });
  const window = pageWindow(parsePage(side, undefined), total, PAGE_SIZE);

  const [reports, thisMonth, lastMonth, allReports] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { completedAt: "desc" },
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
            customer: { select: { name: true } },
          },
        },
        units: { select: { id: true, status: true } },
      },
    }),
    prisma.report.count({
      where: reportWhereFor("denne-maneden", excludeCancelled, category),
    }),
    prisma.report.count({
      where: reportWhereFor("forrige-maned", excludeCancelled, category),
    }),
    prisma.report.count({
      where: reportWhereFor("alle", excludeCancelled, category),
    }),
  ]);

  const rangeLabel = (key: RangeKey) =>
    key === "denne-maneden"
      ? t("orders.reportsPage.thisMonth")
      : key === "forrige-maned"
        ? t("orders.reportsPage.lastMonth")
        : t("orders.reportsPage.allHistory");

  const rangeCounts: Record<RangeKey, number> = {
    "denne-maneden": thisMonth,
    "forrige-maned": lastMonth,
    alle: allReports,
  };

  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (range !== "denne-maneden") params.set("vis", range);
    if (category) params.set("type", category);
    if (page > 1) params.set("side", String(page));
    const query = params.toString();
    return `/rapporter${query ? `?${query}` : ""}`;
  };

  // Tidsromslenkene beholder et eventuelt kategorifilter.
  const rangeHref = (key: RangeKey) => {
    const params = new URLSearchParams();
    if (key !== "denne-maneden") params.set("vis", key);
    if (category) params.set("type", category);
    const query = params.toString();
    return `/rapporter${query ? `?${query}` : ""}`;
  };

  const categoryHref = (next?: "HMS") => {
    const params = new URLSearchParams();
    if (range !== "denne-maneden") params.set("vis", range);
    if (next) params.set("type", next);
    const query = params.toString();
    return `/rapporter${query ? `?${query}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">📋 {t("orders.reportsPage.title")}</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              {t("orders.reportsPage.subtitle")} •{" "}
              <span className="font-bold text-gray-700">
                {t("orders.reportsPage.count", { count: total })} ({rangeLabel(range)})
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              ← {t("orders.reportsPage.dashboard")}
            </Link>
            <Link
              href="/oppdrag"
              className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              📂 {t("orders.reportsPage.orders")}
            </Link>
          </div>
        </div>

        {/* TIDSROM */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200">
          <div className="flex gap-2 flex-wrap">
            {RANGES.map((r) => {
              const active = r.key === range;
              return (
                <Link
                  key={r.key}
                  href={rangeHref(r.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border-2 transition whitespace-nowrap ${
                    active
                      ? "bg-blue-700 border-blue-700 text-white shadow-sm"
                      : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300"
                  }`}
                >
                  <span className="leading-none">{r.icon}</span>
                  <span>{t(r.labelKey)}</span>
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                      active ? "bg-white/25" : "bg-white border border-gray-200 text-gray-600"
                    }`}
                  >
                    {rangeCounts[r.key]}
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
              href={categoryHref()}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${
                !category
                  ? "bg-blue-700 border-blue-700 text-white"
                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              {t("orders.reportsPage.filterAll")}
            </Link>
            <Link
              href={categoryHref("HMS")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border-2 transition ${
                category === "HMS"
                  ? "bg-blue-700 border-blue-700 text-white"
                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50"
              }`}
            >
              🛡️ {t("orders.templateGroups.hms")}
            </Link>
          </div>
        </div>

        {/* LISTE */}
        {reports.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">
              {t("orders.reportsPage.emptyTitle", { range: rangeLabel(range) })}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {t("orders.reportsPage.emptyDescription")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => {
              const summary = reportUnitSummary(report);
              const unitCount = summary.unitCount;
              const deviations = summary.deviationCount;
              const hms = isHmsReport(report);
              const canOpenWorkOrder =
                Boolean(report.workOrder) &&
                canAccessWorkOrder(user, report.workOrder!) &&
                (user.role !== "TECHNICIAN" || report.workOrder!.status !== "CANCELLED");
              return (
                <div
                  key={report.id}
                  className="bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 transition"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 truncate">
                        {hms && (
                          <span className="inline-block align-middle mr-2 bg-indigo-100 text-indigo-900 border border-indigo-200 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                            🛡️ {t("orders.templateGroups.hmsBadge")}
                          </span>
                        )}
                        {reportDisplayName(report, t("orders.reportsPage.defaultTitle"))}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        📅 {formatDate(report.completedAt, t("orders.reportsPage.noDate"))}
                        {" • 🏢 "}
                        {report.workOrder?.customer?.name ||
                          t("orders.reportsPage.internalOrder")}
                        {" • 📂 "}
                        {report.workOrder?.title || t("orders.reportsPage.unknownWorkOrder")}
                        {report.workOrder?.orderNumber
                          ? ` • #${report.workOrder.orderNumber}`
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
                          className={`text-[11px] font-bold px-2 py-1 rounded-full border ${
                            deviations > 0
                              ? "bg-red-50 text-red-800 border-red-200"
                              : "bg-green-50 text-green-800 border-green-200"
                          }`}
                        >
                          {deviations > 0
                            ? t("orders.reportsPage.deviations", { count: deviations })
                            : `✅ ${t("orders.reportsPage.units", { count: unitCount })}`}
                        </span>
                      ) : !summary.usesUnits ? (
                        <span className="text-[11px] font-bold px-2 py-1 rounded-full border bg-gray-50 text-gray-700 border-gray-200">
                          {t("orders.reportsPage.noUnits")}
                        </span>
                      ) : null}
                      <span
                        className={`text-[11px] font-bold px-2 py-1 rounded-full border ${
                          report.isLocked
                            ? "bg-gray-100 text-gray-700 border-gray-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }`}
                      >
                        {report.isLocked ? t("orders.reportsPage.locked") : t("orders.reportsPage.openForEdit")}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px]">
                    <span className="font-bold text-gray-600">
                      ✍️ {report.technicianName || report.lockedByName || t("orders.reportsPage.unsigned")}
                    </span>
                    <Link
                      href={`/rapporter/${report.workOrderId}`}
                      className="font-bold text-blue-700 hover:underline"
                    >
                      📄 {t("orders.reportsPage.viewPdf")}
                    </Link>
                    <Link
                      href={`/rapporter/${report.workOrderId}/revisjoner?rapport=${report.id}`}
                      className="font-bold text-gray-600 hover:underline"
                    >
                      🕘 {t("orders.reportsPage.revisions", { count: report.revision })}
                    </Link>
                    {canOpenWorkOrder && (
                      <Link
                        href={`/oppdrag/${report.workOrderId}`}
                        className="font-bold text-gray-600 hover:underline"
                      >
                        📂 {t("orders.reportsPage.openWorkOrder")}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-bold">
            {window.page > 1 && (
              <Link href={pageHref(window.page - 1)} className="text-blue-700 hover:underline">
                ← {t("orders.reportsPage.previousPage")}
              </Link>
            )}
            <span className="text-gray-500">
              {t("orders.reportsPage.showingPage", {
                page: window.page,
                totalPages: window.totalPages,
                total,
              })}
            </span>
            {window.page < window.totalPages && (
              <Link href={pageHref(window.page + 1)} className="text-blue-700 hover:underline">
                {t("orders.reportsPage.nextPage")} →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
