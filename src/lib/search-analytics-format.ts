/**
 * Rene hjelpere for søkeanalysen.
 *
 * Tallene kommer ferdig beregnet fra tjenestelaget. Her ligger bare parsing av
 * tidsrom og formatering, slik at siden kan testes uten database eller React.
 */

export const SEARCH_ANALYTICS_DAY_OPTIONS = [7, 30, 90] as const;
export type SearchAnalyticsDays = (typeof SEARCH_ANALYTICS_DAY_OPTIONS)[number];

export const DEFAULT_SEARCH_ANALYTICS_DAYS: SearchAnalyticsDays = 30;

/** Bare de tre faste valgene i grensesnittet godtas; alt annet faller tilbake. */
export function parseSearchAnalyticsDays(
  value: string | string[] | undefined,
): SearchAnalyticsDays {
  const raw = Array.isArray(value) ? value[0] : value;
  const days = Number(raw);
  return (
    SEARCH_ANALYTICS_DAY_OPTIONS.find((option) => option === days) ??
    DEFAULT_SEARCH_ANALYTICS_DAYS
  );
}

/** Nulltreffrate som et tall mellom 0 og 1. */
export function zeroResultRate(zeroResultCount: number, totalSearches: number): number {
  if (
    !Number.isFinite(zeroResultCount) ||
    !Number.isFinite(totalSearches) ||
    totalSearches <= 0
  ) {
    return 0;
  }
  return Math.min(1, Math.max(0, zeroResultCount / totalSearches));
}

/** Prosent med locale-tilpasset desimaltegn, f.eks. «23,5 %» eller «23.5%». */
export function formatSearchRate(rate: number, locale: string): string {
  const safeRate = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(safeRate);
}

/** Heltall med locale-tilpasset gruppering. */
export function formatSearchCount(value: number, locale: string): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return new Intl.NumberFormat(locale).format(safeValue);
}

/** Gjennomsnittlig svartid i millisekunder. */
export function formatSearchLatency(latencyMs: number, locale: string): string {
  const safeValue = Number.isFinite(latencyMs)
    ? Math.max(0, Math.round(latencyMs))
    : 0;
  return `${formatSearchCount(safeValue, locale)} ms`;
}

/**
 * Bredde på en dagssøyle i prosent av den travleste dagen. En dag med treff
 * får alltid en synlig liten stolpe, også når den er langt under toppen.
 */
export function barWidthPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0) {
    return 0;
  }
  return Math.max(2, Math.min(100, Math.round((value / max) * 100)));
}
