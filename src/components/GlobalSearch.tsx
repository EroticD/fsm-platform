"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  addRecentSearch,
  readRecentSearches,
  writeRecentSearches,
} from "@/lib/search-recent";
import { highlightSearchText } from "@/lib/search-highlight";

type SearchItem = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  score?: number;
};

type SearchGroup = {
  kind: string;
  label: string;
  icon: string;
  total: number;
  capped?: boolean;
  items: SearchItem[];
};

type SearchResults = {
  query: string;
  total: number;
  groups: SearchGroup[];
  tookMs?: number;
};

type FlatItem = SearchItem & {
  icon: string;
  kind: string;
  optionId: string;
};

type SearchStatus = "idle" | "loading" | "success" | "error";

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 180;
const MAX_ITEMS_PER_GROUP = 5;

/** Uthever søkeordene i en tittel/undertittel uten å sette inn HTML. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = highlightSearchText(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-sm bg-yellow-200 px-0.5 text-inherit"
          >
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Interaktivt globalt søk. Henter treff fra /api/search mens brukeren skriver
 * og viser dem gruppert i et nedtrekk. Piltaster + Enter kan brukes fra
 * tastaturet. Nylige søk ligger i localStorage, men bare søkestrengen lagres.
 */
export default function GlobalSearch({
  placeholder,
}: {
  placeholder?: string;
}) {
  const pathname = usePathname();

  // På /sok er søkefeltet i selve resultatsiden autoritativt. Da skjules
  // headeren sitt søk for å unngå to konkurrerende søkefelt på samme side.
  if (pathname === "/sok" || pathname === "/sok/") return null;

  return <GlobalSearchInner placeholder={placeholder} />;
}

