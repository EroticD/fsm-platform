/**
 * Visningsnavnet for en rapport.
 *
 * Rapporten har et eget `name` (frosset fra malens `reportName`). Eldre
 * rapporter mangler feltet, og da faller vi tilbake til malens tittel.
 */
export function reportDisplayName(
  report: {
    name?: string | null;
    templateTitle?: string | null;
    template?: { title?: string | null } | null;
  },
  fallback: string,
): string {
  return report.name || report.templateTitle || report.template?.title || fallback;
}

/**
 * Enhetstall for lister og kort.
 *
 * Rapporter uten enheter lagrer én anonym rad for svarfeltene. Den raden skal
 * aldri telles som «1 enhet» – `requiresUnits: false` betyr at enhetsstatistikken
 * ikke er relevant.
 */
export function reportUnitSummary(report: {
  requiresUnits?: boolean | null;
  units?: ReadonlyArray<{ status?: string | null }> | null;
}): { usesUnits: boolean; unitCount: number; deviationCount: number } {
  const usesUnits = report.requiresUnits !== false;
  const units = report.units ?? [];
  if (!usesUnits) {
    return { usesUnits: false, unitCount: 0, deviationCount: 0 };
  }
  return {
    usesUnits: true,
    unitCount: units.length,
    deviationCount: units.filter((unit) => unit.status === "AVVIK").length,
  };
}

/** Kvitteringsopplysningene kundeportalen og kontorkortet viser. */
export function reportAcknowledgement(report: {
  customerAcknowledgedAt?: Date | string | null;
  customerAcknowledgedBy?: string | null;
  customerAcknowledgedComment?: string | null;
}): {
  acknowledged: boolean;
  at: Date | string | null;
  by: string | null;
  comment: string | null;
} {
  return {
    acknowledged: Boolean(report.customerAcknowledgedAt),
    at: report.customerAcknowledgedAt ?? null,
    by: report.customerAcknowledgedBy ?? null,
    comment: report.customerAcknowledgedComment ?? null,
  };
}
