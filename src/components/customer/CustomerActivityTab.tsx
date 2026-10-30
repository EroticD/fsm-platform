import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type { CustomerDetailData } from "@/server/customers";
import CustomerActivityList from "./CustomerActivityList";
import {
  CUSTOMER_CARD,
  CUSTOMER_MUTED,
  LEGACY_SURFACE,
} from "./customerStyles";

type ActivityTabProps = {
  customerId: string;
  activity: CustomerDetailData["activityFeed"];
  auditLogs: CustomerDetailData["customerAuditLogs"];
  comments: CustomerDetailData["customerComments"];
  currentUserName: string | null;
  canManageCustomers: boolean;
};

/**
 * Aktivitetsdelen under «Mer». Strømmen blander kundekort, oppdrag, rapporter
 * og kontakter. Den rene revisjonsloggen ligger som en sammenleggbar fallback
 * for hendelser som ikke har en egen side å lenke til.
 */
export default async function CustomerActivityTab({
  customerId,
  activity,
  auditLogs,
  comments,
  currentUserName,
  canManageCustomers,
}: ActivityTabProps) {
  const t = await getTranslations("common");

  return (
    <div className="space-y-4">
      <section className={`${CUSTOMER_CARD} space-y-3 p-4 sm:p-5`}>
        <div className="border-b border-[var(--line,#dedcd1)] pb-2">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
            />
            <Icon name="clipboard" className="h-4 w-4 shrink-0" />
            {t("customers.activity.feedTitle")}
          </h2>
        </div>
        <CustomerActivityList
          items={activity}
          emptyLabel={t("customers.activity.noActivity")}
        />
      </section>

      <section className={`${CUSTOMER_CARD} space-y-3 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
            />
            <Icon name="note" className="h-4 w-4 shrink-0" />
            {t("components.comment.titleCustomer")}
          </h2>
          <span
            className={`text-xs font-bold uppercase tracking-[0.08em] ${CUSTOMER_MUTED}`}
          >
            {t("components.comment.count", { count: comments.length })}
          </span>
        </div>
        <div
          className={`${LEGACY_SURFACE} [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div>div:first-child]:hidden [&_button[type=submit]]:bg-[var(--ink,#101310)] [&_button[type=submit]]:text-[var(--paper,#f2efe6)]`}
        >
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
      </section>

      <details className={`${CUSTOMER_CARD} p-4 sm:p-5`}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)] [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
          />
          <Icon name="note" className="h-4 w-4 shrink-0" />
          {t("customers.activity.auditOnlyTitle")}
        </summary>
        <p className={`mb-3 mt-1 text-xs leading-5 ${CUSTOMER_MUTED}`}>
          {t("customers.activity.auditOnlyHint")}
        </p>
        <div
          className={`${LEGACY_SURFACE} [&_.text-3xl]:hidden`}
        >
          <AuditLogTable logs={auditLogs} />
        </div>
      </details>
    </div>
  );
}
