import Link from "next/link";
import Icon from "@/components/icons";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateLocalized } from "@/lib/dates";
import { markdownToPlainText } from "@/lib/markdown";
import type { CustomerDetailData } from "@/server/customers";
import StatusBadge from "@/components/StatusBadge";

type OrdersTabProps = {
  customerId: string;
  canCreateWorkOrders: boolean;
  totalOrders: number;
  visibleWorkOrders: CustomerDetailData["visibleWorkOrders"];
  orderTotalPages: number;
  orderPage: number;
  pageSize: number;
};

export default async function CustomerOrdersTab({
  customerId,
  canCreateWorkOrders,
  totalOrders,
  visibleWorkOrders,
  orderTotalPages,
  orderPage,
  pageSize,
}: OrdersTabProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();

  return (
    <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black text-gray-900">
            <Icon name="folder" className="h-5 w-5 shrink-0" />
            {t("customers.orders.title")}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{t("customers.orders.description")}</p>
        </div>
        {canCreateWorkOrders && (
          <Link
            href={`/oppdrag/ny?customerId=${customerId}`}
            className="inline-flex items-center gap-1.5 bg-blue-700 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-sm font-black hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
          >
            <Icon name="plus" className="h-4 w-4 shrink-0" />
            {t("customers.orders.newOrder")}
          </Link>
        )}
      </div>

      {totalOrders === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-200 p-6 rounded-2xl text-center">
          <p className="text-gray-600 font-bold mb-1">{t("customers.orders.emptyTitle")}</p>
          <p className="text-xs text-gray-500">{t("customers.orders.emptyDescription")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleWorkOrders.map((wo) => (
            <Link
              key={wo.id}
              href={`/oppdrag/${wo.id}`}
              className="block bg-gray-50 hover:bg-blue-50/50 border-2 border-gray-200 hover:border-blue-300 p-3 sm:p-4 rounded-2xl transition shadow-sm"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                <div>
                  <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                  <p className="text-xs text-gray-500 font-medium mt-0.5">
                    {t("customers.orders.scheduled", {
                      date: formatDateLocalized(
                        wo.scheduledFor,
                        locale,
                        undefined,
                        t("customers.overview.noDate"),
                      ),
                    })}
                    {wo._count.reports > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden>•</span>
                        <Icon name="clipboard" className="h-3.5 w-3.5 shrink-0" />
                        {t("customers.orders.reportsDone", { count: wo._count.reports })}
                      </span>
                    ) : null}
                  </p>
                </div>
                <StatusBadge status={wo.status} />
              </div>

              {wo.description && (
                <p className="text-sm text-gray-700 bg-white p-3 rounded-xl border border-gray-200 line-clamp-2 font-medium">
                  {markdownToPlainText(wo.description)}
                </p>
              )}

              <div className="mt-2 flex justify-between items-center text-xs pt-2 border-t border-gray-200 text-gray-600">
                <span>
                  <strong>{t("customers.orders.technicians")}</strong>{" "}
                  {wo.technicians.length > 0
                    ? wo.technicians.map((technician) => technician.name).join(", ")
                    : t("customers.orders.unassigned")}
                </span>
                <span className="inline-flex items-center gap-1 font-black text-blue-600 hover:underline">
                  {t("customers.orders.viewDetails")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {orderTotalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-gray-100 text-xs font-bold">
          {orderPage > 1 && (
            <Link
              href={`?tab=oppdrag&side=${orderPage - 1}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-180" />
              {t("customers.orders.previous")}
            </Link>
          )}
          <span className="text-gray-500">
            {t("customers.orders.showing", {
              from: (orderPage - 1) * pageSize + 1,
              to: Math.min(orderPage * pageSize, totalOrders),
              total: totalOrders,
            })}
          </span>
          {orderPage < orderTotalPages && (
            <Link
              href={`?tab=oppdrag&side=${orderPage + 1}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
            >
              {t("customers.orders.next")}
              <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
