/** Standard og øvre grense for sider i det offentlige API-et. */
export const API_DEFAULT_PAGE_SIZE = 50;
export const API_MAX_PAGE_SIZE = 100;

export type ApiPagination = {
  page: number;
  limit: number;
  skip: number;
};

export type ApiPaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function parseInteger(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function safePage(value: string | null): number {
  const parsed = parseInteger(value);
  return parsed !== null && parsed >= 1 ? parsed : 1;
}

function safeLimit(value: string | null): number {
  const parsed = parseInteger(value);
  if (parsed === null) return API_DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(parsed, 1), API_MAX_PAGE_SIZE);
}

/**
 * Leser `?page=` og `?limit=` fra en URL. Ugyldige verdier faller tilbake til
 * side 1 og standardstørrelsen, og `limit` kappes til maks 100.
 */
export function parseApiPagination(url: URL | string): ApiPagination {
  let parsedUrl: URL;
  try {
    parsedUrl = url instanceof URL ? url : new URL(url, "http://localhost");
  } catch {
    return {
      page: 1,
      limit: API_DEFAULT_PAGE_SIZE,
      skip: 0,
    };
  }

  const page = safePage(parsedUrl.searchParams.get("page"));
  const limit = safeLimit(parsedUrl.searchParams.get("limit"));
  return { page, limit, skip: (page - 1) * limit };
}

/** Metadata som følger en paginert `data`-liste. */
export function paginationMeta(
  total: number,
  page: number,
  limit: number,
): ApiPaginationMeta {
  const safeTotal = Number.isFinite(total)
    ? Math.max(0, Math.trunc(total))
    : 0;
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), API_MAX_PAGE_SIZE)
    : API_DEFAULT_PAGE_SIZE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;

  return {
    total: safeTotal,
    page: safePage,
    limit: safeLimit,
    totalPages: safeTotal === 0 ? 0 : Math.ceil(safeTotal / safeLimit),
  };
}
