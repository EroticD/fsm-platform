"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * Statuspill etter DESIGN.md: 6 px prikk + tekst, 9999 px radius, 12/16 700.
 * Fargen er alltid arbeidsflytstatus, aldri prioritet:
 *
 * - Åpen/planlagt: nøytral `--surface`
 * - Pågår: signal
 * - Venter: amber
 * - Fullført: dempet grønn
 * - Kansellert: risiko, ikke alarm
 *
 * API-et er fortsatt `status: string`. `label` er valgfri og lar faktura- og
 * tilbudslistene beholde sine egne, allerede oversatte statusnavn.
 */
const NEUTRAL =
  "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)]";

const STATUS_STYLES: Record<string, string> = {
  COMPLETED:
    "border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] text-[var(--success-text,#283509)]",
  IN_PROGRESS:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  CANCELLED:
    "border-[color-mix(in_srgb,var(--risk-text,#b42318)_22%,transparent)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]",
  OPEN: NEUTRAL,
  PENDING: NEUTRAL,
  PLANNED: NEUTRAL,
  WAITING:
    "border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] text-[var(--warning-text,#7a4f0c)]",

  // Faktura
  DRAFT: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]",
  SENT: "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  PARTIALLY_PAID:
    "border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] text-[var(--warning-text,#7a4f0c)]",
  PAID: "border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] text-[var(--success-text,#283509)]",
  OVERDUE:
    "border-[color-mix(in_srgb,var(--risk,#f04427)_28%,transparent)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]",
  CREDITED:
    "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]",

  // Tilbud
  ACCEPTED:
    "border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] text-[var(--success-text,#283509)]",
  REJECTED:
    "border-[color-mix(in_srgb,var(--risk-text,#b42318)_22%,transparent)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]",
  EXPIRED:
    "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]",
};

export default function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: ReactNode;
}) {
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
  const visible = label ?? statusLabels[status] ?? status;
  const ariaLabel =
    typeof label === "string" ? label : statusLabels[status] || status;
  const style = STATUS_STYLES[status] ?? NEUTRAL;

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold leading-4 ${style}`}
      aria-label={ariaLabel}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
      />
      {visible}
    </span>
  );
}
