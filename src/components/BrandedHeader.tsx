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
import { readableTextColor } from "@/lib/colors";
import {
  activeNavHref,
  menuNavFor,
  navItemsFor,
  primaryNavFor,
  settingsNavItem,
  type NavItem,
} from "@/lib/navigation";

const MENU_ID = "app-navigation";

const AUTH_ROUTES = [
  "/logg-inn",
  "/glemt-passord",
  "/tilbakestill-passord",
  "/aktiver-konto",
];

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
  const wasOpenRef = useRef(false);
  const closeMenu = useCallback(() => setOpenMenuForPath(null), []);
  const isCustomer = role === "CUSTOMER";

  const navItems = useMemo(
    () => (showNav ? navItemsFor(role, permissions) : []),
    [role, permissions, showNav],
  );
  const primaryItems = useMemo(() => primaryNavFor(navItems), [navItems]);
  const menuItems = useMemo(() => menuNavFor(navItems), [navItems]);
  const settingsItem = useMemo(() => settingsNavItem(navItems), [navItems]);
  const activeHref = activeNavHref(navItems, pathname);

  // Innloggings- og kontosidene skal stå alene uten app-navigasjon.
  const isAuthRoute = AUTH_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const showBreadcrumbs =
    showNav &&
    !isCustomer &&
    pathname !== "/" &&
    !pathname.startsWith("/kundeportal");

  // Fokus flyttes inn i menyen når den åpnes, og tilbake til knappen når den
  // lukkes. Selve menyen er en dialog, så Tab holder seg innenfor.
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
      toggleRef.current?.focus();
    }
  }, [isMenuOpen]);

  if (isAuthRoute) return null;

  const company = companyName || "FSM System";
  const pc = primaryColor || "#2563eb";
  const activeTextColor = readableTextColor(pc);

  return (
    <div className="flex flex-col gap-0">
      {/* Topplinje: logo, hovednavigasjon og kontroller. Høyden er fast og
          navigasjonen brytes aldri over to rader. */}
      <div className="flex h-16 items-center gap-2 border-b border-gray-100 bg-white px-4 sm:px-6 lg:gap-3 lg:px-8">
        <Link
          href={isCustomer ? "/kundeportal" : "/"}
          className="flex shrink-0 items-center gap-3"
          suppressHydrationWarning
          style={{ color: pc }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={company}
              className="h-9 w-auto max-w-[120px] shrink-0 object-contain xl:max-w-[220px]"
            />
          ) : (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white shadow-sm"
              suppressHydrationWarning
              style={{ backgroundColor: pc }}
            >
              {company.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="hidden max-w-[180px] sm:block lg:hidden xl:block">
            {title && (
              <h1 className="text-xl font-black text-gray-900">{title}</h1>
            )}
            {!logoUrl && (
              <p className="truncate text-xs font-semibold uppercase tracking-wider text-gray-700">
                {company}
              </p>
            )}
          </div>
        </Link>

        {/* Hovednavigasjonen på brede skjermer: bare arbeidsområdene. Kart,
            nytt oppdrag og varsler bor i hamburgermenyen. */}
        {showNav && (
          <div className="hidden min-w-0 flex-1 justify-center lg:flex">
            <GlobalNavDesktop
              items={primaryItems}
              activeHref={activeHref}
              primaryColor={pc}
              activeTextColor={activeTextColor}
            />
          </div>
        )}

        {/* Språk, varsler og meny er tilgjengelig på alle bredder. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <NotificationBell role={role} />
          <LanguageSwitcher />
          {showNav && (
            <button
              ref={toggleRef}
              type="button"
              onClick={() => setOpenMenuForPath(isMenuOpen ? null : pathname)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 text-2xl leading-none text-gray-700 transition hover:bg-gray-100"
              aria-label={
                isMenuOpen
                  ? t("components.header.closeMenu")
                  : t("components.header.openMenu")
              }
              aria-expanded={isMenuOpen}
              aria-controls={MENU_ID}
            >
              {isMenuOpen ? "✕" : "☰"}
            </button>
          )}
        </div>
      </div>

      {showBreadcrumbs && <Breadcrumbs pathname={pathname} />}

      {/* Globalt søk (ikke for kundeportalbrukere). På mobil er søket
          sammenklappet som standard, slik at det ikke spiser første skjerm. */}
      {showNav && !isCustomer && (
        <>
          <div className="hidden bg-white px-4 pb-4 pt-3 sm:block sm:px-6 lg:px-8">
            <GlobalSearch />
          </div>
          <div className="bg-white px-4 pb-3 pt-3 sm:hidden">
            <button
              type="button"
              onClick={() => setMobileSearchOpen((open) => !open)}
              aria-expanded={mobileSearchOpen}
              aria-controls="mobile-global-search"
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-bold text-gray-700 transition hover:bg-gray-100"
            >
              <span aria-hidden>🔍</span>
              <span className="flex-1 truncate">
                {t("components.header.search")}
              </span>
              <span aria-hidden className="text-xs text-gray-400">
                {mobileSearchOpen ? "▲" : "▼"}
              </span>
            </button>
            {mobileSearchOpen && (
              <div id="mobile-global-search" className="mt-2">
                <GlobalSearch />
              </div>
            )}
          </div>
        </>
      )}

      {/* Menyen er et ekte overlegg med dempet bakgrunn og låst sidescroll.
          Innholdet kan rulle, mens lyd og innstillinger ligger fast nederst. */}
      {showNav && isMenuOpen && (
        <div className="fixed inset-0 z-50">
          <div
            aria-hidden
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-[1px]"
          />
          <div
            ref={menuRef}
            id={MENU_ID}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${MENU_ID}-title`}
            className="absolute inset-y-0 right-0 flex w-[min(22rem,88vw)] flex-col overflow-hidden bg-white shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 p-4">
              <h2
                id={`${MENU_ID}-title`}
                className="text-sm font-bold text-gray-900"
              >
                {t("components.header.menu")}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeMenu}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 text-2xl leading-none text-gray-600 hover:bg-gray-100"
                aria-label={t("components.header.closeMenu")}
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {isCustomer ? (
                <GlobalNavMobile
                  items={primaryItems}
                  activeHref={activeHref}
                  primaryColor={pc}
                  activeTextColor={activeTextColor}
                  onNavigate={closeMenu}
                />
              ) : (
                <>
                  {primaryItems.length > 0 && (
                    <div className="lg:hidden">
                      <MenuHeading>
                        {t("components.header.work")}
                      </MenuHeading>
                      <GlobalNavMobile
                        items={primaryItems}
                        activeHref={activeHref}
                        primaryColor={pc}
                        activeTextColor={activeTextColor}
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
                        primaryColor={pc}
                        activeTextColor={activeTextColor}
                        onNavigate={closeMenu}
                      />
                    </div>
                  )}
                </>
              )}
              <LogoutButton
                onNavigate={closeMenu}
                className="mt-4 w-full rounded-xl border border-transparent px-4 py-3 text-left font-bold text-gray-700 transition hover:bg-red-50 hover:text-red-800 disabled:opacity-60"
              />
            </div>

            {(!isCustomer || settingsItem) && (
              <div className="shrink-0 border-t border-gray-200 bg-white p-4">
                <div className="flex flex-col gap-2">
                  {!isCustomer && (
                    <NotificationSoundToggle className="w-full justify-between" />
                  )}
                  {settingsItem && (
                    <NavLink
                      item={settingsItem}
                      isActive={activeHref === settingsItem.href}
                      primaryColor={pc}
                      activeTextColor={activeTextColor}
                      onNavigate={closeMenu}
                      mobile
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
    <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-gray-600">
      {children}
    </p>
  );
}

function breadcrumbLabel(
  segment: string,
  parent: string | undefined,
  translate: (key: string) => string,
): string {
  const key = BREADCRUMB_LABELS[segment];
  if (key) return translate(key);

  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();
  if (parent === "oppdrag" || /^\d+$/.test(decoded)) return `#${decoded}`;

  const words = decoded.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const t = useTranslations("common");
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav
      aria-label={t("components.header.breadcrumb")}
      className="border-b border-gray-100 bg-gray-50/60 px-4 py-1.5 sm:px-6 lg:px-8"
    >
      <ol className="flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
        <li className="shrink-0">
          <Link
            href="/"
            className="rounded font-medium transition hover:text-gray-900 hover:underline"
          >
            {t("nav.dashboard")}
          </Link>
        </li>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const label = breadcrumbLabel(segment, segments[index - 1], t);

          return (
            <li key={href} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="text-gray-300">
                /
              </span>
              {isLast ? (
                <span
                  aria-current="page"
                  className="truncate font-semibold text-gray-700"
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={href}
                  className="truncate rounded transition hover:text-gray-900 hover:underline"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function navLinkClass(isActive: boolean, mobile: boolean) {
  return [
    mobile
      ? "w-full px-4 py-3 rounded-xl text-sm font-bold transition-all text-left border border-transparent"
      : "px-2.5 xl:px-3 py-2 rounded-xl text-[13px] xl:text-sm font-medium transition-all whitespace-nowrap border border-transparent",
    isActive
      ? "font-bold shadow-sm"
      : mobile
        ? "text-gray-900 hover:bg-gray-100"
        : "text-gray-700 hover:bg-gray-50 hover:text-gray-900",
  ].join(" ");
}

function NavLink({
  item,
  isActive,
  primaryColor,
  activeTextColor,
  onNavigate,
  mobile,
}: {
  item: NavItem;
  isActive: boolean;
  primaryColor: string;
  activeTextColor: string;
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
      style={
        isActive
          ? { backgroundColor: primaryColor, color: activeTextColor }
          : undefined
      }
    >
      {item.icon && `${item.icon} `}
      {t(`nav.${item.labelKey}`)}
    </Link>
  );
}

function GlobalNavDesktop({
  items,
  activeHref,
  primaryColor,
  activeTextColor,
}: {
  items: NavItem[];
  activeHref: string | null;
  primaryColor: string;
  activeTextColor: string;
}) {
  const t = useTranslations("common");
  return (
    <nav
      className="flex flex-nowrap items-center gap-0.5 xl:gap-1"
      aria-label={t("components.header.menu")}
    >
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          isActive={activeHref === item.href}
          primaryColor={primaryColor}
          activeTextColor={activeTextColor}
          mobile={false}
        />
      ))}
    </nav>
  );
}

function GlobalNavMobile({
  items,
  activeHref,
  primaryColor,
  activeTextColor,
  onNavigate,
}: {
  items: NavItem[];
  activeHref: string | null;
  primaryColor: string;
  activeTextColor: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("common");
  return (
    <nav
      className="flex flex-col gap-2"
      aria-label={t("components.header.menu")}
    >
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          isActive={activeHref === item.href}
          primaryColor={primaryColor}
          activeTextColor={activeTextColor}
          onNavigate={onNavigate}
          mobile
        />
      ))}
    </nav>
  );
}
