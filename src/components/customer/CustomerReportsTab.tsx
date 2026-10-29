import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { reportWorkOrderScope } from "@/lib/report-scope";
import type { AccessUser } from "@/lib/access";
import { formatDateLocalized } from "@/lib/dates";
import {
  reportAcknowledgement,
  reportDisplayName,
  reportUnitSummary,
} from "@/lib/report-display";

const REPORT_LIMIT = 30;

/**
 * Kundens rapporter. Ligger under Oppdrag-fanen og bruker samme
 * rapportomfang som resten av kundekortet: ansatte ser egen avdeling,
 * administrator og reports.viewAllDepartments ser alle, og montører ser ikke
 * rapporter fra kansellerte oppdrag.
 */
export default async function CustomerReportsTab({
  customerId,
  user,
}: {
  customerId: string;
  user: AccessUser;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();

  const workOrderWhere: Prisma.WorkOrderWhereInput = {
    AND: [
      { customerId, deletedAt: null },
      reportWorkOrderScope(user),
      ...(user.role === "TECHNICIAN"
        ? [{ status: { not: "CANCELLED" as const } }]
        : []),
    ],
  };

  const where: Prisma.ReportWhereInput = {
    deletedAt: null,
    workOrder: workOrderWhere,
  };

  const [totalReports, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
      take: REPORT_LIMIT,
      include: {
        template: { select: { title: true } },
        workOrder: {
          select: {
            id: true,
            title: true,
            orderNumber: true,
            status: true,
          },
        },
        units: { select: { id: true, label: true, status: true } },
      },
    }),
  ]);

  const returnTo = `/kunder/${customerId}?tab=oppdrag&vis=rapporter`;
  const listHref = `/rapporter?vis=alle&kunde=${encodeURIComponent(customerId)}`;

  return (
    <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-3">
        <div>
          <h2 className="text-lg font-black text-gray-900">
            📋 {t("customers.reports.title")}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {t("customers.reports.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {totalReports > 0 && (
            <span className="font-bold text-gray-500">
              {t("customers.reports.showing", {
                shown: reports.length,
                total: totalReports,
              })}
            </span>
          )}
          <Link
            href={listHref}
            className="font-bold text-blue-700 hover:underline"
          >
            {t("customers.reports.allReports")} →
          </Link>
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center">
          <p className="font-bold text-gray-700">
            {t("customers.reports.empty")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t("customers.reports.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((report) => {
            const summary = reportUnitSummary(report);
            const acknowledgement = reportAcknowledgement(report);
            const unitNames = summary.usesUnits
              ? report.units
                  .map((unit) => unit.label)
                  .filter((label): label is string => Boolean(label))
              : [];
            const shownUnitNames = unitNames.slice(0, 3);
            const extraUnits = unitNames.length - shownUnitNames.length;

            const viewerHref = `/rapporter/${report.workOrderId}?rapport=${encodeURIComponent(report.id)}&returnTo=${encodeURIComponent(returnTo)}`;
            const revisionsHref = `/rapporter/${report.workOrderId}/revisjoner?rapport=${encodeURIComponent(report.id)}&returnTo=${encodeURIComponent(returnTo)}`;

            const lockTitle = report.isLocked
              ? report.lockedAt
                ? t("customers.reports.lockedTooltip", {
                    date: formatDateLocalized(report.lockedAt, locale),
                    name:
                      report.lockedByName ||
                      t("customers.reports.unknownUser"),
                  })
                : report.lockedByName
                  ? t("customers.reports.lockedTooltipNoDate", {
                      name: report.lockedByName,
                    })
                  : undefined
              : undefined;

            return (
              <article
                key={report.id}
                className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-3 transition hover:border-blue-300 sm:p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black text-gray-900 sm:text-base">
                      {reportDisplayName(
                        report,
                        t("orders.reportsPage.defaultTitle"),
                      )}
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">
                      📅{" "}
                      {formatDateLocalized(
                        report.completedAt,
                        locale,
                        undefined,
                        t("orders.reportsPage.noDate"),
                      )}
                      {report.reportNumber
                        ? ` • ${t("customers.reports.reportNumber", {
                            number: report.reportNumber,
                          })}`
                        : ""}
                      {" • 📂 "}
                      {report.workOrder.title}
                      {report.workOrder.orderNumber
                        ? ` • #${report.workOrder.orderNumber}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                        report.isLocked
                          ? "border-gray-200 bg-gray-100 text-gray-700"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                      title={lockTitle}
                    >
                      {report.isLocked
                        ? t("customers.reports.locked")
                        : t("customers.reports.openForEdit")}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                        acknowledgement.acknowledged
                          ? "border-green-200 bg-green-50 text-green-800"
                          : "border-gray-200 bg-white text-gray-600"
                      }`}
                      title={
                        acknowledgement.by
                          ? t("customers.reportList.acknowledgedBy", {
                              name: acknowledgement.by,
                            })
                          : undefined
                      }
                    >
                      {acknowledgement.acknowledged
                        ? t("customers.reports.acknowledged", {
                            date: formatDateLocalized(
                              acknowledgement.at,
                              locale,
                            ),
                          })
                        : t("customers.reports.notAcknowledged")}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                  {summary.usesUnits ? (
                    <>
                      <span className="font-bold">
                        🔧{" "}
                        {t("customers.reports.unitCount", {
                          count: summary.unitCount,
                        })}
                      </span>
                      {shownUnitNames.length > 0 && (
                        <span
                          className="min-w-0 truncate"
                          title={unitNames.join(", ")}
                        >
                          {t("customers.reports.unitNames", {
                            names: shownUnitNames.join(", "),
                          })}
                          {extraUnits > 0
                            ? ` ${t("customers.reports.moreUnits", {
                                count: extraUnits,
                              })}`
                            : ""}
                        </span>
                      )}
                      {summary.deviationCount > 0 && (
                        <span className="font-bold text-red-800">
                          {t("customers.reports.deviations", {
                            count: summary.deviationCount,
                          })}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-500">
                      {t("customers.reports.noUnits")}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2">
                  <span className="text-xs font-bold text-gray-600">
                    ✍️{" "}
                    {report.technicianName ||
                      report.lockedByName ||
                      t("orders.reportsPage.unsigned")}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={viewerHref}
                      className="rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-800"
                    >
                      {t("customers.reports.openReport")}
                    </Link>
                    <Link
                      href={revisionsHref}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-100"
                    >
                      {report.revision > 0
                        ? t("customers.reports.revisions", {
                            count: report.revision,
                          })
                        : t("customers.reports.revisionsLabel")}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}

          {totalReports > reports.length && (
            <p className="pt-1 text-center text-xs text-gray-500">
              {t("customers.reports.showing", {
                shown: reports.length,
                total: totalReports,
              })}{" "}
              <Link href={listHref} className="font-bold text-blue-700 hover:underline">
                {t("customers.reports.allReports")} →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
