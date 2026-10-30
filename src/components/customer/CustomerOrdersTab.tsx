import Link from "next/link";
import Icon from "@/components/icons";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateLocalized } from "@/lib/dates";
import { markdownToPlainText } from "@/lib/markdown";
import type { CustomerDetailData } from "@/server/customers";
import StatusBadge from "@/components/StatusBadge";
import {
  CUSTOMER_CARD,
  CUSTOMER_INSET,
  CUSTOMER_MUTED,
  CUSTOMER_SIGNAL_BUTTON,
} from "./customerStyles";

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
    <section className={`${CUSTOMER_CARD} space-y-4 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
            />
            <Icon name="folder" className="h-5 w-5 shrink-0" />
            {t("customers.orders.title")}
          </h2>
          <p className={`mt-0.5 text-xs ${CUSTOMER_MUTED}`}>
            {t("customers.orders.description")}
          </p>
        </div>
        {canCreateWorkOrders && (
          <Link
            href={`/oppdrag/ny?customerId=${customerId}`}
            className={CUSTOMER_SIGNAL_BUTTON}
          >
            <Icon name="plus" className="h-4 w-4 shrink-0" />
            {t("customers.orders.newOrder")}
          </Link>
        )}
      </div>

      {totalOrders === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-6 text-center">
          <p className="mb-1 text-sm font-bold text-[var(--ink,#101310)]">
            {t("customers.orders.emptyTitle")}
          </p>
          <p className={`text-xs ${CUSTOMER_MUTED}`}>
            {t("customers.orders.emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleWorkOrders.map((wo) => (
            <Link
              key={wo.id}
              href={`/oppdrag/${wo.id}`}
              className={`${CUSTOMER_INSET} block p-3 transition hover:border-[var(--ink,#101310)] hover:bg-[var(--surface,#fffdf8)]`}
            >
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-[var(--ink,#101310)]">
                    {wo.title}
                  </h3>
                  <p
                    className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${CUSTOMER_MUTED}`}
                  >
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
                        <Icon
                          name="clipboard"
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        {t("customers.orders.reportsDone", {
                          count: wo._count.reports,
                        })}
                      </span>
                    ) : null}
                  </p>
                </div>
                <StatusBadge status={wo.status} />
              </div>

              {wo.description && (
                <p className="mt-2 line-clamp-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2 text-xs text-[var(--ink,#101310)]">
                  {markdownToPlainText(wo.description)}
                </p>
              )}

              <div
                className={`mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line,#dedcd1)] pt-2 text-xs ${CUSTOMER_MUTED}`}
              >
                <span className="min-w-0">
                  <strong className="font-bold text-[var(--ink,#101310)]">
                    {t("customers.orders.technicians")}
                  </strong>{" "}
                  {wo.technicians.length > 0
                    ? wo.technicians
                        .map((technician) => technician.name)
                        .join(", ")
                    : t("customers.orders.unassigned")}
                </span>
                <span className="inline-flex items-center gap-1 font-bold text-[var(--ink,#101310)]">
                  {t("customers.orders.viewDetails")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {orderTotalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-[var(--line,#dedcd1)] pt-3 text-xs font-bold">
          {orderPage > 1 && (
            <Link
              href={`?tab=oppdrag&side=${orderPage - 1}`}
              className="inline-flex min-h-11 items-center gap-1 text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
            >
              <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-180" />
              {t("customers.orders.previous")}
            </Link>
          )}
          <span className={`tabular-nums ${CUSTOMER_MUTED}`}>
            {t("customers.orders.showing", {
              from: (orderPage - 1) * pageSize + 1,
              to: Math.min(orderPage * pageSize, totalOrders),
              total: totalOrders,
            })}
          </span>
          {orderPage < orderTotalPages && (
            <Link
              href={`?tab=oppdrag&side=${orderPage + 1}`}
              className="inline-flex min-h-11 items-center gap-1 text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
            >
              {t("customers.orders.next")}
              <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
