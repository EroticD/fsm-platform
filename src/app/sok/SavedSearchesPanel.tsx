import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SavedSearch } from "@/server/saved-searches";
import type { SearchFilters } from "@/lib/search-filters";
import { deleteSearchAction, saveSearchAction } from "./actions";
import { buildSearchHref } from "./search-params";
import FilterHiddenInputs from "./FilterHiddenInputs";

/**
 * Personlige lagrede søk med gjenoppretting, sletting og «lagre dette søket».
 *
 * Sletting er en liten to-trinns bekreftelse i et `<details>`-element, slik at
 * den også virker uten JavaScript. Tjenesten kontrollerer eierskap på nytt.
 */
export default async function SavedSearchesPanel({
  searches,
  query,
  filters,
  page,
  idPrefix = "saved-searches",
}: {
  searches: SavedSearch[];
  query: string;
  filters: SearchFilters;
  page: number;
  idPrefix?: string;
}) {
  const t = await getTranslations("common");
  const titleId = `${idPrefix}-title`;
  const nameId = `${idPrefix}-name`;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <h2 id={titleId} className="text-base font-black text-gray-900">
        {t("components.search.saved.title")}
      </h2>

      {searches.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          {t("components.search.saved.empty")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {searches.map((search) => (
            <li key={search.id} className="relative max-w-full">
              <div className="flex max-w-full items-center gap-1 rounded-full border border-gray-200 bg-gray-50 pl-3 pr-1 py-1">
                <Link
                  href={buildSearchHref({
                    q: search.query,
                    filters: search.filters,
                  })}
                  aria-label={t("components.search.saved.openAria", {
                    name: search.name,
                  })}
                  className="min-w-0 truncate text-sm font-medium text-gray-700 hover:text-blue-700 hover:underline"
                >
                  {search.name}
                </Link>
                <details className="shrink-0">
                  <summary
                    aria-label={t("components.search.saved.deleteAria", {
                      name: search.name,
                    })}
                    className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600 [&::-webkit-details-marker]:hidden"
                  >
                    ×
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                    <p className="text-xs font-bold text-gray-700">
                      {t("components.search.saved.confirmDelete")}
                    </p>
                    <form action={deleteSearchAction} className="mt-2">
                      <input type="hidden" name="id" value={search.id} />
                      <input type="hidden" name="q" value={query} />
                      <input type="hidden" name="page" value={page} />
                      <FilterHiddenInputs filters={filters} />
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700"
                      >
                        {t("components.search.saved.delete")}
                      </button>
                    </form>
                  </div>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-gray-100 pt-4">
        <h3 className="text-sm font-bold text-gray-800">
          {t("components.search.saved.saveTitle")}
        </h3>
        {query.trim() ? (
          <form action={saveSearchAction} className="mt-2 space-y-2">
            <input type="hidden" name="q" value={query} />
            <input type="hidden" name="page" value={page} />
            <FilterHiddenInputs filters={filters} />
            <label htmlFor={nameId} className="sr-only">
              {t("components.search.saved.name")}
            </label>
            <input
              id={nameId}
              type="text"
              name="name"
              required
              maxLength={80}
              placeholder={t("components.search.saved.namePlaceholder")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            <button
              type="submit"
              className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
            >
              {t("components.search.saved.save")}
            </button>
          </form>
        ) : (
          <p className="mt-1 text-sm text-gray-500">
            {t("components.search.saved.needQuery")}
          </p>
        )}
      </div>
    </section>
  );
}
