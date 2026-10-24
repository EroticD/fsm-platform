import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { getPortalReportHistory } from "@/server/portal";
import { acknowledgeReportAction } from "@/app/kundeportal/report-actions";

type ReportView = {
  id: string;
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
        <h2 className="text-lg font-bold text-gray-900">📄 Rapporter</h2>
        <span className="text-xs text-gray-500">{data.total} rapporter</span>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm italic text-gray-500">
          Ingen rapporter er publisert ennå.
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
                    <p className="font-bold text-gray-900">{workOrder.title}</p>
                    <p className="text-xs text-gray-500">
                      Utført {formatDate(workOrder.scheduledFor || report.completedAt)}
                      {report.isLocked ? " · signert" : ""}
                    </p>
                  </div>
                  <Link
                    href={`/api/rapporter/${workOrder.id}/pdf`}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50"
                  >
                    Last ned PDF
                  </Link>
                </div>

                {report.customerAcknowledgedAt ? (
                  <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-bold text-green-800">
                    ✓ Kvittert {formatDate(report.customerAcknowledgedAt)}
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
                      placeholder="Kommentar (valgfritt)"
                      className="min-h-11 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900"
                    />
                    <button
                      type="submit"
                      className="min-h-11 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
                    >
                      Kvitter mottatt
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
