import Link from "next/link";
import Icon from "@/components/icons";
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
    <div className="space-y-4 rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 shadow-[0_1px_2px_rgba(20,17,11,0.05)] [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
            />
            <span className="min-w-0">{t("customers.reports.title")}</span>
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("customers.reports.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {totalReports > 0 && (
            <span className="font-bold text-[var(--muted,#62685f)]">
              {t("customers.reports.showing", {
                shown: reports.length,
                total: totalReports,
              })}
            </span>
          )}
          <Link
            href={listHref}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--ink,#101310)] px-3 font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("customers.reports.allReports")}
            <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
          </Link>
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-6 text-center">
          <p className="font-bold text-[var(--ink,#101310)]">
            {t("customers.reports.empty")}
          </p>
          <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
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
                className="rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 transition hover:border-[#b9ae98] sm:p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-extrabold text-[var(--ink,#101310)] sm:text-base">
                      {reportDisplayName(
                        report,
                        t("orders.reportsPage.defaultTitle"),
                      )}
                    </h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-[var(--muted,#62685f)]">
                      <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
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
                      <span aria-hidden>•</span>
                      <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                      {report.workOrder.title}
                      {report.workOrder.orderNumber
                        ? ` • #${report.workOrder.orderNumber}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-xs font-bold ${
                        report.isLocked
                          ? "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--muted,#62685f)]"
                          : "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05]"
                      }`}
                      title={lockTitle}
                    >
                      {report.isLocked
                        ? t("customers.reports.locked")
                        : t("customers.reports.openForEdit")}
                    </span>
                    <span
                      className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-xs font-bold ${
                        acknowledgement.acknowledged
                          ? "border-[#b9cdb4] bg-[#eaf3e4] text-[#24502f]"
                          : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--muted,#62685f)]"
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

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted,#62685f)]">
                  {summary.usesUnits ? (
                    <>
                      <span className="inline-flex items-center gap-1 font-bold">
                        <Icon name="wrench" className="h-3.5 w-3.5 shrink-0" />
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
                        <span className="font-bold text-[#a92a12]">
                          {t("customers.reports.deviations", {
                            count: summary.deviationCount,
                          })}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[#7a7468]">
                      {t("customers.reports.noUnits")}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line,#dedcd1)] pt-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--muted,#62685f)]">
                    <Icon name="pen" className="h-3.5 w-3.5 shrink-0" />
                    {report.technicianName ||
                      report.lockedByName ||
                      t("orders.reportsPage.unsigned")}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={viewerHref}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 text-xs font-bold text-[var(--ink,#101310)] shadow-[1px_1px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
                    >
                      {t("customers.reports.openReport")}
                    </Link>
                    <Link
                      href={revisionsHref}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ink,#101310)] bg-transparent px-4 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
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
            <p className="pt-1 text-center text-xs text-[var(--muted,#62685f)]">
              {t("customers.reports.showing", {
                shown: reports.length,
                total: totalReports,
              })}{" "}
              <Link
                href={listHref}
                className="inline-flex min-h-11 items-center gap-1 font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
              >
                {t("customers.reports.allReports")}
                <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
