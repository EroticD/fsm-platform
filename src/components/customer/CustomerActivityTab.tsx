import Link from "next/link";
import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import StatusBadge from "@/components/StatusBadge";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateLocalized, formatDateTimeLocalized } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";

type ActivityTabProps = {
  customerId: string;
  auditLogs: CustomerDetailData["customerAuditLogs"];
  comments: CustomerDetailData["customerComments"];
  workOrders: CustomerDetailData["activityWorkOrders"];
  reports: CustomerDetailData["activityReports"];
  currentUserName: string | null;
  canManageCustomers: boolean;
  canViewReports: boolean;
};

export default async function CustomerActivityTab({
  customerId,
  auditLogs,
  comments,
  workOrders,
  reports,
  currentUserName,
  canManageCustomers,
  canViewReports,
}: ActivityTabProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <h2 className="font-black text-gray-900 mb-3 border-b pb-2">
            📂 {t("customers.activity.recentOrders")}
          </h2>
          {workOrders.length === 0 ? (
            <p className="text-xs italic text-gray-600">
              {t("customers.activity.noRecentOrders")}
            </p>
          ) : (
            <ul className="space-y-2">
              {workOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/oppdrag/${order.id}`}
                    className="block rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-blue-300 hover:bg-blue-50/60"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-gray-900">
                        {order.title}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 text-xs text-gray-600">
                      {t("customers.activity.orderUpdated", {
                        date: formatDateTimeLocalized(order.updatedAt, locale),
                      })}
                      {order.scheduledFor
                        ? ` • 📅 ${formatDateLocalized(order.scheduledFor, locale)}`
                        : ""}
                      {order.technicians.length > 0
                        ? ` • 👷 ${order.technicians
                            .map((tech) => tech.name)
                            .filter(Boolean)
                            .join(", ")}`
                        : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canViewReports && (
          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
            <h2 className="font-black text-gray-900 mb-3 border-b pb-2">
              📋 {t("customers.activity.recentReports")}
            </h2>
            {reports.length === 0 ? (
              <p className="text-xs italic text-gray-600">
                {t("customers.activity.noRecentReports")}
              </p>
            ) : (
              <ul className="space-y-2">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Link
                      href={`/rapporter/${report.workOrderId}`}
                      className="block rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-blue-300 hover:bg-blue-50/60"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold text-gray-900">
                          {report.name ||
                            report.templateTitle ||
                            t("customers.activity.reportFallback")}
                        </span>
                        <span className="text-xs font-bold text-gray-600">
                          📄 {t("customers.activity.viewReport")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600">
                        {t("customers.activity.reportFor", {
                          order: report.workOrder.title,
                        })}
                        {" • "}
                        {formatDateTimeLocalized(report.completedAt, locale)}
                        {report.technicianName
                          ? ` • ✍️ ${report.technicianName}`
                          : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
        <h2 className="font-black text-gray-900 mb-3 border-b pb-2">
          📋 {t("customers.activity.title")}
        </h2>
        <AuditLogTable logs={auditLogs} />
      </div>

      <CommentSection
        entityType="customer"
        entityId={customerId}
        existingComments={comments.map((c) => ({
          id: c.id,
          content: c.content,
          authorName: c.authorName,
          createdAt: c.createdAt.toISOString(),
        }))}
        currentUserName={currentUserName}
        canWrite={canManageCustomers}
      />
    </div>
  );
}
