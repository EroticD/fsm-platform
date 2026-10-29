"use client";

import { useTranslations } from "next-intl";

/**
 * Statuspillene holder seg til de semantiske fargene: grønn for fullført,
 * signal-lime for pågående, gul/oransje for de to ventetilstandene og
 * risiko-oransje for kansellert. PENDING og WAITING har fortsatt hver sin
 * tekst, slik at de ikke blandes selv om begge venter.
 */
const STATUS_STYLES: Record<string, string> = {
  COMPLETED:
    "border-[#b9cdb4] bg-[#eaf3e4] text-[#24502f] [--status-dot:#3f7a4b]",
  IN_PROGRESS:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] [--status-dot:var(--ink,#101310)]",
  CANCELLED:
    "border-[#e7b7a4] bg-[#fae8e0] text-[#a92a12] [--status-dot:var(--risk,#f04427)]",
  OPEN:
    "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)] [--status-dot:#7a7468]",
  PENDING:
    "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05] [--status-dot:#a47a0a]",
  PLANNED:
    "border-[#c9c0ac] bg-[#efe9db] text-[#3d372b] [--status-dot:#6b6353]",
  WAITING:
    "border-[#e6b896] bg-[#fbe7d8] text-[#8a3a0e] [--status-dot:#c05621]",
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
    STATUS_STYLES[status] ??
    "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)] [--status-dot:#7a7468]";

  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold leading-4 tracking-wide ${style}`}
      aria-label={ariaLabel}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-dot)]"
      />
      {statusLabels[status] ?? status}
    </span>
  );
}
