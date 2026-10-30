import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { hasPermission } from "@/lib/permissions";
import { staffWhere, type AccessUser } from "@/lib/access";
import { performSearch, type SearchItem, type SearchResults } from "@/lib/search";
import { hasActiveFilters, type SearchFilters } from "@/lib/search-filters";
import { formatDateLocalized } from "@/lib/dates";
import { listSavedSearches, type SavedSearch } from "@/server/saved-searches";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import SectionCard from "@/components/SectionCard";
import HighlightedText from "@/components/search/HighlightedText";
import RecentSearches from "@/components/search/RecentSearches";
import { formatSearchSubtitle } from "@/components/search/search-subtitle";
import SearchFiltersForm from "./SearchFiltersForm";
import SavedSearchesPanel from "./SavedSearchesPanel";
import FilterHiddenInputs from "./FilterHiddenInputs";
import { GROUP_ICONS, GROUP_KEYS } from "./labels";
import {
  bestHits,
  buildSearchHref,
  groupRange,
  paginationInfo,
  parseSearchPageParams,
  SEARCH_PAGE_SIZE,
} from "./search-params";

type SearchPageSearchParams = Record<string, string | string[] | undefined>;

const CARD = "office-card";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const SAVED_MESSAGES: Record<
  string,
  { key: string; tone: "ok" | "error" }
