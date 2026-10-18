"use client";

import { useTranslations } from "next-intl";

export default function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("common");
  const statusLabels: Record<string, string> = {
    COMPLETED: t("statusCompleted"),
    IN_PROGRESS: t("statusInProgress"),
    CANCELLED: t("statusCancelled"),
    OPEN: t("statusOpen"),
    PENDING: t("statusPending"),
    PLANNED: t("statusPlanned"),
    WAITING: t("statusWaiting"),
  };
  const ariaLabel = statusLabels[status] || status;

  switch (status) {
    case 'COMPLETED': return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200 shadow-sm" aria-label={ariaLabel}>{t("statusCompleted")}</span>;
    case 'IN_PROGRESS': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm">{t("statusInProgress")}</span>;
    case 'CANCELLED': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200 shadow-sm">{t("statusCancelled")}</span>;
    case 'OPEN': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200 shadow-sm">{t("statusOpen")}</span>;
    case 'PENDING': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">{t("statusPending")}</span>;
    case 'PLANNED': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">{t("statusPlanned")}</span>;
    case 'WAITING': return <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold border border-orange-200 shadow-sm">{t("statusWaiting")}</span>;
    default: return <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-bold border border-gray-200 shadow-sm">{status}</span>;
  }
}
