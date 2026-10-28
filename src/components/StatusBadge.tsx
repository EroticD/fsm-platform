"use client";

import { useTranslations } from "next-intl";

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: "bg-green-100 text-green-950 border-green-300",
  IN_PROGRESS: "bg-blue-100 text-blue-950 border-blue-300",
  CANCELLED: "bg-red-100 text-red-950 border-red-300",
  OPEN: "bg-purple-100 text-purple-950 border-purple-300",
  PENDING: "bg-amber-100 text-amber-950 border-amber-300",
  PLANNED: "bg-yellow-100 text-yellow-950 border-yellow-300",
  WAITING: "bg-orange-100 text-orange-950 border-orange-300",
};

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
  const style =
    STATUS_STYLES[status] ?? "bg-gray-100 text-gray-950 border-gray-300";

  return (
    <span
      className={`${style} px-3 py-1 rounded-full text-xs font-bold border shadow-sm`}
      aria-label={ariaLabel}
    >
      {statusLabels[status] ?? status}
    </span>
  );
}
