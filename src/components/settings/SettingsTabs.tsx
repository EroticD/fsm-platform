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
  canSla: boolean;
  canDispatch: boolean;
  isAdmin: boolean;
};

const linkClass = (active: boolean) =>
  `flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-[3px] px-3 py-2.5 text-xs font-bold transition-colors sm:px-4 sm:py-3 ${
    active
      ? "border-[var(--signal,#d8ff3e)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
      : "border-transparent text-[var(--muted,#62685f)] hover:border-[var(--line,#dedcd1)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
  }`;

/** Monokrom nøkkel med låsehake – samme strek som resten av ikonsettet. */
function ApiKeyIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9" />
      <path d="m17 6 2 2" />
      <path d="m14 9 2 2" />
    </svg>
  );
}

export default function SettingsTabs({
  currentTab,
  canBranding,
  canMap,
  canUsers,
  canTemplates,
  canDocuments,
  canAudit,
  canStats,
  canSla,
  canDispatch,
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
        className="office-card -mx-1 flex flex-wrap gap-x-1 px-2 pt-2 pb-px max-md:flex-nowrap max-md:overflow-x-auto max-md:overscroll-x-contain max-md:[scrollbar-width:thin]"
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
        {canSla && (
          <Link
            href="?tab=sla"
            ref={currentTab === "sla" ? activeRef : undefined}
            className={linkClass(currentTab === "sla")}
            aria-current={currentTab === "sla" ? "page" : undefined}
          >
            <Icon name="clock" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.sla")}
          </Link>
        )}
        {canDispatch && (
          <Link
            href="?tab=dispatch"
            ref={currentTab === "dispatch" ? activeRef : undefined}
            className={linkClass(currentTab === "dispatch")}
            aria-current={currentTab === "dispatch" ? "page" : undefined}
          >
            <Icon name="route" className="h-4 w-4 shrink-0" />
            {t("settings.tabs.dispatch")}
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
        {isAdmin && (
          <Link
            href="?tab=api"
            ref={currentTab === "api" ? activeRef : undefined}
            className={linkClass(currentTab === "api")}
            aria-current={currentTab === "api" ? "page" : undefined}
          >
            <ApiKeyIcon className="h-4 w-4 shrink-0" />
            {t("settings.tabs.api")}
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
        <p className="mt-1.5 text-xs text-[var(--muted,#62685f)] md:hidden">
          {t("settings.tabsHint")}
        </p>
      )}
    </div>
  );
}
