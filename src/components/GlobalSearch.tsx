"use client";

import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SearchItem = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

type SearchGroup = {
  kind: string;
  label: string;
  icon: string;
  items: SearchItem[];
};

type SearchResults = {
  query: string;
  total: number;
  groups: SearchGroup[];
};

type FlatItem = SearchItem & { icon: string };

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 180;

/**
 * Interaktivt globalt søk. Henter treff fra /api/search mens brukeren skriver
 * og viser dem gruppert i et nedtrekk. Piltaster + Enter kan brukes fra tastaturet.
 */
export default function GlobalSearch({
  placeholder = "Søk i kunder, oppdrag, enheter, kontakter, rapporter …",
}: {
  placeholder?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_LENGTH;
  // Lastet vi inn resultater for en annen spørring enn den som står i feltet nå?
  const loading = hasQuery && results?.query !== trimmed;

  const groups = useMemo(() => results?.groups ?? [], [results]);
  const total = results?.total ?? 0;

  const flat = useMemo<FlatItem[]>(
    () => groups.flatMap((g) => g.items.map((i) => ({ ...i, icon: g.icon }))),
    [groups]
  );

  // Startindeks for hver gruppe, slik at vi kan utpeke riktig element ved hover.
  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const g of groups) {
      out.push(acc);
      acc += g.items.length;
    }
    return out;
  }, [groups]);

  // Debounced henting fra søke-API-et, med avbrudd på forrige forespørsel.
  useEffect(() => {
    if (!hasQuery) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Søk feilet (${res.status})`);
        const data = (await res.json()) as SearchResults;
        setResults({ query: trimmed, total: data.total ?? 0, groups: data.groups ?? [] });
        setActive(0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults({ query: trimmed, total: 0, groups: [] });
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, hasQuery]);

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

      if (event.key === "/" && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setResults(null);
      router.push(href);
    },
    [router]
  );

  function reset() {
    setQuery("");
    setResults(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (flat.length ? Math.min(i + 1, flat.length - 1) : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = open ? flat[active] : undefined;
      if (item) {
        navigate(item.href);
      } else if (trimmed) {
        navigate(`/sok?q=${encodeURIComponent(trimmed)}`);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showPanel = open && hasQuery;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 bg-white border-2 border-gray-200 focus-within:border-blue-600 rounded-2xl px-4 py-3 shadow-sm transition-colors">
        <span aria-hidden className="text-lg leading-none">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-label="Globalt søk"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm text-gray-900 font-medium placeholder:text-gray-400"
        />
        {loading && <span className="text-[11px] text-gray-400 animate-pulse">søker…</span>}
        {!loading && query.length > 0 && (
          <button
            type="button"
            onClick={reset}
            aria-label="Tøm søk"
            className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1"
          >
            ×
          </button>
        )}
        {!loading && query.length === 0 && (
          <kbd
            aria-hidden
            className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-bold text-gray-400 border border-gray-200 bg-gray-50 rounded-md px-1.5 py-0.5 shrink-0"
          >
            <span className="text-[11px]">⌘</span>K
          </kbd>
        )}
      </div>

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute z-50 mt-2 w-full bg-white border-2 border-gray-200 rounded-2xl shadow-xl max-h-[70vh] overflow-y-auto"
        >
          {flat.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">
              {loading ? "Søker…" : `Ingen treff på «${trimmed}».`}
            </div>
          ) : (
            <div className="py-1">
              {groups.map((group, gi) => (
                <div key={group.kind}>
                  <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    {group.icon} {group.label}
                  </div>
                  {group.items.map((item, ii) => {
                    const index = offsets[gi] + ii;
                    const isActive = index === active;
                    return (
                      <button
                        key={`${group.kind}-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => navigate(item.href)}
                        className={`w-full text-left px-4 py-2 flex flex-col transition-colors ${
                          isActive ? "bg-blue-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-sm font-bold text-gray-900 truncate">{item.title}</span>
                        {item.subtitle && (
                          <span className="text-[11px] text-gray-500 truncate">{item.subtitle}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              <button
                type="button"
                onClick={() => navigate(`/sok?q=${encodeURIComponent(trimmed)}`)}
                className="w-full text-left px-4 py-3 mt-1 border-t border-gray-100 text-xs font-bold text-blue-600 hover:bg-blue-50 transition-colors"
              >
                Se alle {total} treff i søket →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
