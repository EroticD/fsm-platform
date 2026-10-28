import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import { getTranslations } from "next-intl/server";
import type { CustomerDetailData } from "@/server/customers";
import CustomerActivityList from "./CustomerActivityList";

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
    <div className="space-y-6">
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
        <h2 className="font-black text-gray-900 mb-3 border-b pb-2">
          📋 {t("customers.activity.feedTitle")}
        </h2>
        <CustomerActivityList
          items={activity}
          emptyLabel={t("customers.activity.noActivity")}
        />
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

      <details className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
        <summary className="cursor-pointer font-black text-gray-900">
          🧾 {t("customers.activity.auditOnlyTitle")}
        </summary>
        <p className="mt-2 mb-3 text-xs text-gray-500">
          {t("customers.activity.auditOnlyHint")}
        </p>
        <AuditLogTable logs={auditLogs} />
      </details>
    </div>
  );
}
