"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export type OrderViewTab = {
  key: string;
  label: string;
  icon: string;
  count: number;
  href: string;
};

/**
 * Fanestripen på oppdragslisten.
 *
 * På mobil er den en horisontal stripe; den aktive fanen rulles inn i viewport
 * slik at man alltid ser valget selv når listen er bredere enn skjermen. På
 * desktop brytes fanene over flere linjer i stedet for å klippes.
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
        className="-mx-1 overflow-x-auto px-1 pb-2 pr-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 [scrollbar-width:thin] md:overflow-visible md:pb-0 md:pr-0"
      >
        <div className="flex w-max gap-2 md:w-full md:flex-wrap">
          {tabs.map((tab) => {
            const active = tab.key === activeKey;
            return (
              <Link
                key={tab.key}
                ref={active ? activeRef : undefined}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-bold transition whitespace-nowrap ${
                  active
                    ? "bg-blue-700 border-blue-700 text-white shadow-sm"
                    : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300"
                }`}
              >
                <span className="leading-none" aria-hidden>
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                    active
                      ? "bg-white text-blue-800 ring-1 ring-inset ring-blue-200"
                      : "bg-white border border-gray-200 text-gray-600"
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
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white via-white/80 to-transparent md:hidden"
      />
    </div>
  );
}
