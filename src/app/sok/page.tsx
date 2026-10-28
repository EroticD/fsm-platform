import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { hasPermission } from "@/lib/permissions";
import { staffWhere, type AccessUser } from "@/lib/access";
import { performSearch, type SearchItem, type SearchResults } from "@/lib/search";
import { hasActiveFilters } from "@/lib/search-filters";
import { listSavedSearches, type SavedSearch } from "@/server/saved-searches";
import PageHeader from "@/components/PageHeader";
import SectionCard from "@/components/SectionCard";
import HighlightedText from "@/components/search/HighlightedText";
import RecentSearches from "@/components/search/RecentSearches";
import SearchFiltersForm from "./SearchFiltersForm";
import SavedSearchesPanel from "./SavedSearchesPanel";
import FilterHiddenInputs from "./FilterHiddenInputs";
import { GROUP_KEYS } from "./labels";
import {
  bestHits,
  buildSearchHref,
  groupRange,
  paginationInfo,
  parseSearchPageParams,
  SEARCH_PAGE_SIZE,
} from "./search-params";

type SearchPageSearchParams = Record<string, string | string[] | undefined>;

const SAVED_MESSAGES: Record<
  string,
  { key: string; tone: "ok" | "error" }
> = {
  lagret: { key: "components.search.saved.savedOk", tone: "ok" },
  duplikat: { key: "components.search.saved.duplicate", tone: "error" },
  ugyldig: { key: "components.search.saved.invalid", tone: "error" },
  feil: { key: "components.search.saved.error", tone: "error" },
};

type SearchTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** Setter sammen en undertittel fra i18n-deler og rå data. */
function subtitleFor(item: SearchItem, t: SearchTranslator): string | undefined {
  if (item.subtitleParts?.length) {
    const text = item.subtitleParts
      .map((part) => (part.key ? t(part.key, part.params) : part.text))
      .filter(Boolean)
      .join(" • ");
    return text || undefined;
  }
  if (item.subtitleKey) return t(item.subtitleKey, item.subtitleParams);
  return item.subtitle;
}

function ResultLink({
  item,
  query,
  directLabel,
  subtitle,
}: {
  item: SearchItem;
  query: string;
  directLabel: string;
  subtitle?: string;
}) {
  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <Link
        href={item.href}
        className="block min-w-0 flex-1 rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
      >
        <p className="break-words text-sm font-bold text-gray-900">
          <HighlightedText text={item.title} query={query} />
        </p>
        {subtitle && (
          <p className="mt-1 break-words text-xs text-gray-500">
            <HighlightedText text={subtitle} query={query} />
          </p>
        )}
      </Link>
      {item.directHref && (
        <a
          href={item.directHref}
          target="_blank"
          rel="noopener"
          className="flex shrink-0 items-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
        >
          {directLabel}
        </a>
      )}
    </div>
  );
}

function technicianWhereFor(user: AccessUser) {
  if (user.role === "ADMIN") return staffWhere();
  if (!user.departmentId) return { id: { in: [] } };
  return staffWhere(user.departmentId);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.sok") };
}

