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
  completedAt: Date;
  isLocked: boolean;
  pdfUrl: string | null;
  customerAcknowledgedAt: Date | null;
};

type WorkOrderView = {
  id: string;
  title: string;
  scheduledFor: Date | null;
  reports: ReportView[];
};

/** Rapporthistorikk, nedlasting og kvittering for kundeportalen. */
export default async function ReportHistory() {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user || user.role !== "CUSTOMER" || !user.customerId) return null;

  const result = await getPortalReportHistory(user, { page: 1 });
  if (!result.ok) return null;
  const data = result.data as {
    items: WorkOrderView[];
    total: number;
    totalPages: number;
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <h2 className="text-lg font-bold text-gray-900">{t("p3.portalReports.title")}</h2>
        <span className="text-xs text-gray-500">{t("p3.portalReports.count", { count: data.total })}</span>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm italic text-gray-500">
          {t("p3.portalReports.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.items.map((workOrder) => {
            const report = workOrder.reports[0];
            if (!report) return null;
            return (
              <li key={workOrder.id} className="space-y-3 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-bold text-gray-900">
                      {reportDisplayName(report, workOrder.title)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("p3.portalReports.performed", { date: formatDate(workOrder.scheduledFor || report.completedAt) })}
                      {report.isLocked ? ` · ${t("p3.portalReports.signed")}` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/api/rapporter/${workOrder.id}/pdf`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50"
                  >
                    {t("p3.portalReports.download")}
                  </Link>
                </div>

                {report.customerAcknowledgedAt ? (
                  <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-bold text-green-800">
                    {t("p3.portalReports.acknowledged", { date: formatDate(report.customerAcknowledgedAt) })}
                  </p>
                ) : (
                  <form
                    action={acknowledgeReportAction}
                    className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3 sm:flex-row"
                  >
                    <input type="hidden" name="workOrderId" value={workOrder.id} />
                    <input type="hidden" name="reportId" value={report.id} />
                    <input
                      name="comment"
                      placeholder={t("p3.portalReports.commentPlaceholder")}
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
