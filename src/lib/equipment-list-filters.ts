/**
 * Felles filterlogikk for utstyrslisten. Holder kundefilteret med gjennom
 * søk, paginering og hierarki, slik at `/enheter?kunde=` ikke forsvinner når
 * brukeren bytter visning.
 */
export type EquipmentFilterState = {
  query: string;
  status: string;
  categoryId: string;
  customerId: string;
  hierarchy: boolean;
};

export type EquipmentFilterItem = {
  status: string;
  categoryId: string | null;
  customerId: string;
  model: string;
  serialNumber: string | null;
  location: string | null;
  customer: { name: string };
  category: { name: string } | null;
};

export function buildEquipmentListHref(
  filters: EquipmentFilterState,
  nextPage = 1,
): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.status) params.set("status", filters.status);
  if (filters.categoryId) params.set("kategori", filters.categoryId);
  if (filters.customerId) params.set("kunde", filters.customerId);
  if (filters.hierarchy) params.set("hierarki", "1");
  if (nextPage > 1) params.set("side", String(nextPage));
  const suffix = params.toString();
  return `/enheter${suffix ? `?${suffix}` : ""}`;
}

export function matchesEquipmentFilters(
  item: EquipmentFilterItem,
  filters: EquipmentFilterState,
): boolean {
  if (
    filters.status &&
    filters.status !== "ALL" &&
    item.status !== filters.status
  ) {
    return false;
  }
  if (filters.categoryId && item.categoryId !== filters.categoryId) {
    return false;
  }
  if (filters.customerId && item.customerId !== filters.customerId) {
    return false;
  }
  if (!filters.query) return true;
  const needle = filters.query.toLocaleLowerCase("nb");
  return [
    item.model,
    item.serialNumber,
    item.location,
    item.customer.name,
    item.category?.name,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase("nb").includes(needle));
}