function GlobalSearchInner({ placeholder }: { placeholder?: string }) {
  const t = useTranslations("common");
  const resolvedPlaceholder = placeholder ?? t("components.search.placeholder");
  const router = useRouter();
  const baseId = useId().replace(/:/g, "");
  const listboxId = `global-search-${baseId}-listbox`;
  const recentHeadingId = `global-search-${baseId}-recent-heading`;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [retryToken, setRetryToken] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [isMac, setIsMac] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentRef = useRef<string[]>([]);

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_LENGTH;
  const tooShort = trimmed.length > 0 && !hasQuery;

  const groups = useMemo(
    () =>
      (results?.groups ?? []).map((group) => ({
        ...group,
        total: Number.isFinite(group.total)
          ? group.total
          : group.items.length,
        // Selv om API-et skulle returnere flere, holder nedtrekket seg lite.
        items: group.items.slice(0, MAX_ITEMS_PER_GROUP),
      })),
    [results],
  );

  const total = results?.total ?? 0;
  const groupLabel = (kind: string, fallback: string) => {
    const key = `components.search.groups.${kind}`;
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const flat = useMemo<FlatItem[]>(
    () =>
      groups.flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          icon: group.icon,
          kind: group.kind,
          optionId: `global-search-${baseId}-option-${group.kind}-${item.id}`.replace(
            /[^A-Za-z0-9_-]/g,
            "-",
          ),
        })),
      ),
    [groups, baseId],
  );

  // Startindeks for hver gruppe, slik at vi kan utpeke riktig element ved hover.
  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const group of groups) {
      out.push(acc);
      acc += group.items.length;
    }
    return out;
  }, [groups]);

  const optionCount = hasQuery ? flat.length : tooShort ? 0 : recent.length;
  const safeActive = Math.min(active, Math.max(optionCount - 1, 0));
  const activeItem = hasQuery ? flat[safeActive] : undefined;
  const activeRecent =
    !hasQuery && !tooShort ? recent[safeActive] : undefined;
  const activeOptionId = !open
    ? undefined
    : hasQuery
      ? status === "success"
        ? activeItem?.optionId
        : undefined
      : activeRecent
        ? `global-search-${baseId}-recent-${safeActive}`
        : undefined;

  // Debounced henting fra søke-API-et. Avbryt forrige forespørsel når søket
  // endres, og hold lastet/feilet/tomt som tre tydelige tilstander.
  useEffect(() => {
    if (!hasQuery) return;

    const controller = new AbortController();
    let alive = true;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`Søk feilet (${res.status})`);

        const data = (await res.json()) as SearchResults;
        if (!alive) return;

        setResults({
          query: trimmed,
          total: data.total ?? 0,
          groups: data.groups ?? [],
        });
        setStatus("success");
        setActive(0);
      } catch (error) {
        if ((error as Error).name === "AbortError" || !alive) return;
        setResults(null);
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, hasQuery, retryToken]);

  // Lukk nedtrekket når man klikker utenfor.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Vis riktig snarvei i søkefeltet: ⌘K på macOS, Ctrl+K ellers. Plattformen
  // leses i en effekt, slik at server- og klient-render er identiske.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const platform = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
      setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Globalt tastatursnarvei: Ctrl/Cmd+K fokuserer søket, «/» gjør det samme
  // så lenge man ikke står i et annet inntastingsfelt.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      if (
        event.key === "/" &&
        !isTyping &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateRecent = useCallback((next: string[]) => {
    recentRef.current = next;
    setRecent(next);
    writeRecentSearches(next);
  }, []);

  const loadRecent = useCallback(() => {
    const stored = readRecentSearches();
    recentRef.current = stored;
    setRecent(stored);
  }, []);

  const rememberQuery = useCallback(
    (value: string) => {
      updateRecent(addRecentSearch(recentRef.current, value));
    },
    [updateRecent],
  );

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setResults(null);
      setStatus("idle");
      router.push(href);
    },
    [router],
  );

  const navigateToAllResults = useCallback(() => {
    if (trimmed.length < MIN_LENGTH) return;
    rememberQuery(trimmed);
    navigate(`/sok?q=${encodeURIComponent(trimmed)}`);
  }, [navigate, rememberQuery, trimmed]);

  const runRecentSearch = useCallback(
    (value: string) => {
      rememberQuery(value);
      setQuery(value);
      setStatus("loading");
      setOpen(true);
      setActive(0);
      inputRef.current?.focus();
    },
    [rememberQuery],
  );

  function reset() {
    setQuery("");
    setResults(null);
    setStatus("idle");
    setActive(0);
    inputRef.current?.focus();
  }

  function clearRecent() {
    updateRecent([]);
    setActive(0);
  }

  function retry() {
    setStatus("loading");
    setRetryToken((token) => token + 1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (optionCount === 0) return;
      setActive((safeActive + 1) % optionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (optionCount === 0) return;
      setActive((safeActive - 1 + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!hasQuery) {
        if (tooShort) return;
        if (open && activeRecent) runRecentSearch(activeRecent);
        return;
      }

      const item = open ? flat[safeActive] : undefined;
      if (item) {
        rememberQuery(trimmed);
        navigate(item.href);
      } else if (trimmed) {
        navigateToAllResults();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const showPanel =
    open &&
    (hasQuery || tooShort || (trimmed.length === 0 && recent.length > 0));

  const announcement = (() => {
    if (!showPanel) return "";
    if (hasQuery) {
      if (status === "loading") return t("components.search.searching");
      if (status === "error") return t("components.search.errorTitle");
      if (status === "success" && flat.length === 0) {
        return t("components.search.noResults", { query: trimmed });
      }
      if (activeItem) {
        return activeItem.subtitle
          ? `${activeItem.title}, ${activeItem.subtitle}`
          : activeItem.title;
      }
      return "";
    }
    if (tooShort) return t("components.search.minLengthHint");
    return activeRecent
      ? t("components.search.recentAnnouncement", { query: activeRecent })
      : "";
  })();

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="flex min-w-0 items-center gap-2 rounded-2xl border-2 border-gray-200 bg-white px-4 py-3 shadow-sm transition-colors focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/25 focus-within:ring-offset-1">
        <span aria-hidden className="text-lg leading-none">
          🔍
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            setOpen(true);
            setActive(0);
            setStatus(
              value.trim().length >= MIN_LENGTH ? "loading" : "idle",
            );
          }}
          onFocus={() => {
            loadRecent();
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={resolvedPlaceholder}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={showPanel ? activeOptionId : undefined}
          aria-label={t("components.search.ariaLabel")}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-gray-900 placeholder:text-gray-400"
        />
        {status === "loading" && hasQuery && (
          <span
            aria-hidden
            className="shrink-0 text-xs text-gray-400 animate-pulse"
          >
            {t("components.search.searchingShort")}
          </span>
        )}
        {query.length > 0 && (
          <button
            type="button"
            onClick={reset}
            aria-label={t("components.search.clear")}
            className="shrink-0 rounded-md px-1 text-lg leading-none text-gray-400 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
          >
            ×
          </button>
        )}
        {query.length === 0 && (
          <kbd
            aria-hidden
            className="hidden shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs font-bold text-gray-400 sm:inline-flex"
          >
            {isMac ? (
              <>
                <span className="text-xs">⌘</span>K
              </>
            ) : (
              "Ctrl+K"
            )}
          </kbd>
        )}
      </div>

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      {showPanel && (
        <div className="absolute left-0 right-0 z-50 mt-2 max-w-full overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-xl">
          <div
            id={listboxId}
            role="listbox"
            aria-label={t("components.search.ariaLabel")}
            aria-busy={status === "loading"}
            className="max-h-[60vh] overflow-y-auto overflow-x-hidden overscroll-contain py-1"
          >
            {tooShort && (
              <div className="px-4 py-6">
                <p className="text-sm font-bold text-gray-800">
                  {t("components.search.minLengthHint")}
                </p>
              </div>
            )}

            {hasQuery && status === "loading" && (
              <div className="flex items-center gap-3 px-4 py-6 text-sm text-gray-600">
                <span
                  aria-hidden
                  className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
                />
                {t("components.search.searching")}
              </div>
            )}

            {hasQuery && status === "error" && (
              <div role="alert" className="px-4 py-5">
                <p className="text-sm font-bold text-red-700">
                  {t("components.search.errorTitle")}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {t("components.search.errorHint")}
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-3 inline-flex min-h-9 items-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1"
                >
                  {t("components.search.retrySearch")}
                </button>
              </div>
            )}

            {hasQuery && status === "success" && flat.length === 0 && (
              <div className="px-4 py-6">
                <p className="text-sm font-bold text-gray-800">
                  {t("components.search.noResults", { query: trimmed })}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {t("components.search.noResultsHint")}
                </p>
              </div>
            )}

            {hasQuery && status === "success" && flat.length > 0 && (
              <>
                {groups.map((group, groupIndex) => {
                  const headingId = `global-search-${baseId}-${group.kind}-heading`;
                  return (
                    <div
                      key={group.kind}
                      role="group"
                      aria-labelledby={headingId}
                    >
                      <div
                        id={headingId}
                        role="presentation"
                        className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-gray-400"
                      >
                        <span className="min-w-0 truncate">
                          <span aria-hidden>{group.icon}</span>{" "}
                          {groupLabel(group.kind, group.label)}
                        </span>
                        {group.total > 0 && (
                          <span className="ml-auto shrink-0 font-semibold normal-case tracking-normal">
                            {t("components.search.groupTotal", {
                              count: group.total,
                            })}
                            {group.capped ? "+" : ""}
                          </span>
                        )}
                      </div>
                      {group.items.map((item, itemIndex) => {
                        const index = offsets[groupIndex] + itemIndex;
                        const isActive = index === safeActive;
                        const optionId = `global-search-${baseId}-option-${group.kind}-${item.id}`.replace(
                          /[^A-Za-z0-9_-]/g,
                          "-",
                        );
                        return (
                          <button
                            key={`${group.kind}-${item.id}`}
                            id={optionId}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => {
                              rememberQuery(trimmed);
                              navigate(item.href);
                            }}
                            className={`flex w-full min-w-0 flex-col px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                              isActive ? "bg-blue-50" : "hover:bg-gray-50"
                            }`}
                          >
                            <span className="block w-full truncate text-sm font-bold text-gray-900">
                              <HighlightedText
                                text={item.title}
                                query={trimmed}
                              />
                            </span>
                            {item.subtitle && (
                              <span className="block w-full truncate text-xs text-gray-500">
                                <HighlightedText
                                  text={item.subtitle}
                                  query={trimmed}
                                />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </>
            )}

            {!hasQuery && !tooShort && recent.length > 0 && (
              <div role="group" aria-labelledby={recentHeadingId}>
                <div
                  id={recentHeadingId}
                  role="presentation"
                  className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-gray-400"
                >
                  {t("components.search.recentTitle")}
                </div>
                {recent.map((value, index) => {
                  const isActive = index === safeActive;
                  const optionId = `global-search-${baseId}-recent-${index}`;
                  return (
                    <button
                      key={value}
                      id={optionId}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => runRecentSearch(value)}
                      className={`flex w-full min-w-0 items-center gap-2 px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                        isActive ? "bg-blue-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <span aria-hidden className="shrink-0 text-xs text-gray-400">
                        🕘
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium text-gray-800">
                        {value}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {hasQuery && status === "success" && total > 0 && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={navigateToAllResults}
                className="w-full px-4 py-3 text-left text-xs font-bold text-blue-600 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              >
                {t("components.search.seeAll", { count: total })}
              </button>
            </div>
          )}

          {!hasQuery && !tooShort && recent.length > 0 && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={clearRecent}
                className="w-full px-4 py-3 text-left text-xs font-bold text-gray-500 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              >
                {t("components.search.clearRecent")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
