import { getTranslations } from "next-intl/server";
import type { SearchFilters } from "@/lib/search-filters";
import { SEARCH_GROUP_KINDS } from "@/lib/search-filters";
import { buildSearchHref } from "./search-params";
import {
  GROUP_KEYS,
  SEARCH_HMS_TYPE_OPTIONS,
  SEARCH_STATUS_OPTIONS,
} from "./labels";

type Option = { id: string; name: string };

/**
 * Tilgjengelig GET-skjema for søkefiltre.
 *
 * Skjemaet er en vanlig GET-forespørsel, så resultatet kan bokmerkes, deles og
 * brukes uten JavaScript. Alle verdier valideres på nytt i `parseSearchFilters`
 * og backend legger alltid på brukerens tilgangsScope.
 */
export default async function SearchFiltersForm({
  query,
  filters,
  customers,
  technicians,
  showCustomers,
  showTechnicians,
}: {
  query: string;
  filters: SearchFilters;
  customers: Option[];
  technicians: Option[];
  showCustomers: boolean;
  showTechnicians: boolean;
}) {
  const t = await getTranslations("common");
  const tl = t as unknown as (key: string) => string;
  const selectedTypes = new Set(filters.types ?? []);

  return (
    <form
      action="/sok"
      method="get"
      aria-labelledby="search-filters-title"
      className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <input type="hidden" name="q" value={query} />

      <div className="flex items-center justify-between gap-3">
        <h2 id="search-filters-title" className="text-base font-black text-gray-900">
          {t("components.search.filters.title")}
        </h2>
        <a
          href={buildSearchHref({ q: query, filters: {} })}
          className="text-xs font-bold text-blue-700 hover:underline"
        >
          {t("components.search.filters.clear")}
        </a>
      </div>

      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-wide text-gray-500">
          {t("components.search.filters.types")}
        </legend>
        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
          {SEARCH_GROUP_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                name="types"
                value={kind}
                defaultChecked={selectedTypes.has(kind)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
              />
              <span>{tl(GROUP_KEYS[kind] ?? kind)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="search-filter-status"
          className="text-xs font-bold uppercase tracking-wide text-gray-500"
        >
          {t("components.search.filters.status")}
        </label>
        <select
          id="search-filter-status"
          name="status"
          defaultValue={filters.status ?? ""}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        >
          <option value="">{t("components.search.filters.allStatuses")}</option>
          {SEARCH_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {tl(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {showCustomers && (
        <div>
          <label
            htmlFor="search-filter-customer"
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.customer")}
          </label>
          <select
            id="search-filter-customer"
            name="customer"
            defaultValue={filters.customer ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            <option value="">{t("components.search.filters.allCustomers")}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showTechnicians && technicians.length > 0 && (
        <div>
          <label
            htmlFor="search-filter-technician"
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.technician")}
          </label>
          <select
            id="search-filter-technician"
            name="technician"
            defaultValue={filters.technician ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            <option value="">{t("components.search.filters.allTechnicians")}</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="search-filter-date-from"
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.dateFrom")}
          </label>
          <input
            id="search-filter-date-from"
            type="date"
            name="dateFrom"
            defaultValue={filters.dateFrom ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
        <div>
          <label
            htmlFor="search-filter-date-to"
            className="text-xs font-bold uppercase tracking-wide text-gray-500"
          >
            {t("components.search.filters.dateTo")}
          </label>
          <input
            id="search-filter-date-to"
            type="date"
            name="dateTo"
            defaultValue={filters.dateTo ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="search-filter-tag"
          className="text-xs font-bold uppercase tracking-wide text-gray-500"
        >
          {t("components.search.filters.tag")}
        </label>
        <input
          id="search-filter-tag"
          type="text"
          name="tag"
          maxLength={64}
          defaultValue={filters.tag ?? ""}
          placeholder={t("components.search.filters.tagPlaceholder")}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
      </div>

      <div>
        <label
          htmlFor="search-filter-hms-type"
          className="text-xs font-bold uppercase tracking-wide text-gray-500"
        >
          {t("components.search.filters.hmsType")}
        </label>
        <select
          id="search-filter-hms-type"
          name="hmsType"
          defaultValue={filters.hmsType ?? ""}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        >
          <option value="">{t("components.search.filters.allHmsTypes")}</option>
          {SEARCH_HMS_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {tl(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
      >
        {t("components.search.filters.apply")}
      </button>
    </form>
  );
}
