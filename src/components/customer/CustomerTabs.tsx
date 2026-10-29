"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

export type CustomerTabEntry = {
  key: string;
  label: string;
  count?: number;
  href: string;
};

/**
 * Fanerad på kundekortet.
 *
 * På smale skjermer er ikke alle fanene synlige samtidig. Rullepilene ligger
 * utenfor selve rulleområdet, slik at de aldri dekker faneteksten, og den
 * aktive fanen rulles inn i visningen ved sidebytte. Rullelisten under fanene
 * gjør det også tydelig at det går an å dra sidelengs.
 */
export default function CustomerTabs({
  tabs,
  currentKey,
  label,
}: {
  tabs: CustomerTabEntry[];
  currentKey: string;
  label: string;
}) {
  const t = useTranslations("common");
  const navRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncScrollState = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    setCanScrollLeft(nav.scrollLeft > 2);
    setCanScrollRight(
      nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2,
    );
  }, []);

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollBy({
      left: direction * Math.max(160, nav.clientWidth * 0.7),
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    const active = activeRef.current;
    if (!nav || !active) return;

    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const padding = 8;
    let delta = 0;

    // Rull bare når den aktive fanen faktisk ligger utenfor visningen. Da
    // beholder vi så mange nabo faner som mulig synlige i stedet for å
    // sentrere aktiv fane og klippe den første.
    if (activeRect.left < navRect.left + padding) {
      delta = activeRect.left - navRect.left - padding;
    } else if (activeRect.right > navRect.right - padding) {
      delta = activeRect.right - navRect.right + padding;
    }

    if (delta !== 0) {
      nav.scrollBy({ left: delta, behavior: "smooth" });
    }
    syncScrollState();
  }, [currentKey, syncScrollState]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    syncScrollState();
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(nav);
    window.addEventListener("resize", syncScrollState);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncScrollState);
    };
  }, [syncScrollState]);

  const arrowClass =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-lg font-black text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)] disabled:pointer-events-none";

  return (
    <div className="flex items-center gap-1 [--focus-ring:var(--ink,#101310)]">
      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        disabled={!canScrollLeft}
        aria-label={t("customers.detail.tabs.scrollLeft")}
        title={t("customers.detail.tabs.scrollLeft")}
        className={`${arrowClass} ${canScrollLeft ? "" : "invisible"}`}
      >
        ‹
      </button>

      <nav
        ref={navRef}
        aria-label={label}
        onScroll={syncScrollState}
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1 shadow-[0_1px_2px_rgba(20,17,11,0.05)] [scrollbar-color:#cfc7b7_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#cfc7b7] [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {tabs.map((entry) => {
          const active = currentKey === entry.key;
          return (
            <Link
              key={entry.key}
              ref={active ? activeRef : undefined}
              href={entry.href}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold whitespace-nowrap transition sm:px-4 sm:text-sm ${
                active
                  ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] shadow-[1px_1px_0_var(--ink,#101310)]"
                  : "border-transparent text-[var(--muted,#62685f)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
              }`}
            >
              <span>{entry.label}</span>
              {entry.count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                    active
                      ? "bg-[#101310]/10 text-[var(--ink,#101310)]"
                      : "border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
                  }`}
                >
                  {entry.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => scrollByPage(1)}
        disabled={!canScrollRight}
        aria-label={t("customers.detail.tabs.scrollRight")}
        title={t("customers.detail.tabs.scrollRight")}
        className={`${arrowClass} ${canScrollRight ? "" : "invisible"}`}
      >
        ›
      </button>
    </div>
  );
}
