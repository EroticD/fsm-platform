/** Standard sidestørrelse for lister i appen. */
export const DEFAULT_PAGE_SIZE = 25;

/** Leser `?side=` trygt: minst 1, og aldri over totalPages når den er kjent. */
export function parsePage(value: string | number | null | undefined, totalPages?: number): number {
  const raw = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  if (totalPages && totalPages > 0) return Math.min(page, totalPages);
  return page;
}

/** Regner ut skip/take og antall sider for en paginert spørring. */
export function pageWindow(page: number, total: number, pageSize = DEFAULT_PAGE_SIZE) {
  const safeSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const current = Math.min(Math.max(1, Math.floor(page)), totalPages);
  return {
    page: current,
    pageSize: safeSize,
    totalPages,
    skip: (current - 1) * safeSize,
    take: safeSize,
  };
}