export default async function SearchResultsPage({
  searchParams,
}: {
  searchParams: Promise<SearchPageSearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user?.isActive) redirect("/api/auth/signin");
  if (user.role === "CUSTOMER") redirect("/kundeportal");

  const resolvedParams = await searchParams;
  const { query, page, filters } = parseSearchPageParams(resolvedParams);
  const t = await getTranslations("common");
  const tl = t as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;

  const groupLabel = (kind: string) =>
    GROUP_KEYS[kind] ? tl(GROUP_KEYS[kind]) : kind;
  const directLabelFor = (item: SearchItem) =>
    item.directLabelKey
      ? tl(item.directLabelKey)
      : t("components.search.openFile");

  const hasQuery = query.length >= 2;
  const includeCancelled = user.role === "ADMIN" || user.role === "OFFICE";

  // Samme nøkkel og grense som /api/search, slik at hurtigsøket og
  // resultatsiden deler kvoten. Tomme søk teller ikke.
  const searchLimit = hasQuery
    ? await allowRequestDb(`search:${user.id}`, 60, 60_000)
    : { allowed: true, retryAfterSeconds: 0 };
  const rateLimited = !searchLimit.allowed;

  let results: SearchResults = { query, total: 0, groups: [] };
  let backendError = false;

  if (hasQuery && !rateLimited) {
    try {
      results = await performSearch(query, {
        user,
        includeCancelled,
        page,
        pageSize: SEARCH_PAGE_SIZE,
        filters,
        // Bevar det filtrerte søket som «tilbake»-mål fra dokument- og
        // rapportviserne.
        returnTo: buildSearchHref({ q: query, page, filters }),
      });
    } catch (error) {
      // Skill serverfeil fra «ingen treff», slik at brukeren får prøve igjen.
      console.error("Søkeresultatsiden feilet", error);
      backendError = true;
    }
  }

  let savedSearches: SavedSearch[] = [];
  try {
    const savedResult = await listSavedSearches(user);
    if (savedResult.ok) savedSearches = savedResult.data;
  } catch (error) {
    console.error("Kunne ikke hente lagrede søk", error);
  }

  const showCustomers = hasPermission(user, "customers.view");
  const showTechnicians = hasPermission(user, "workorders.view");
  const technicianWhere = technicianWhereFor(user);

  let customers: Array<{ id: string; name: string }> = [];
  let technicians: Array<{ id: string; name: string | null; email: string | null }> =
    [];

  try {
    [customers, technicians] = await Promise.all([
      showCustomers
        ? prisma.customer.findMany({
            where: { deletedAt: null },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
            take: 500,
          })
        : Promise.resolve([]),
      showTechnicians
        ? prisma.user.findMany({
            where: { AND: [technicianWhere, { isActive: true }] },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
            take: 500,
          })
        : Promise.resolve([]),
    ]);
  } catch (error) {
    // Filtervalgene er en bekvemmelighet; søkeresultatet og feilpanelet skal
    // fortsatt kunne vises om oppslaget feiler.
    console.error("Kunne ikke hente filtervalg", error);
  }

  const technicianOptions = technicians
    .map((technician) => ({
      id: technician.id,
      name: technician.name || technician.email || "",
    }))
    .filter((technician) => technician.name.length > 0);

  const pagination = paginationInfo(results.groups, page);
  const singleType =
    filters.types?.length === 1 ? filters.types[0] : undefined;
  // Topp treff er globale for søket og vises derfor bare på første side.
  const topHits =
    results.groups.length > 1 && page === 1 ? bestHits(results.groups, 5) : [];
  const canUseFilters = hasActiveFilters(filters);

  const lagre =
    typeof resolvedParams.lagre === "string" ? resolvedParams.lagre : undefined;
  const slettet =
    typeof resolvedParams.slettet === "string"
      ? resolvedParams.slettet
      : undefined;
  const savedMessage = lagre ? SAVED_MESSAGES[lagre] : undefined;
  const deletedMessage =
    slettet === "ok"
      ? { key: "components.search.saved.deleted", tone: "ok" as const }
      : slettet === "feil"
        ? { key: "components.search.saved.deleteError", tone: "error" as const }
        : undefined;
  const notice = savedMessage ?? deletedMessage;

  const suggestions = [
    { key: "components.search.suggestions.service", q: "service" },
    { key: "components.search.suggestions.pump", q: "pumpe" },
    { key: "components.search.suggestions.hms", q: "HMS" },
    { key: "components.search.suggestions.reports", q: "rapport" },
    { key: "components.search.suggestions.customers", q: "kunde" },
    { key: "components.search.suggestions.documents", q: "dokument" },
  ];

  const paginationBar = () => {
    if (
      backendError ||
      rateLimited ||
      !hasQuery ||
      (pagination.totalPages <= 1 && page <= 1)
    ) {
      return null;
    }

    return (
      <nav
        aria-label={t("components.search.paginationLabel")}
        className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-sm text-gray-600">
          {singleType
            ? t("components.search.pageInfoSingle", {
                page,
                totalPages: pagination.totalPages,
                type: groupLabel(singleType),
              })
            : results.groups.length > 1
              ? t("components.search.pageInfoGroups", {
                  page,
                  totalPages: pagination.totalPages,
                })
              : t("components.search.pageInfo", {
                  page,
                  totalPages: pagination.totalPages,
                })}
        </p>
        <div className="flex gap-2">
          {pagination.hasPrevious ? (
            <Link
              href={buildSearchHref({ q: query, page: page - 1, filters })}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              ← {t("components.search.previous")}
            </Link>
          ) : (
            <span className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600">
              ← {t("components.search.previous")}
            </span>
          )}
          {pagination.hasNext ? (
            <Link
              href={buildSearchHref({ q: query, page: page + 1, filters })}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              {t("components.search.next")} →
            </Link>
          ) : (
            <span className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600">
              {t("components.search.next")} →
            </span>
          )}
        </div>
      </nav>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeader
          title={t("components.search.title")}
          icon="🔍"
          actions={
            <Link
              href="/"
              className="whitespace-nowrap rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50"
            >
              ← {t("components.search.home")}
            </Link>
          }
        />
        <form
          action="/sok"
          method="get"
          aria-label={t("components.search.title")}
          className="flex min-w-0 flex-1 gap-2"
        >
          <FilterHiddenInputs filters={filters} />
          <label htmlFor="search-results-q" className="sr-only">
            {t("components.search.title")}
          </label>
          <input
            id="search-results-q"
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder={t("components.search.placeholder")}
            className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 shadow-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 sm:px-6"
          >
            {t("components.search.title")}
          </button>
        </form>

        <SearchFiltersForm
          variant="mobile"
          query={query}
          filters={filters}
          customers={customers}
          technicians={technicianOptions}
          showCustomers={showCustomers}
          showTechnicians={showTechnicians}
        >
          <SavedSearchesPanel
            searches={savedSearches}
            query={query}
            filters={filters}
            page={page}
            idPrefix="mobile-saved-searches"
          />
        </SearchFiltersForm>

        {hasQuery && <RecentSearches query={query} visible={false} />}

        {notice && (
          <div
            role="status"
            className={`rounded-xl border p-3 text-sm font-bold ${
              notice.tone === "ok"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {tl(notice.key)}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="hidden space-y-4 lg:block">
            <SearchFiltersForm
              query={query}
              filters={filters}
              customers={customers}
              technicians={technicianOptions}
              showCustomers={showCustomers}
              showTechnicians={showTechnicians}
            />
            <SavedSearchesPanel
              searches={savedSearches}
              query={query}
              filters={filters}
              page={page}
              idPrefix="desktop-saved-searches"
            />
            {hasPermission(user, "audit.view") && (
              <Link
                href="/sok/analyse"
                className="block rounded-2xl border border-gray-200 bg-white p-4 text-sm font-bold text-blue-700 shadow-sm hover:border-blue-300 hover:bg-blue-50"
              >
                📊 {t("components.search.analyse")}
              </Link>
            )}
          </aside>

          <div className="min-w-0 space-y-5">
            {!hasQuery ? (
              <SectionCard
                title={t("components.search.emptyTitle")}
                description={t("components.search.emptyBody")}
                className="p-6 sm:p-8"
              >
                <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
                  {query.length > 0
                    ? t("components.search.queryTooShort")
                    : t("components.search.prompt")}
                </p>

                <div className="mt-6">
                  <h2 className="text-sm font-bold text-gray-700">
                    {t("components.search.suggestionsTitle")}
                  </h2>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.key}>
                        <Link
                          href={buildSearchHref({ q: suggestion.q })}
                          className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                        >
                          {tl(suggestion.key)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 border-t border-gray-100 pt-4">
                  <RecentSearches query="" />
                </div>
              </SectionCard>
            ) : rateLimited ? (
              <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-center">
                <p className="font-bold text-yellow-900">
                  {t("components.search.tooMany")}
                </p>
                <p className="mt-1 text-sm text-yellow-800">
                  {t("components.search.retry", {
                    seconds: searchLimit.retryAfterSeconds,
                  })}
                </p>
              </div>
            ) : backendError ? (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center"
              >
                <p className="font-bold text-red-900">
                  {t("components.search.errorTitle")}
                </p>
                <p className="mt-1 text-sm text-red-800">
                  {t("components.search.errorBody")}
                </p>
                <Link
                  href={buildSearchHref({ q: query, page, filters })}
                  className="mt-4 inline-flex rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800"
                >
                  {t("components.search.retryAction")}
                </Link>
              </div>
            ) : (
              <>
                <SectionCard
                  title={
                    <>
                      {t("components.search.resultsFor", { query })}{" "}
                      <span className="text-base font-bold text-gray-600 sm:text-lg">
                        ({t("components.search.hits", { count: results.total })}
                        {results.capped ? "+" : ""})
                      </span>
                    </>
                  }
                  description={
                    canUseFilters
                      ? t("components.search.filtersActive")
                      : undefined
                  }
                  className="p-4 sm:p-5"
                />

                {paginationBar()}

                {results.total === 0 ? (
                  <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-center">
                    <p className="font-bold text-yellow-900">
                      {t("components.search.noHits")}
                    </p>
                    <p className="mt-1 text-sm text-yellow-800">
                      {t("components.search.noHitsHint")}
                    </p>
                  </div>
                ) : (
                  <>
                    {topHits.length > 0 && (
                      <section
                        aria-labelledby="best-hits-title"
                        className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm sm:p-5"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h2
                            id="best-hits-title"
                            className="text-lg font-black text-gray-900"
                          >
                            ⭐ {t("components.search.bestHits")}
                          </h2>
                          <p className="text-xs text-gray-600">
                            {t("components.search.bestHitsHint")}
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {topHits.map((hit) => (
                            <div key={`${hit.kind}-${hit.id}`} className="min-w-0">
                              <p className="mb-1 truncate text-xs font-bold uppercase tracking-wide text-gray-600">
                                {hit.icon} {groupLabel(hit.kind)}
                              </p>
                              <ResultLink
                                item={hit}
                                query={query}
                                directLabel={directLabelFor(hit)}
                                subtitle={subtitleFor(hit, tl)}
                              />
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {results.groups.map((group) => {
                      const range = groupRange(group, page, SEARCH_PAGE_SIZE);
                      const headingId = `search-group-${group.kind}`;

                      return (
                        <section
                          key={group.kind}
                          aria-labelledby={headingId}
                          className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 shadow-sm sm:p-5"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-gray-200 pb-2">
                            <h2
                              id={headingId}
                              className="text-lg font-black text-gray-900"
                            >
                              {group.icon} {groupLabel(group.kind)}{" "}
                              <span className="text-sm font-bold text-gray-600">
                                ({group.total}
                                {group.capped ? "+" : ""})
                              </span>
                            </h2>
                            {range && (
                              <p className="text-xs font-medium text-gray-500">
                                {t("components.search.groupInfo", {
                                  from: range.from,
                                  to: range.to,
                                  total: group.total,
                                })}
                              </p>
                            )}
                          </div>

                          {group.items.length === 0 ? (
                            <p className="mt-3 text-sm text-gray-500">
                              {t("components.search.groupEmptyPage")}
                            </p>
                          ) : (
                            <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
                              {group.items.map((item) => (
                                <ResultLink
                                  key={`${group.kind}-${item.id}`}
                                  item={item}
                                  query={query}
                                  directLabel={directLabelFor(item)}
                                  subtitle={subtitleFor(item, tl)}
                                />
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}

                    {paginationBar()}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
