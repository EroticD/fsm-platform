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
