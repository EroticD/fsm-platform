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
    <div className="sticky top-0 z-30 -mx-1 mt-6 rounded-xl border border-gray-200 bg-gray-50/95 px-1 py-1 shadow-sm backdrop-blur">
      <nav
        aria-label={t("portal.sectionNav.label")}
        className="-mx-1 flex gap-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((section) => {
          const isActive = active === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setActive(section.id)}
              aria-current={isActive ? "location" : undefined}
              className={`flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-bold transition-colors ${
                isActive
                  ? "bg-[var(--primary-color)] text-[var(--primary-foreground)] shadow-sm"
                  : "text-gray-700 hover:bg-gray-200"
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
