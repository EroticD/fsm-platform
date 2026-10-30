"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  mergeRecentSearch,
  parseRecentSearches,
  RECENT_SEARCHES_KEY,
  RECENT_SEARCHES_LIMIT,
} from "@/lib/recent-searches";

const EMPTY: string[] = [];

function createRecentSearchStore(query: string, limit: number) {
  const value = query.trim().slice(0, 100);
  let cachedKey = "";
  let cachedItems: string[] = EMPTY;

  function readStored(): string[] {
    try {
      return parseRecentSearches(window.localStorage.getItem(RECENT_SEARCHES_KEY));
    } catch {
      return EMPTY;
    }
  }

  function getSnapshot(): string[] {
    let raw = "";
    try {
      raw = window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? "";
    } catch {
      return EMPTY;
    }

    const key = `${raw}\u0000${value}\u0000${limit}`;
    if (key === cachedKey) return cachedItems;

    const stored = parseRecentSearches(raw);
    cachedItems = (
      value ? mergeRecentSearch(stored, value, limit) : stored.slice(0, limit)
    ).slice(0, limit);
    cachedKey = key;
    return cachedItems;
  }

  return {
    subscribe(callback: () => void) {
      window.addEventListener("storage", callback);
      return () => window.removeEventListener("storage", callback);
    },
    getSnapshot,
    getServerSnapshot: () => EMPTY,
    record() {
      if (!value) return;
      try {
        const next = mergeRecentSearch(readStored(), value, limit);
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // Privat modus / full lagring skal aldri stoppe søket.
      }
    },
  };
}

/**
 * Nylige søk fra samme localStorage-nøkkel som hurtigsøket.
 *
 * Komponenten rendres bare i tomtilstanden. Når brukeren har søkt, lagres
 * søket lokalt uten at det sendes til serveren.
 */
export default function RecentSearches({
  query,
  limit = RECENT_SEARCHES_LIMIT,
  visible = true,
}: {
  query: string;
  limit?: number;
  /** Kan slås av når komponenten bare skal registrere søket lokalt. */
  visible?: boolean;
}) {
  const t = useTranslations("common");
  const store = useMemo(
    () => createRecentSearchStore(query, limit),
    [query, limit],
  );
  const items = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  useEffect(() => {
    store.record();
  }, [store]);

  if (!visible || items.length === 0) return null;

  return (
    <section aria-labelledby="recent-searches-title">
      <h3
        id="recent-searches-title"
        className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]"
      >
        {t("components.search.recentTitle")}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item}>
            <Link
              href={`/sok?q=${encodeURIComponent(item)}`}
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-1.5 text-sm font-medium text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
            >
              {item}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