> = {
  lagret: { key: "components.search.saved.savedOk", tone: "ok" },
  duplikat: { key: "components.search.saved.duplicate", tone: "error" },
  ugyldig: { key: "components.search.saved.invalid", tone: "error" },
  feil: { key: "components.search.saved.error", tone: "error" },
};

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
        className="block min-w-0 flex-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]"
      >
        <p className="break-words text-sm font-bold text-[var(--ink,#101310)]">
          <HighlightedText text={item.title} query={query} />
        </p>
        {subtitle && (
          <p className="mt-1 break-words text-xs text-[var(--muted,#62685f)]">
            <HighlightedText text={subtitle} query={query} />
          </p>
        )}
      </Link>
      {item.directHref && (
        <a
          href={item.directHref}
          target="_blank"
          rel="noopener"
          className="flex shrink-0 items-center rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]"
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
  const locale = await getLocale();
  const tl = t as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const subtitleFor = (item: SearchItem) =>
    formatSearchSubtitle(item, tl, locale);

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
  // Tagger og mapper er navigasjonshjelpere, ikke innholdstreff; de skal ikke
  // ta plassene fra kunder, oppdrag, rapporter og dokumenter.
  const topHitGroups = results.groups.filter(
    (group) => group.kind !== "tag" && group.kind !== "folder",
  );
  const topHits =
    results.groups.length > 1 && page === 1 ? bestHits(topHitGroups, 5) : [];
  const topHitKeys = new Set(
    topHits.map((hit) => `${hit.kind}:${hit.id}`),
  );
  // Unngå at samme treff vises både under «Beste treff» og i gruppen sin.
  const visibleGroups = results.groups.map((group) => {
    if (page !== 1 || topHitKeys.size === 0) {
      return { group, items: group.items, hidden: 0 };
    }
    const items = group.items.filter(
      (item) => !topHitKeys.has(`${group.kind}:${item.id}`),
    );
    return { group, items, hidden: group.items.length - items.length };
  });
  const canUseFilters = hasActiveFilters(filters);

  function hrefWithFilters(next: SearchFilters): string {
    return buildSearchHref({ q: query, filters: next });
  }

  function typeFilterHref(kind: string): string {
    const current = filters.types ?? [];
    const types = current.includes(kind)
      ? current.filter((value) => value !== kind)
      : [...current, kind];
    return hrefWithFilters({
      ...filters,
      types: types.length > 0 ? types : undefined,
    });
  }

  const activeFilterChips: Array<{
    key: string;
    label: string;
    href: string;
  }> = [];

  for (const kind of filters.types ?? []) {
    activeFilterChips.push({
      key: `type-${kind}`,
      label: groupLabel(kind),
      href: typeFilterHref(kind),
    });
  }
  if (filters.status) {
    activeFilterChips.push({
      key: "status",
      label: `${t("components.search.filters.status")}: ${tl(
        `components.search.statuses.${filters.status}`,
      )}`,
      href: hrefWithFilters({ ...filters, status: undefined }),
    });
  }
  if (filters.customer) {
    const customerName =
      customers.find((customer) => customer.id === filters.customer)?.name ??
      filters.customer;
    activeFilterChips.push({
      key: "customer",
      label: `${t("components.search.filters.customer")}: ${customerName}`,
      href: hrefWithFilters({ ...filters, customer: undefined }),
    });
  }
  if (filters.technician) {
    const technicianName =
      technicianOptions.find(
        (technician) => technician.id === filters.technician,
      )?.name ?? filters.technician;
    activeFilterChips.push({
      key: "technician",
      label: `${t("components.search.filters.technician")}: ${technicianName}`,
      href: hrefWithFilters({ ...filters, technician: undefined }),
    });
  }
  if (filters.dateFrom) {
    activeFilterChips.push({
      key: "dateFrom",
      label: `${t("components.search.filters.dateFrom")}: ${formatDateLocalized(
        filters.dateFrom,
        locale,
        { dateStyle: "medium" },
      )}`,
      href: hrefWithFilters({ ...filters, dateFrom: undefined }),
    });
  }
  if (filters.dateTo) {
    activeFilterChips.push({
      key: "dateTo",
      label: `${t("components.search.filters.dateTo")}: ${formatDateLocalized(
        filters.dateTo,
        locale,
        { dateStyle: "medium" },
      )}`,
      href: hrefWithFilters({ ...filters, dateTo: undefined }),
    });
  }
  if (filters.tag) {
    activeFilterChips.push({
      key: "tag",
      label: `${t("components.search.filters.tag")}: ${filters.tag}`,
      href: hrefWithFilters({ ...filters, tag: undefined }),
    });
  }
  if (filters.hmsType) {
    activeFilterChips.push({
      key: "hmsType",
      label: `${t("components.search.filters.hmsType")}: ${tl(
        `components.search.hmsTypes.${filters.hmsType}`,
      )}`,
      href: hrefWithFilters({ ...filters, hmsType: undefined }),
    });
  }

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
        className={`${CARD} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}
      >
        <p className="text-xs text-[var(--muted,#62685f)]">
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
              className={INK_BUTTON}
            >
              ← {t("components.search.previous")}
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-xs font-bold text-[var(--muted,#62685f)]">
              ← {t("components.search.previous")}
            </span>
          )}
          {pagination.hasNext ? (
            <Link
              href={buildSearchHref({ q: query, page: page + 1, filters })}
              className={INK_BUTTON}
            >
              {t("components.search.next")} →
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-xs font-bold text-[var(--muted,#62685f)]">
              {t("components.search.next")} →
            </span>
          )}
        </div>
      </nav>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeader
          title={t("components.search.title")}
          icon={<Icon name="search" className="h-5 w-5" />}
          actions={
            <Link
              href="/"
              className={INK_BUTTON}
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
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 py-3 text-base text-[var(--ink,#101310)] shadow-[inset_0_1px_0_rgba(20,17,11,0.03)] outline-none placeholder:text-[#6b6559] focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
          <button
            type="submit"
            className={`${SIGNAL_BUTTON} shrink-0 sm:px-6`}
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
            className={`flex items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 bg-[var(--surface,#fffdf8)] p-3 text-sm font-bold text-[var(--ink,#101310)] ${
              notice.tone === "ok"
                ? "border-l-[var(--signal,#d8ff3e)]"
                : "border-l-[var(--risk,#f04427)] text-[var(--risk-text,#b42318)]"
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
                className={`${CARD} flex items-center gap-2 p-4 text-sm font-bold text-[var(--ink,#101310)] transition hover:border-[#bdb3a0]`}
              >
                <Icon name="chart" className="h-4 w-4 shrink-0" />
                {t("components.search.analyse")}
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
                <p className="mt-4 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-sm text-[var(--muted,#62685f)]">
                  {query.length > 0
                    ? t("components.search.queryTooShort")
                    : t("components.search.prompt")}
                </p>

                <div className="mt-6">
                  <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                    {t("components.search.suggestionsTitle")}
                  </h2>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.key}>
                        <Link
                          href={buildSearchHref({ q: suggestion.q })}
                          className="inline-flex min-h-11 items-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-1.5 text-sm font-medium text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
                        >
                          {tl(suggestion.key)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 border-t border-[var(--line,#dedcd1)] pt-4">
                  <RecentSearches query="" />
                </div>
              </SectionCard>
            ) : rateLimited ? (
              <div className="rounded-card border border-[#e2cf9b] bg-[#fbf1d2] p-6 text-center">
                <p className="font-bold text-[#6b4a05]">
                  {t("components.search.tooMany")}
                </p>
                <p className="mt-1 text-sm text-[#6b4a05]">
                  {t("components.search.retry", {
                    seconds: searchLimit.retryAfterSeconds,
                  })}
                </p>
              </div>
            ) : backendError ? (
              <div
                role="alert"
                className="rounded-card border border-[var(--risk,#f04427)] bg-[#fae8e0] p-6 text-center"
              >
                <p className="font-bold text-[var(--risk-text,#b42318)]">
                  {t("components.search.errorTitle")}
                </p>
                <p className="mt-1 text-sm text-[var(--risk-text,#b42318)]">
                  {t("components.search.errorBody")}
                </p>
                <Link
                  href={buildSearchHref({ q: query, page, filters })}
                  className={`${INK_BUTTON} mt-4`}
                >
                  {t("components.search.retryAction")}
                </Link>
              </div>
            ) : (
              <>
                <div className={`${CARD} flex flex-wrap items-baseline justify-between gap-2 p-4`}>
                  <h2 className="flex flex-wrap items-baseline gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
                    <span>
                      {t("components.search.resultsFor", { query })}{" "}
                    </span>
                    <span className="text-xs font-bold text-[var(--muted,#62685f)]">
                      ({t("components.search.hits", { count: results.total })}
                      {results.capped ? "+" : ""})
                    </span>
                  </h2>
                  {canUseFilters && (
                    <p className="text-xs text-[var(--muted,#62685f)]">
                      {t("components.search.filtersActive")}
                    </p>
                  )}
                </div>

                {canUseFilters && (
                  <section
                    aria-label={t("components.search.filtersActive")}
                    className={`${CARD} flex flex-wrap items-center gap-2 p-3 sm:p-4`}
                  >
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                      {t("components.search.filters.title")}
                    </span>
                    {activeFilterChips.map((chip) => (
                      <Link
                        key={chip.key}
                        href={chip.href}
                        aria-label={t("components.search.removeFilter", {
                          label: chip.label,
                        })}
                        className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-1 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
                      >
                        {chip.label}
                        <Icon name="close" className="h-3 w-3 shrink-0" />
                      </Link>
                    ))}
                    <Link
                      href={buildSearchHref({ q: query })}
                      className="ml-auto text-xs font-bold text-[var(--ink,#101310)] underline-offset-2 hover:underline"
                    >
                      {t("components.search.filters.clear")}
                    </Link>
                  </section>
                )}

                {results.groups.length > 0 && (
                  <nav
                    aria-label={t("components.search.filters.types")}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                      {t("components.search.filters.types")}
                    </span>
                    {results.groups.map((group) => {
                      const active = filters.types?.includes(group.kind) ?? false;
                      return (
                        <Link
                          key={group.kind}
                          href={typeFilterHref(group.kind)}
                          aria-current={active ? "true" : undefined}
                          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                            active
                              ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                              : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
                          }`}
                        >
                          <Icon
                            name={GROUP_ICONS[group.kind] ?? "search"}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          {groupLabel(group.kind)}
                          <span className={active ? "text-[#c9cdc3]" : "text-[var(--muted,#62685f)]"}>
                            ({group.total}
                            {group.capped ? "+" : ""})
                          </span>
                        </Link>
                      );
                    })}
                  </nav>
                )}

                {paginationBar()}

                {results.total === 0 ? (
                  <div className="rounded-card border border-[#e2cf9b] bg-[#fbf1d2] p-6 text-center">
                    <p className="font-bold text-[#6b4a05]">
                      {t("components.search.noHits")}
                    </p>
                    <p className="mt-1 text-sm text-[#6b4a05]">
                      {t("components.search.noHitsHint")}
                    </p>
                  </div>
                ) : (
                  <>
                    {topHits.length > 0 && (
                      <section
                        aria-labelledby="best-hits-title"
                        className={`${CARD} relative overflow-hidden p-4 sm:p-5`}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
                        />
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h2
                            id="best-hits-title"
                            className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]"
                          >
                            <Icon name="flag" className="h-4 w-4 shrink-0" />
                            {t("components.search.bestHits")}
                          </h2>
                          <p className="text-xs text-[var(--muted,#62685f)]">
                            {t("components.search.bestHitsHint")}
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {topHits.map((hit) => (
                            <div key={`${hit.kind}-${hit.id}`} className="min-w-0">
                              <p className="mb-1 flex items-center gap-1.5 truncate text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                                <Icon
                                  name={GROUP_ICONS[hit.kind] ?? "search"}
                                  className="h-3.5 w-3.5 shrink-0"
                                />
                                {groupLabel(hit.kind)}
                              </p>
                              <ResultLink
                                item={hit}
                                query={query}
                                directLabel={directLabelFor(hit)}
                                subtitle={subtitleFor(hit)}
                              />
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {visibleGroups.map(({ group, items, hidden }) => {
                      const range = groupRange(group, page, SEARCH_PAGE_SIZE);
                      const headingId = `search-group-${group.kind}`;

                      return (
                        <section
                          key={group.kind}
                          aria-labelledby={headingId}
                          className={`${CARD} p-4 sm:p-5`}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--line,#dedcd1)] pb-2">
                            <h2
                              id={headingId}
                              className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]"
                            >
                              <Icon
                                name={GROUP_ICONS[group.kind] ?? "search"}
                                className="h-4 w-4 shrink-0"
                              />
                              {groupLabel(group.kind)}{" "}
                              <span className="text-xs font-bold text-[var(--muted,#62685f)]">
                                ({group.total}
                                {group.capped ? "+" : ""})
                              </span>
                            </h2>
                            {range && (
                              <p className="text-xs font-medium text-[var(--muted,#62685f)]">
                                {t("components.search.groupInfo", {
                                  from: range.from,
                                  to: range.to,
                                  total: group.total,
                                })}
                              </p>
                            )}
                          </div>

                          {hidden > 0 && (
                            <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[var(--muted,#62685f)]">
                              <Icon name="flag" className="h-3.5 w-3.5 shrink-0" />
                              {t("components.search.bestHitsOverlap", {
                                count: hidden,
                              })}
                            </p>
                          )}

                          {items.length === 0 ? (
                            hidden === 0 ? (
                              <p className="mt-3 text-sm text-[var(--muted,#62685f)]">
                                {t("components.search.groupEmptyPage")}
                              </p>
                            ) : null
                          ) : (
                            <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
                              {items.map((item) => (
                                <ResultLink
                                  key={`${group.kind}-${item.id}`}
                                  item={item}
                                  query={query}
                                  directLabel={directLabelFor(item)}
                                  subtitle={subtitleFor(item)}
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
