"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "./LanguageSwitcher";
import GlobalSearch from "./GlobalSearch";
import NotificationBell from "./NotificationBell";
import NotificationSoundToggle from "./NotificationSoundToggle";
import LogoutButton from "./LogoutButton";
import BrandMark from "./BrandMark";
import Icon from "./icons";
import {
  activeNavHref,
  homePathForRole,
  isAuthPath,
  menuNavFor,
  navItemsFor,
  OPEN_MENU_EVENT,
  primaryNavFor,
  settingsNavItem,
  type NavItem,
} from "@/lib/navigation";

const MENU_ID = "app-navigation";

const BREADCRUMB_LABELS: Record<string, string> = {
  "mine-oppdrag": "nav.myWorkOrders",
  oppdrag: "nav.workOrders",
  kalender: "nav.calendar",
  kart: "nav.map",
  kunder: "nav.customers",
  dokumenter: "nav.documents",
  varsler: "nav.notifications",
  innstillinger: "nav.settings",
  kundeportal: "nav.customerPortal",
  ny: "nav.newWorkOrder",
  hms: "nav.hms",
  rapporter: "nav.reports",
  enheter: "nav.units",
  sok: "nav.search",
  sikkerhet: "nav.security",
  brukere: "nav.users",
};

export default function BrandedHeader({
  title,
  showNav = true,
  role,
  permissions,
  companyName = "FSM System",
  logoUrl = null,
  primaryColor = "#2563eb",
}: {
  title?: string;
  showNav?: boolean;
  role?: string;
  permissions?: string[];
  companyName?: string;
  logoUrl?: string | null;
  primaryColor?: string;
}) {
  const t = useTranslations("common");
  // Menyen husker hvilken side den ble åpnet fra. Navigerer man videre til en
  // annen side stemmer ikke stien lenger, og menyen lukker seg av seg selv.
  const [openMenuForPath, setOpenMenuForPath] = useState<string | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const pathname = usePathname();
  const isMenuOpen = openMenuForPath === pathname;
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastMenuOpenerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const closeMenu = useCallback(() => setOpenMenuForPath(null), []);
  const isCustomer = role === "CUSTOMER";
  // Montørene får feltmodus: mørk, kompakt topplinje og mørk bunnlinje.
  // Kontor, administrasjon og egendefinerte kontorroller bruker den lyse
  // topplinjen med merkevare, hovednavigasjon og globalt søk.
  const isField = role === "TECHNICIAN";
  const isDesk = !isCustomer && !isField;
  const navItems = useMemo(
    () => (showNav ? navItemsFor(role, permissions) : []),
    [role, permissions, showNav],
  );
  const primaryItems = useMemo(() => primaryNavFor(navItems), [navItems]);
  const menuItems = useMemo(() => menuNavFor(navItems), [navItems]);
  const settingsItem = useMemo(() => settingsNavItem(navItems), [navItems]);
  const activeHref = activeNavHref(navItems, pathname);

  // Innloggings- og kontosidene skal stå alene uten app-navigasjon.
  const isAuthRoute = isAuthPath(pathname);
  const showBreadcrumbs =
    showNav &&
    !isCustomer &&
    pathname !== "/" &&
    pathname !== homePathForRole(role) &&
    !pathname.startsWith("/kundeportal");
  const showInlineBreadcrumb = showNav && !isCustomer && isField;

  // Mobilens bunnlinje har ingen egen meny. «Mer» sender denne hendelsen, og
  // menyen åpnes på nytt med samme dialog, fokusfelle og fokusretur.
  useEffect(() => {
    const onOpenMenu = (event: Event) => {
      if (!showNav || isAuthPath(pathname)) return;
      const detail = (
        event as CustomEvent<{ opener?: HTMLElement | null }>
      ).detail;
      lastMenuOpenerRef.current = detail?.opener ?? toggleRef.current;
      setOpenMenuForPath(pathname);
    };
    window.addEventListener(OPEN_MENU_EVENT, onOpenMenu);
    return () => window.removeEventListener(OPEN_MENU_EVENT, onOpenMenu);
  }, [pathname, showNav]);

  // Fokus flyttes inn i menyen når den åpnes, og tilbake til knappen som
  // åpnet den når den lukkes. Selve menyen er en dialog, så Tab holder seg
  // innenfor.
  useEffect(() => {
    if (!isMenuOpen) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab" || !menuRef.current) return;

      const focusable = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (toggleRef.current?.contains(target)) return;
      closeMenu();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isMenuOpen, closeMenu]);

  useEffect(() => {
    if (!isMenuOpen) return;
    // Låser bakgrunnen mens menyen er åpen, slik at mobilen ikke scroller
    // innholdet under det faste overlegget.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (isMenuOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const opener = lastMenuOpenerRef.current ?? toggleRef.current;
      lastMenuOpenerRef.current = null;
      opener?.focus();
    }
  }, [isMenuOpen]);

  if (isAuthRoute) return null;

  const company = companyName || "FSM System";
  const pc = primaryColor || "#2563eb";

  const searchTone = isField
    ? "border-[#2a3328] bg-[var(--field)]"
    : "border-[var(--line)] bg-[var(--surface)]";

  return (
    <div className="flex flex-col gap-0">
      {/* Topplinje. Kontor og administrasjon får merkevaren til venstre,
          hovednavigasjonen i midten og søk + kontroller til høyre. I feltmodus
          er linjen mørk og kompakt, og kundeportalen beholder den lyse
          varianten. */}
      <header
        className={`flex min-h-16 items-center gap-2 border-b px-4 pt-[env(safe-area-inset-top)] sm:px-6 lg:gap-3 lg:px-8 ${isField ? "" : "[--focus-ring:var(--ink,#101310)]"} ${
          isField
            ? "border-[#2a3328] bg-[var(--field)] text-[var(--paper)]"
            : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
        }`}
      >
        <Link
          href={isCustomer ? "/kundeportal" : homePathForRole(role)}
          className="flex shrink-0 items-center gap-3"
          suppressHydrationWarning
          style={{ color: isField ? "var(--signal)" : pc }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={company}
              className="h-9 w-auto max-w-[120px] shrink-0 object-contain xl:max-w-[220px]"
            />
          ) : (
            // Uten opplastet logo bruker vi det felles merket. Den lyse
            // signalflaten holder kontrasten også på den mørke felttoppen.
            <BrandMark size={36} title={company} className="shrink-0" />
          )}
          <div className="hidden max-w-[180px] sm:block lg:hidden xl:block">
            {title && (
              <h1
                className={`text-xl font-black ${
                  isField ? "text-[var(--paper)]" : "text-[var(--ink,#101310)]"
                }`}
              >
                {title}
              </h1>
            )}
            {!logoUrl && (
              <p
                className={`truncate text-xs font-semibold uppercase tracking-wider ${
                  isField ? "text-[var(--paper,#f2efe6)]/60" : "text-[var(--muted,#62685f)]"
                }`}
              >
                {company}
              </p>
            )}
          </div>
        </Link>

        {/* Kompakt brødsmulesti/tittel i topplinjen i feltmodus, der
            hovednavigasjonen ikke vises på brede skjermer. */}
        {showInlineBreadcrumb && (
          <div className="hidden min-w-0 flex-1 items-center lg:flex">
            <BreadcrumbTrail pathname={pathname} role={role} tone="field" />
          </div>
        )}

        {/* Globalt søk i topplinjen på brede skjermer. I feltmodus ligger det
            før kontrollene; på kontorflatene ligger det sammen med dem. */}
        {showNav && !isCustomer && isField && (
          <div className="hidden w-full max-w-[21rem] shrink-0 lg:block">
            <GlobalSearch />
          </div>
        )}

        {/* Hovednavigasjonen på brede skjermer: arbeidsområdene for kontoret,
            portalen for kunden. Sekundære sider bor i hamburgermenyen. */}
        {showNav && !isField && (
          <div className="hidden min-w-0 flex-1 justify-center lg:flex">
            <GlobalNavDesktop
              items={primaryItems}
              activeHref={activeHref}
            />
          </div>
        )}

        {/* Språk, varsler, søk og meny er tilgjengelig på alle bredder. */}
        <div
          className={`ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5 ${
            isField ? "field-shell-controls" : ""
          }`}
        >
          {showNav && !isCustomer && isDesk && (
            <div className="hidden w-52 shrink-0 lg:block xl:w-72">
              <GlobalSearch />
            </div>
          )}
          <NotificationBell role={role} />
          {showNav && (
            <button
              ref={toggleRef}
              type="button"
              onClick={() => {
                if (isMenuOpen) {
                  closeMenu();
                  return;
                }
                lastMenuOpenerRef.current = toggleRef.current;
                setOpenMenuForPath(pathname);
              }}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 text-2xl leading-none text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
              aria-label={
                isMenuOpen
                  ? t("components.header.closeMenu")
                  : t("components.header.openMenu")
              }
              aria-expanded={isMenuOpen}
              aria-controls={MENU_ID}
            >
              <Icon
                name={isMenuOpen ? "close" : "menu"}
                className="h-6 w-6"
              />
            </button>
          )}
        </div>
      </header>

      {showBreadcrumbs && (
        <Breadcrumbs
          pathname={pathname}
          role={role}
          tone={isField ? "field" : "light"}
          className={isField ? "lg:hidden" : undefined}
        />
      )}

      {/* Globalt søk (ikke for kundeportalbrukere). Kontor og administrasjon
          har søket inline i topplinjen på brede skjermer, og en sammenklappet
          rad under topplinjen på mobil og tablet. Feltmodus og kundeportalen
          beholder sine egne varianter. */}
      {showNav && !isCustomer && (
        isField ? (
          <>
            <div
              className={`hidden border-b px-4 pb-3 pt-3 sm:block sm:px-6 lg:hidden ${searchTone}`}
            >
              <GlobalSearch />
            </div>
            <div
              className={`border-b px-4 pb-3 pt-3 sm:hidden ${searchTone}`}
            >
              <button
                type="button"
                onClick={() => setMobileSearchOpen((open) => !open)}
                aria-expanded={mobileSearchOpen}
                aria-controls="mobile-global-search"
                className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[#2a3328] bg-[var(--field-card)] px-3 py-2 text-left text-sm font-bold text-[var(--paper)] transition hover:bg-[var(--paper,#f2efe6)]/10"
              >
                <Icon name="search" className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">
                  {t("components.header.search")}
                </span>
                <Icon
                  name="chevronDown"
                  className={`h-4 w-4 shrink-0 text-[var(--paper,#f2efe6)]/40 transition-transform ${
                    mobileSearchOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {mobileSearchOpen && (
                <div id="mobile-global-search" className="mt-2">
                  <GlobalSearch />
                </div>
              )}
            </div>
          </>
        ) : isDesk ? (
          <div className={`border-b px-4 pb-3 pt-3 lg:hidden ${searchTone}`}>
            <button
              type="button"
              onClick={() => setMobileSearchOpen((open) => !open)}
              aria-expanded={mobileSearchOpen}
              aria-controls="mobile-global-search"
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-left text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--surface,#fffdf8)]"
            >
              <Icon name="search" className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">
                {t("components.header.search")}
              </span>
              <Icon
                name="chevronDown"
                className={`h-4 w-4 shrink-0 text-[var(--muted,#62685f)] transition-transform ${
                  mobileSearchOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {mobileSearchOpen && (
              <div id="mobile-global-search" className="mt-2">
                <GlobalSearch />
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="hidden bg-[var(--surface,#fffdf8)] px-4 pb-4 pt-3 sm:block sm:px-6 lg:px-8">
              <GlobalSearch />
            </div>
            <div className="bg-[var(--surface,#fffdf8)] px-4 pb-3 pt-3 sm:hidden">
              <button
                type="button"
                onClick={() => setMobileSearchOpen((open) => !open)}
                aria-expanded={mobileSearchOpen}
                aria-controls="mobile-global-search"
                className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-left text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--surface,#fffdf8)]"
              >
                <Icon name="search" className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">
                  {t("components.header.search")}
                </span>
                <Icon
                  name="chevronDown"
                  className={`h-4 w-4 shrink-0 text-[var(--muted,#62685f)] transition-transform ${
                    mobileSearchOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {mobileSearchOpen && (
                <div id="mobile-global-search" className="mt-2">
                  <GlobalSearch />
                </div>
              )}
            </div>
          </>
        )
      )}

      {/* Menyen er et ekte overlegg med dempet bakgrunn og låst sidescroll.
          Innholdet kan rulle, mens språk, lyd, innstillinger og utlogging
          ligger fast nederst på kontorflatene. */}
      {showNav && isMenuOpen && (
        <div className="fixed inset-0 z-50">
          <div
            aria-hidden
            className="absolute inset-0 bg-[var(--ink,#101310)]/50 backdrop-blur-[1px]"
          />
          <div
            ref={menuRef}
            id={MENU_ID}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${MENU_ID}-title`}
            className="absolute inset-y-0 right-0 flex w-[min(22rem,88vw)] flex-col overflow-hidden bg-[var(--surface,#fffdf8)] pt-[env(safe-area-inset-top)] shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--line,#dedcd1)] p-4">
              <h2
                id={`${MENU_ID}-title`}
                className="text-sm font-bold text-[var(--ink,#101310)]"
              >
                {t("components.header.menu")}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeMenu}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 text-2xl leading-none text-[var(--muted,#62685f)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
                aria-label={t("components.header.closeMenu")}
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {isCustomer ? (
                <GlobalNavMobile
                  items={primaryItems}
                  activeHref={activeHref}
                  label={t("components.header.mainMenu")}
                  onNavigate={closeMenu}
                />
              ) : (
                <>
                  {primaryItems.length > 0 && (
                    <div className={isField ? undefined : "lg:hidden"}>
                      <MenuHeading>
                        {t("components.header.work")}
                      </MenuHeading>
                      <GlobalNavMobile
                        items={primaryItems}
                        activeHref={activeHref}
                        label={t("components.header.work")}
                        onNavigate={closeMenu}
                      />
                    </div>
                  )}
                  {menuItems.length > 0 && (
                    <div
                      className={
                        primaryItems.length > 0 ? "mt-4 lg:mt-0" : undefined
                      }
                    >
                      <MenuHeading>
                        {t("components.header.more")}
                      </MenuHeading>
                      <GlobalNavMobile
                        items={menuItems}
                        activeHref={activeHref}
                        label={t("components.header.more")}
                        onNavigate={closeMenu}
                      />
                    </div>
                  )}
                </>
              )}
              {!isDesk && (
                <LogoutButton
                  onNavigate={closeMenu}
                  className="mt-4 w-full rounded-xl border border-transparent px-4 py-3 text-left font-bold text-[var(--ink,#101310)] transition hover:bg-[#fdf4f2] hover:text-[var(--risk-text,#b42318)] disabled:opacity-60"
                />
              )}
            </div>

            {(!isCustomer || settingsItem) && (
              <div className="shrink-0 border-t border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="flex flex-col gap-2">
                  {/* Språket skal være synlig også for kundeportalbrukere,
                      som ikke har den interne menyens øvrige kontroller. */}
                  <LanguageSwitcher />
                  {!isCustomer && (
                    <NotificationSoundToggle className="w-full justify-between" />
                  )}
                  {settingsItem && (
                    <NavLink
                      item={settingsItem}
                      isActive={activeHref === settingsItem.href}
                      onNavigate={closeMenu}
                      mobile
                    />
                  )}
                  {isDesk && (
                    <LogoutButton
                      onNavigate={closeMenu}
                      className="w-full rounded-xl border border-[var(--line,#dedcd1)] px-4 py-3 text-left font-bold text-[var(--ink,#101310)] transition hover:border-[#e7b5ae] hover:bg-[#fdf4f2] hover:text-[var(--risk-text,#b42318)] disabled:opacity-60"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 px-1 text-2xs font-bold uppercase tracking-wider text-[var(--muted,#62685f)]">
      {children}
    </p>
  );
}

function breadcrumbLabel(
  segment: string,
  parent: string | undefined,
  translate: (key: string) => string,
  role?: string,
): string {
  const key =
    segment === "mine-oppdrag" && role === "TECHNICIAN"
      ? "nav.today"
      : segment === "kunder" && parent === "mine-oppdrag"
        ? "nav.customersEquipment"
        : BREADCRUMB_LABELS[segment];
  if (key) return translate(key);

  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();
  if (parent === "oppdrag" || /^\d+$/.test(decoded) || /^[a-z0-9]{20,}$/.test(decoded)) {
    return translate("components.header.details");
  }

  const words = decoded.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type BreadcrumbTone = "light" | "field";

function BreadcrumbItems({
  pathname,
  role,
  tone,
}: {
  pathname: string;
  role?: string;
  tone: BreadcrumbTone;
}) {
  const t = useTranslations("common");
  const allSegments = pathname.split("/").filter(Boolean);
  const homeHref = homePathForRole(role);
  const homeLabel =
    homeHref === "/mine-oppdrag" ? t("nav.today") : t("nav.dashboard");
  // På hjemflaten til rollen (for eksempel /mine-oppdrag for montører) skal
  // brødsmulestien vise hjemmet én gang, ikke «I dag / I dag».
  const isHomePath = pathname === homeHref;
  const segments = isHomePath ? [] : allSegments;
  const textClass =
    tone === "field" ? "text-[var(--paper,#f2efe6)]/55" : "text-[var(--muted)]";
  const linkClass =
    tone === "field"
      ? "hover:text-[var(--paper)] hover:underline"
      : "hover:text-[var(--ink)] hover:underline";
  const separatorClass =
    tone === "field" ? "text-[var(--paper,#f2efe6)]/25" : "text-[var(--muted)]/45";
  const currentClass =
    tone === "field"
      ? "font-semibold text-[var(--paper)]"
      : "font-semibold text-[var(--ink)]";

  return (
    <ol
      className={`flex min-w-0 items-center gap-1.5 text-xs ${textClass}`}
    >
      <li className="flex min-w-0 shrink-0 items-center gap-1.5">
        {segments.length === 0 ? (
          <span aria-current="page" className={`truncate ${currentClass}`}>
            {homeLabel}
          </span>
        ) : (
          <Link
            href={homeHref}
            className={`rounded font-medium transition ${linkClass}`}
          >
            {homeLabel}
          </Link>
        )}
      </li>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const href = `/${segments.slice(0, index + 1).join("/")}`;
        const label = breadcrumbLabel(
          segment,
          segments[index - 1],
          t,
          role,
        );

        return (
          <li key={href} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className={separatorClass}>
              <Icon name="chevronRight" className="h-3 w-3" />
            </span>
            {isLast ? (
              <span
                aria-current="page"
                className={`truncate ${currentClass}`}
              >
                {label}
              </span>
            ) : (
              <Link
                href={href}
                className={`truncate rounded transition ${linkClass}`}
              >
                {label}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Breadcrumbs({
  pathname,
  role,
  tone = "light",
  className,
}: {
  pathname: string;
  role?: string;
  tone?: BreadcrumbTone;
  className?: string;
}) {
  const t = useTranslations("common");
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav
      aria-label={t("components.header.breadcrumb")}
      className={`border-b px-4 py-1.5 sm:px-6 lg:px-8 ${
        tone === "field"
          ? "border-[#2a3328] bg-[var(--field)]"
          : "border-[var(--line)] bg-[var(--surface)]"
      } ${className ?? ""}`}
    >
      <BreadcrumbItems pathname={pathname} role={role} tone={tone} />
    </nav>
  );
}

/** Brødsmulestien som ligger inne i den kompakte topplinjen på brede skjermer. */
function BreadcrumbTrail({
  pathname,
  role,
  tone,
}: {
  pathname: string;
  role?: string;
  tone: BreadcrumbTone;
}) {
  const t = useTranslations("common");
  return (
    <nav aria-label={t("components.header.breadcrumb")} className="min-w-0">
      <BreadcrumbItems pathname={pathname} role={role} tone={tone} />
    </nav>
  );
}

function navLinkClass(isActive: boolean, mobile: boolean) {
  return [
    mobile
      ? "w-full px-4 py-3 rounded-xl text-sm font-bold transition-all text-left border border-transparent"
      : "px-2.5 xl:px-3 py-2 rounded-xl text-[13px] xl:text-sm font-medium transition-all whitespace-nowrap border border-transparent",
    isActive
      ? mobile
        ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] font-bold text-[var(--ink,#101310)] shadow-[inset_0_-2px_0_var(--ink,#101310)]"
        : "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] font-bold text-[var(--paper,#f2efe6)]"
      : mobile
        ? "text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
        : "text-[var(--muted,#62685f)] hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]",
  ].join(" ");
}

function NavLink({
  item,
  isActive,
  onNavigate,
  mobile,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate?: () => void;
  mobile: boolean;
}) {
  const t = useTranslations("common");
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={navLinkClass(isActive, mobile)}
    >
      {isActive && !mobile ? (
        <span
          aria-hidden
          className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--signal,#d8ff3e)] align-[-0.0625em]"
        />
      ) : item.icon ? (
        <Icon
          name={item.icon}
          className={`mr-1.5 h-4 w-4 align-[-0.125em] ${
            mobile ? "inline-block" : "hidden xl:inline-block"
          }`}
        />
      ) : null}
      {t(`nav.${item.labelKey}`)}
    </Link>
  );
}

function GlobalNavDesktop({
  items,
  activeHref,
}: {
  items: NavItem[];
  activeHref: string | null;
}) {
  const t = useTranslations("common");
  return (
    <nav
      className="flex flex-nowrap items-center gap-0.5 xl:gap-1"
      aria-label={t("components.header.mainMenu")}
    >
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          isActive={activeHref === item.href}
          mobile={false}
        />
      ))}
    </nav>
  );
}

function GlobalNavMobile({
  items,
  activeHref,
  label,
  onNavigate,
}: {
  items: NavItem[];
  activeHref: string | null;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <nav
      className="flex flex-col gap-2"
      aria-label={label}
    >
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          isActive={activeHref === item.href}
          onNavigate={onNavigate}
          mobile
        />
      ))}
    </nav>
  );
}
