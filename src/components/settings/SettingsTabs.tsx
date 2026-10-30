"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

type SettingsTabsProps = {
  currentTab: string;
  canBranding: boolean;
  canMap: boolean;
  canUsers: boolean;
  canTemplates: boolean;
  canDocuments: boolean;
  canAudit: boolean;
  canStats: boolean;
  isAdmin: boolean;
};

const linkClass = (active: boolean) =>
  `flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-bold transition-colors sm:px-5 sm:py-3 sm:text-sm ${
    active
      ? "border-blue-600 text-blue-600"
      : "border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300"
  }`;

export default function SettingsTabs({
  currentTab,
  canBranding,
  canMap,
  canUsers,
  canTemplates,
  canDocuments,
  canAudit,
  canStats,
  isAdmin,
}: SettingsTabsProps) {
  const t = useTranslations("common");
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  // Avgjør om fanelisten faktisk er lengre enn plassen. Hintet om å sveipe
  // skal bare vises når det finnes skjulte faner.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const update = () =>
      setIsScrollable(nav.scrollWidth > nav.clientWidth + 1);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(nav);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // På mobil ligger fanene i en vannrett liste. Når brukeren kommer inn via
  // en dyp lenke (f.eks. ?tab=roller), skal den aktive fanen rulles synlig
  // uten at siden hopper vertikalt. På desktop wrapper listen i stedet.
  useEffect(() => {
    const nav = navRef.current;
    const active = activeRef.current;
    if (!nav || !active || !isScrollable) return;

    const targetLeft =
      active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, targetLeft), behavior: "auto" });
  }, [currentTab, isScrollable]);

  return (
    <div>
      <nav
        ref={navRef}
        aria-label={t("settings.title")}
        data-settings-tabs
        className="-mx-1 flex flex-wrap gap-x-1 border-b border-gray-200 px-1 pb-px max-md:flex-nowrap max-md:overflow-x-auto max-md:overscroll-x-contain max-md:[scrollbar-width:thin]"
      >
        {canBranding && (
          <Link
            href="?tab=branding"
            ref={currentTab === "branding" ? activeRef : undefined}
            className={linkClass(currentTab === "branding")}
            aria-current={currentTab === "branding" ? "page" : undefined}
          >
            <Icon name="image" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.branding")}
          </Link>
        )}
        {canMap && (
          <Link
            href="?tab=kart"
            ref={currentTab === "kart" ? activeRef : undefined}
            className={linkClass(currentTab === "kart")}
            aria-current={currentTab === "kart" ? "page" : undefined}
          >
            <Icon name="map" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.map")}
          </Link>
        )}
        {canUsers && (
          <Link
            href="?tab=ansatte"
            ref={currentTab === "ansatte" ? activeRef : undefined}
            className={linkClass(currentTab === "ansatte")}
            aria-current={currentTab === "ansatte" ? "page" : undefined}
          >
            <Icon name="users" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.employees")}
          </Link>
        )}
        {canTemplates && (
          <Link
            href="?tab=maler"
            ref={currentTab === "maler" ? activeRef : undefined}
            className={linkClass(currentTab === "maler")}
            aria-current={currentTab === "maler" ? "page" : undefined}
          >
            <Icon name="list" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.templates")}
          </Link>
        )}
        {(canTemplates || canDocuments) && (
          <Link
            href="?tab=tags"
            ref={currentTab === "tags" ? activeRef : undefined}
            className={linkClass(currentTab === "tags")}
            aria-current={currentTab === "tags" ? "page" : undefined}
          >
            <Icon name="flag" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.tags")}
          </Link>
        )}
        {canAudit && (
          <Link
            href="?tab=auditlog"
            ref={currentTab === "auditlog" ? activeRef : undefined}
            className={linkClass(currentTab === "auditlog")}
            aria-current={currentTab === "auditlog" ? "page" : undefined}
          >
            <Icon name="note" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.auditLog")}
          </Link>
        )}
        {canAudit && (
          <Link href="/sok/analyse" className={linkClass(false)}>
            <Icon name="chart" className="h-4 w-4 shrink-0" />
            {t("searchAdmin.linkLabel")}
          </Link>
        )}
        {canStats && (
          <Link
            href="?tab=statistikk"
            ref={currentTab === "statistikk" ? activeRef : undefined}
            className={linkClass(currentTab === "statistikk")}
            aria-current={currentTab === "statistikk" ? "page" : undefined}
          >
            <Icon name="chart" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.statistics")}
          </Link>
        )}
        {isAdmin && (
          <Link
            href="?tab=roller"
            ref={currentTab === "roller" ? activeRef : undefined}
            className={linkClass(currentTab === "roller")}
            aria-current={currentTab === "roller" ? "page" : undefined}
          >
            <Icon name="shield" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.roles")}
          </Link>
        )}
        {isAdmin && (
          <Link
            href="?tab=avdelinger"
            ref={currentTab === "avdelinger" ? activeRef : undefined}
            className={linkClass(currentTab === "avdelinger")}
            aria-current={currentTab === "avdelinger" ? "page" : undefined}
          >
            <Icon name="building" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.departments")}
          </Link>
        )}
        <Link
          href="?tab=sikkerhet"
          ref={currentTab === "sikkerhet" ? activeRef : undefined}
          className={linkClass(currentTab === "sikkerhet")}
          aria-current={currentTab === "sikkerhet" ? "page" : undefined}
        >
          <Icon name="shield" className="h-4 w-4 shrink-0" />
          {t("settings.tabs.security")}
        </Link>
      </nav>
      {isScrollable && (
        <p className="mt-1.5 text-xs text-gray-600 md:hidden">
          {t("settings.tabsHint")}
        </p>
      )}
    </div>
  );
}
