import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { getPortalReportHistory } from "@/server/portal";
import { acknowledgeReportAction } from "@/app/kundeportal/report-actions";
import { reportDisplayName } from "@/lib/report-display";

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
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <h2 className="text-lg font-bold text-gray-900">
          {t("p3.portalReports.title")}
        </h2>
        <span className="text-xs text-gray-500">
          {t("p3.portalReports.count", { count: data.total })}
        </span>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm italic text-gray-500">
          {t("p3.portalReports.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.items.map((workOrder) => (
            <li key={workOrder.id} className="space-y-4 py-4">
              <div>
                <p className="font-bold text-gray-900">{workOrder.title}</p>
                <p className="text-xs text-gray-500">
                  {t("p3.portalReports.workOrderPerformed", {
                    date: formatDate(
                      workOrder.scheduledFor,
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
                <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
                  {t("p3.portalReports.noReport")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {workOrder.reports.map((report) => (
                    <li
                      key={report.id}
                      className="space-y-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-bold text-gray-900">
                            {reportDisplayName(report, workOrder.title)}
                          </p>
                          <p className="text-xs text-gray-600">
                            {t("p3.portalReports.performed", {
                              date: formatDate(
                                report.completedAt || workOrder.scheduledFor,
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
                            href={`/api/rapporter/${workOrder.id}/pdf`}
                            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50"
                          >
                            {t("p3.portalReports.download")}
                          </Link>
                          {report.revision > 0 && (
                            <Link
                              href={`/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}`}
                              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50"
                            >
                              {t("p3.portalReports.history")}
                            </Link>
                          )}
                        </div>
                      </div>

                      {report.customerAcknowledgedAt ? (
                        <div className="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-900">
                          <p className="font-bold">
                            {t("p3.portalReports.acknowledged", {
                              date: formatDate(report.customerAcknowledgedAt),
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
                        <form
                          action={acknowledgeReportAction}
                          className="flex flex-col gap-2 sm:flex-row"
                        >
                          <input
                            type="hidden"
                            name="workOrderId"
                            value={workOrder.id}
                          />
                          <input
                            type="hidden"
                            name="reportId"
                            value={report.id}
                          />
                          <input
                            name="comment"
                            aria-label={t(
                              "p3.portalReports.commentPlaceholder",
                            )}
                            placeholder={t(
                              "p3.portalReports.commentPlaceholder",
                            )}
                            className="min-h-11 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900"
                          />
                          <button
                            type="submit"
                            className="min-h-11 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
                          >
                            {t("p3.portalReports.acknowledge")}
                          </button>
                        </form>
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
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-gray-100 pt-3 text-xs font-bold">
          {data.page > 1 && (
            <Link
              href={pageLink(data.page - 1)}
              className="text-blue-700 hover:underline"
            >
              &larr; {t("p3.portalReports.previous")}
            </Link>
          )}
          <span className="text-gray-500">
            {t("p3.portalReports.pageOf", {
              page: data.page,
              pages: data.totalPages,
            })}
          </span>
          {data.page < data.totalPages && (
            <Link
              href={pageLink(data.page + 1)}
              className="text-blue-700 hover:underline"
            >
              {t("p3.portalReports.next")} &rarr;
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
