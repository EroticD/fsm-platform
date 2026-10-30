import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTimeLocalized } from "@/lib/dates";
import { describeAuditAction, type AuditTranslator } from "@/lib/audit-actions";
import type { CustomerDetailData } from "@/server/customers";
import Icon, { type IconName } from "@/components/icons";
import { CUSTOMER_INSET, CUSTOMER_MUTED } from "./customerStyles";

type ActivityItem = CustomerDetailData["activityFeed"][number];

const KIND_ICON: Record<ActivityItem["kind"], IconName> = {
  customer: "building",
  workOrder: "folder",
  report: "clipboard",
  contact: "user",
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
    return <p className={`text-xs italic ${CUSTOMER_MUTED}`}>{emptyLabel}</p>;
  }

  return (
    <ol className="space-y-1.5">
      {items.map((item) => {
        const body = (
          <>
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)]"
              aria-hidden="true"
            >
              <Icon
                name={KIND_ICON[item.kind]}
                className="h-3.5 w-3.5"
                strokeWidth={2}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-bold text-[var(--ink,#101310)]">
                  {describeAuditAction(item.action, translate) ?? item.action}
                </span>
                {showKind && (
                  <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                    {t(KIND_LABEL_KEY[item.kind])}
                  </span>
                )}
              </span>
              <span className={`mt-0.5 block text-xs ${CUSTOMER_MUTED}`}>
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
                className={`${CUSTOMER_INSET} flex items-start gap-2.5 p-2 transition hover:border-[var(--ink,#101310)] hover:bg-[var(--surface,#fffdf8)]`}
              >
                {body}
              </Link>
            ) : (
              <div className={`${CUSTOMER_INSET} flex items-start gap-2.5 p-2`}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
