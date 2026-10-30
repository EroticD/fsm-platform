import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import type { SavedSearch } from "@/server/saved-searches";
import type { SearchFilters } from "@/lib/search-filters";
import { deleteSearchAction, saveSearchAction } from "./actions";
import { buildSearchHref } from "./search-params";
import FilterHiddenInputs from "./FilterHiddenInputs";

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

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
      className="office-card p-4 sm:p-5"
    >
      <h2
        id={titleId}
        className="flex items-center gap-2 text-sm font-extrabold text-[var(--ink,#101310)]"
      >
        <Icon name="flag" className="h-4 w-4 shrink-0" />
        {t("components.search.saved.title")}
      </h2>

      {searches.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
          {t("components.search.saved.empty")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {searches.map((search) => (
            <li key={search.id} className="relative max-w-full">
              <div className="flex max-w-full items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] py-1 pl-3 pr-1">
                <Link
                  href={buildSearchHref({
                    q: search.query,
                    filters: search.filters,
                  })}
                  aria-label={t("components.search.saved.openAria", {
                    name: search.name,
                  })}
                  className="min-w-0 truncate text-xs font-semibold text-[var(--ink,#101310)] underline-offset-2 hover:underline"
                >
                  {search.name}
                </Link>
                <details className="shrink-0">
                  <summary
                    aria-label={t("components.search.saved.deleteAria", {
                      name: search.name,
                    })}
                    className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full text-[var(--muted,#62685f)] transition hover:bg-[#fae8e0] hover:text-[var(--risk-text,#b42318)] [&::-webkit-details-marker]:hidden"
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 shadow-lg">
                    <p className="text-xs font-bold text-[var(--ink,#101310)]">
                      {t("components.search.saved.confirmDelete")}
                    </p>
                    <form action={deleteSearchAction} className="mt-2">
                      <input type="hidden" name="id" value={search.id} />
                      <input type="hidden" name="q" value={query} />
                      <input type="hidden" name="page" value={page} />
                      <FilterHiddenInputs filters={filters} />
                      <button
                        type="submit"
                        className="w-full rounded-lg border border-[var(--risk,#f04427)] bg-[var(--risk,#f04427)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[#d33218]"
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

      <div className="mt-4 border-t border-[var(--line,#dedcd1)] pt-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
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
              className={FIELD}
            />
            <button type="submit" className={`${INK_BUTTON} w-full`}>
              {t("components.search.saved.save")}
            </button>
          </form>
        ) : (
          <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
            {t("components.search.saved.needQuery")}
          </p>
        )}
      </div>
    </section>
  );
}
