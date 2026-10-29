import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateLocalized } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { getPortalReportHistory } from "@/server/portal";
import { reportDisplayName } from "@/lib/report-display";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import AcknowledgeReportForm from "./AcknowledgeReportForm";

type ReportView = {
  id: string;
  name: string | null;
  templateTitle: string | null;
  reportNumber: string | null;
  requiresUnits: boolean;
  completedAt: Date | null;
  isLocked: boolean;
  revision: number;
  pdfUrl: string | null;
  customerAcknowledgedAt: Date | null;
  customerAcknowledgedBy: string | null;
  customerAcknowledgedComment: string | null;
};

type WorkOrderView = {
  id: string;
  title: string;
  orderNumber: string | null;
  scheduledFor: Date | null;
  reports: ReportView[];
};

/**
 * Rapporthistorikk med nedlasting og kvittering for kundeportalen.
 *
 * Hver side viser alle rapporter for oppdragene på siden, og pagineringen
 * beholder de andre listeposisjonene i kundeportalen.
 */
export default async function ReportHistory({
  page = 1,
  upcomingPage = 1,
  historyPage = 1,
}: {
  page?: number;
  upcomingPage?: number;
  historyPage?: number;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user || user.role !== "CUSTOMER" || !user.customerId) return null;

  const result = await getPortalReportHistory(user, { page });
  if (!result.ok) return null;
  const data = result.data as {
    items: WorkOrderView[];
    total: number;
    page: number;
    totalPages: number;
  };

  const pageLink = (target: number) => {
    const params = new URLSearchParams();
    if (upcomingPage > 1) params.set("u", String(upcomingPage));
    if (historyPage > 1) params.set("h", String(historyPage));
    if (target > 1) params.set("r", String(target));
    const qs = params.toString();
    return `/kundeportal${qs ? `?${qs}` : ""}#rapporter`;
  };

  return (
    <section
      id="rapporter"
      className={`${brandCard} scroll-mt-24 p-4 sm:p-5`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
          />
          <span>{t("p3.portalReports.title")}</span>
        </h2>
        <span className="text-xs text-[var(--muted,#62685f)]">
          {t("p3.portalReports.count", { count: data.total })}
        </span>
      </div>

      <p
        id="kvittering-hjelp"
        className="mb-4 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs leading-5 text-[var(--muted,#62685f)]"
      >
        {t("p3.portalReports.acknowledgeExplain")}
      </p>

      {data.items.length === 0 ? (
        <p className="text-sm italic text-[var(--muted,#62685f)]">
          {t("p3.portalReports.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line,#dedcd1)]">
          {data.items.map((workOrder) => (
            <li key={workOrder.id} className="space-y-4 py-4">
              <div>
                <p className="font-bold text-[var(--ink,#101310)]">
                  {workOrder.title}
                </p>
                <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
                  {t("p3.portalReports.workOrderPerformed", {
                    date: formatDateLocalized(
                      workOrder.scheduledFor,
                      locale,
                      undefined,
                      t("p3.portalReports.unknownDate"),
                    ),
                  })}
                  {workOrder.orderNumber
                    ? ` · ${t("p3.portalReports.orderNumber", {
                        number: workOrder.orderNumber,
                      })}`
                    : ""}
                </p>
              </div>

              {workOrder.reports.length === 0 ? (
                <p className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--muted,#62685f)]">
                  {t("p3.portalReports.noReport")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {workOrder.reports.map((report) => (
                    <li
                      key={report.id}
                      className={`${brandInset} space-y-2 p-3`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-bold text-[var(--ink,#101310)]">
                            {reportDisplayName(report, workOrder.title)}
                          </p>
                          <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
                            {t("p3.portalReports.performed", {
                              date: formatDateLocalized(
                                report.completedAt || workOrder.scheduledFor,
                                locale,
                                undefined,
                                t("p3.portalReports.unknownDate"),
                              ),
                            })}
                            {report.isLocked
                              ? ` · ${t("p3.portalReports.signed")}`
                              : ""}
                            {report.reportNumber
                              ? ` · ${t("p3.portalReports.reportNumber", {
                                  number: report.reportNumber,
                                })}`
                              : ""}
                            {report.revision > 0
                              ? ` · ${t("p3.portalReports.revision", {
                                  revision: report.revision,
                                })}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/api/rapporter/${workOrder.id}/pdf?rapport=${encodeURIComponent(report.id)}`}
                            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ink,#101310)] bg-transparent px-4 py-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                          >
                            {t("p3.portalReports.download")}
                          </Link>
                          {report.revision > 0 && (
                            <Link
                              href={`/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}`}
                              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--ink,#101310)] bg-transparent px-4 py-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                            >
                              {t("p3.portalReports.history")}
                            </Link>
                          )}
                        </div>
                      </div>

                      {report.customerAcknowledgedAt ? (
                        <div className="rounded-xl border border-[#b9cdb4] bg-[#eaf3e4] px-3 py-2 text-xs text-[#24502f]">
                          <p className="font-bold">
                            {t("p3.portalReports.acknowledged", {
                              date: formatDateLocalized(report.customerAcknowledgedAt, locale),
                            })}
                            {report.customerAcknowledgedBy
                              ? ` · ${report.customerAcknowledgedBy}`
                              : ""}
                          </p>
                          {report.customerAcknowledgedComment && (
                            <p className="mt-1 whitespace-pre-wrap">
                              {report.customerAcknowledgedComment}
                            </p>
                          )}
                        </div>
                      ) : (
                        <AcknowledgeReportForm
                          workOrderId={workOrder.id}
                          reportId={report.id}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-[var(--line,#dedcd1)] pt-3 text-xs font-bold">
          {data.page > 1 && (
            <Link
              href={pageLink(data.page - 1)}
              className="inline-flex min-h-11 items-center text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
            >
              &larr; {t("p3.portalReports.previous")}
            </Link>
          )}
          <span className="text-[var(--muted,#62685f)]">
            {t("p3.portalReports.pageOf", {
              page: data.page,
              pages: data.totalPages,
            })}
          </span>
          {data.page < data.totalPages && (
            <Link
              href={pageLink(data.page + 1)}
              className="inline-flex min-h-11 items-center text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
            >
              {t("p3.portalReports.next")} &rarr;
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
