"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import Icon, { type IconName } from "@/components/icons";

export type OrderViewTab = {
  key: string;
  label: string;
  icon: IconName;
  count: number;
  href: string;
};

/**
 * Fanestripen på oppdragslisten.
 *
 * Aktiv fane er mørk ink med lime understrek. På mobil er stripen horisontal
 * og ruller den aktive fanen inn i viewport; på desktop brytes fanene over
 * flere linjer i stedet for å klippes.
 */
export default function OrderViewTabs({
  tabs,
  activeKey,
  ariaLabel,
}: {
  tabs: OrderViewTab[];
  activeKey: string;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    // Bare mobil bruker horisontal scrolling. På desktop er alle fanene synlige.
    if (!window.matchMedia("(max-width: 767px)").matches) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < containerRect.left || activeRect.right > containerRect.right) {
      active.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [activeKey]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        className="-mx-1 overflow-x-auto px-1 pb-1 pr-9 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal,#c8f135)] focus-visible:ring-offset-2 md:overflow-visible md:pb-0 md:pr-0"
      >
        <div className="flex w-max gap-1 border-b border-[var(--line,#d8d3c5)] md:w-full md:flex-wrap">
          {tabs.map((tab) => {
            const active = tab.key === activeKey;
            return (
              <Link
                key={tab.key}
                ref={active ? activeRef : undefined}
                href={tab.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-[3px] px-2.5 py-2 text-xs font-bold transition ${
                  active
                    ? "border-[var(--signal,#c8f135)] bg-[var(--ink,#131711)] text-[var(--paper,#fbfaf4)]"
                    : "border-transparent text-[var(--ink,#131711)] hover:border-[var(--line,#d8d3c5)] hover:bg-white/70"
                }`}
              >
                <Icon name={tab.icon} className="h-3.5 w-3.5 shrink-0" />
                <span>{tab.label}</span>
                <span
                  className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                    active
                      ? "bg-[var(--signal,#c8f135)] text-[var(--ink,#131711)]"
                      : "border border-[var(--line,#d8d3c5)] bg-white text-[#5e6356]"
                  }`}
                >
                  {tab.count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--canvas,#f2efe6)] via-[var(--canvas,#f2efe6)]/80 to-transparent md:hidden"
      />
    </div>
  );
}
