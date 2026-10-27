import type { SearchGroup, SearchItem } from "@/lib/search";
import {
  parseSearchFilters,
  serializeSearchFilters,
  type SearchFilters,
} from "@/lib/search-filters";

/**
 * URL-hjelpere for søkeresultatsiden.
 *
 * Alt som bygger en lenke til /sok går gjennom `buildSearchHref`, slik at q,
 * side og alle filtre bevares i paginering, «fjern filtre» og lagrede søk.
 */

export const SEARCH_PAGE_SIZE = 20;
const MAX_PAGE = 10_000;
const MAX_QUERY_LENGTH = 100;

type ParamInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

export type SearchPageParams = {
  query: string;
  page: number;
  filters: SearchFilters;
};

function readFirst(params: ParamInput, key: string): string | undefined {
  if (params instanceof URLSearchParams) {
    return params.get(key) ?? undefined;
  }
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Leser en 1-basert sidenummer fra URL-en. Ugyldige verdier blir side 1. */
export function parsePageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_PAGE);
}

/** Leser q, side og filtre fra searchParams på samme måte som backend. */
export function parseSearchPageParams(params: ParamInput): SearchPageParams {
  const query = String(readFirst(params, "q") ?? "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  return {
    query,
    page: parsePageNumber(readFirst(params, "page")),
    filters: parseSearchFilters(params),
  };
}

export type BuildSearchHrefInput = {
  q: string;
  page?: number;
  filters?: SearchFilters | null;
  /** Ekstra parametre, f.eks. status etter lagring eller sletting. */
  extra?: Record<string, string | undefined>;
};

/**
 * Bygger en /sok-lenke. `page=1` utelates for korte og stabile URL-er.
 */
export function buildSearchHref({
  q,
  page = 1,
  filters,
  extra,
}: BuildSearchHrefInput): string {
  const params = new URLSearchParams();
  const query = String(q ?? "").trim();

  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(Math.min(page, MAX_PAGE)));

  const filterParams = new URLSearchParams(serializeSearchFilters(filters));
  filterParams.forEach((value, key) => params.set(key, value));

  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined && value !== "") params.set(key, value);
  }

  const queryString = params.toString();
  return queryString ? `/sok?${queryString}` : "/sok";
}

export type BestHit = SearchItem & {
  kind: string;
  label: string;
  icon: string;
};

/** Topp treff på tvers av gruppene, sortert på relevansscore. */
export function bestHits(
  groups: Pick<SearchGroup, "kind" | "label" | "icon" | "items">[],
  limit = 5,
): BestHit[] {
  return groups
    .flatMap((group) =>
      group.items.map((item) => ({
        ...item,
        kind: group.kind,
        label: group.label,
        icon: group.icon,
      })),
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, Math.max(0, limit));
}

export type PaginationInfo = {
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

/**
 * Paginering per gruppe. Backend paginerer hver gruppe med samme sidenummer,
 * så antall sider styres av gruppen med flest treff.
 */
export function paginationInfo(
  groups: Pick<SearchGroup, "total">[],
  page: number,
  pageSize = SEARCH_PAGE_SIZE,
): PaginationInfo {
  const maxTotal = groups.reduce((max, group) => Math.max(max, group.total), 0);
  const totalPages = Math.max(1, Math.ceil(maxTotal / pageSize));

  return {
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

/** «Viser 1–20 av 42»-intervallet for én gruppe på gjeldende side. */
export function groupRange(
  group: Pick<SearchGroup, "items">,
  page: number,
  pageSize = SEARCH_PAGE_SIZE,
): { from: number; to: number } | null {
  if (group.items.length === 0) return null;
  const from = (Math.max(1, page) - 1) * pageSize + 1;
  return { from, to: from + group.items.length - 1 };
}
