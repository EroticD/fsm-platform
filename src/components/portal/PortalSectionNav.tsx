"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const SECTIONS = [
  { id: "oversikt", labelKey: "overview" },
  { id: "bestillinger", labelKey: "bookings" },
  { id: "rapporter", labelKey: "reports" },
  { id: "kontakt", labelKey: "contact" },
] as const;

/**
 * Sticky seksjonsmeny i kundeportalen. Den er eneste inngang til seksjonene,
 * og ligger i en egen, avgrenset vannrett liste på små skjermer slik at den
 * aldri gir sidevis overflow.
 */
export default function PortalSectionNav() {
  const t = useTranslations("common");
  const [active, setActive] = useState<string>("oversikt");

  useEffect(() => {
    const elements = SECTIONS.map((section) =>
      document.getElementById(section.id),
    ).filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sticky top-2 z-30 mt-6 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1 shadow-[0_2px_10px_rgba(20,17,11,0.06)] backdrop-blur">
      <nav
        aria-label={t("portal.sectionNav.label")}
        className="flex gap-1 overflow-x-auto overscroll-x-contain px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((section) => {
          const isActive = active === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setActive(section.id)}
              aria-current={isActive ? "location" : undefined}
              className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-bold transition-colors ${
                isActive
                  ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] shadow-[1px_1px_0_var(--ink,#101310)]"
                  : "border-transparent text-[var(--muted,#62685f)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
              }`}
            >
              {t(`portal.sectionNav.${section.labelKey}`)}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
