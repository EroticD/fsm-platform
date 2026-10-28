import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTimeLocalized } from "@/lib/dates";
import { describeAuditAction, type AuditTranslator } from "@/lib/audit-actions";
import type { CustomerDetailData } from "@/server/customers";

type ActivityItem = CustomerDetailData["activityFeed"][number];

const KIND_ICON: Record<ActivityItem["kind"], string> = {
  customer: "🏢",
  workOrder: "📂",
  report: "📋",
  contact: "👤",
};

const KIND_LABEL_KEY: Record<ActivityItem["kind"], string> = {
  customer: "customers.activity.types.customer",
  workOrder: "customers.activity.types.workOrder",
  report: "customers.activity.types.report",
  contact: "customers.activity.types.contact",
};

/**
 * Kronologisk aktivitetsstrøm for kunden. Hver rad lenker til entiteten den
 * gjelder; revisjonsrader uten egen side vises som ren tekst.
 */
export default async function CustomerActivityList({
  items,
  emptyLabel,
  showKind = true,
}: {
  items: ActivityItem[];
  emptyLabel: string;
  showKind?: boolean;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const translate = t as unknown as AuditTranslator;

  if (items.length === 0) {
    return <p className="text-xs text-gray-500 italic">{emptyLabel}</p>;
  }

  return (
    <ol className="space-y-2">
      {items.map((item) => {
        const body = (
          <>
            <span className="mt-0.5 text-base leading-none" aria-hidden="true">
              {KIND_ICON[item.kind]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-gray-800">
                  {describeAuditAction(item.action, translate) ?? item.action}
                </span>
                {showKind && (
                  <span className="rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                    {t(KIND_LABEL_KEY[item.kind])}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-gray-500">
                {item.userName || t("customers.overview.unknownUser")} •{" "}
                {formatDateTimeLocalized(item.createdAt, locale)}
              </span>
            </span>
          </>
        );

        return (
          <li key={item.id}>
            {item.href ? (
              <Link
                href={item.href}
                className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2.5 transition hover:border-blue-300 hover:bg-blue-50/60"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2.5">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
