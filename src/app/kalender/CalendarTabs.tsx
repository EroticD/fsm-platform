"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import {
  calendarTabsFor,
  type CalendarTabKey,
  type CalendarTabQuery,
} from "@/lib/calendar-tabs";

/**
 * Felles fanerad for alle kalendervisningene. Dispatch skjules for brukere
 * uten tildelingsrettighet, og rapporter vises bare med reports.view.
 *
 * Aktiv fane er mørk ink med lime understrek. På mobil ruller stripen
 * horisontalt, og den aktive fanen scrolles inn i viewport. En gradient i
 * høyre kant viser at det finnes flere faner.
 */
export default function CalendarTabs({
  active,
  canDispatch,
  canReports,
  query,
}: {
  active: CalendarTabKey;
  canDispatch: boolean;
  canReports: boolean;
  query?: CalendarTabQuery;
}) {
  const t = useTranslations("common");
  const tabs = calendarTabsFor({ canDispatch, canReports, query });
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const activeTab = activeRef.current;
    if (!container || !activeTab) return;
    // Bare mobil bruker horisontal scrolling. På desktop er alle fanene synlige.
    if (!window.matchMedia("(max-width: 767px)").matches) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeTab.getBoundingClientRect();
    if (
      activeRect.left < containerRect.left ||
      activeRect.right > containerRect.right
    ) {
      activeTab.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [active]);

  return (
    <nav
      aria-label={t("calendar.common.viewSwitcher")}
      className="office-card relative overflow-hidden px-2 pt-2"
    >
      <div
        ref={containerRef}
        tabIndex={0}
        className="-mx-1 overflow-x-auto px-1 pb-1 pr-9 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal,#d8ff3e)] focus-visible:ring-offset-2 md:overflow-visible md:pb-0 md:pr-0"
      >
        <div className="flex w-max gap-1 border-b border-[var(--line,#dedcd1)] md:w-full md:flex-wrap">
          {tabs.map((tab) => {
            const isActive = tab.key === active;
            return (
              <Link
                key={tab.key}
                ref={isActive ? activeRef : undefined}
                href={tab.href}
                prefetch={false}
                aria-current={isActive ? "page" : undefined}
                className={`-mb-px flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-[3px] px-2.5 py-2 text-xs font-bold transition ${
                  isActive
                    ? "border-[var(--signal,#d8ff3e)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                    : "border-transparent text-[var(--muted,#62685f)] hover:border-[var(--line,#dedcd1)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
                }`}
              >
                <Icon name={tab.icon} className="h-4 w-4 shrink-0" />
                <span>{t(tab.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface,#fffdf8)] via-[var(--surface,#fffdf8)]/80 to-transparent md:hidden"
      />
    </nav>
  );
}
