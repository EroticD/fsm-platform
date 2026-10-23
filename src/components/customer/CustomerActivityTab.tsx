import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import type { CustomerDetailData } from "@/server/customers";

type ActivityTabProps = {
  customerId: string;
  auditLogs: CustomerDetailData["customerAuditLogs"];
  comments: CustomerDetailData["customerComments"];
  currentUserName: string | null;
  canManageCustomers: boolean;
};

export default function CustomerActivityTab({
  customerId,
  auditLogs,
  comments,
  currentUserName,
  canManageCustomers,
}: ActivityTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
        <h2 className="font-black text-gray-900 mb-3 border-b pb-2">📋 Aktivitetslogg</h2>
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
