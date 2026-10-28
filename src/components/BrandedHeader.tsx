"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  navItemsFor,
  type NavItem,
} from "@/lib/navigation";

const MOBILE_MENU_ID = "mobile-navigation";

export default function BrandedHeader({
  title,
  showNav = true,
  role,
  permissions,
}: {
  title?: string;
  showNav?: boolean;
  role?: string;
  permissions?: string[];
}) {
  const t = useTranslations("common");
  const [branding, setBranding] = useState<{
    companyName: string;
    logoUrl: string | null;
    primaryColor: string;
  } | null>(null);
  // Mobilmenyen husker hvilken side den ble åpnet fra. Navigerer man videre til
  // en annen side stemmer ikke stien lenger, og menyen lukker seg av seg selv.
  const [openMenuForPath, setOpenMenuForPath] = useState<string | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const pathname = usePathname();
  const isMobileMenuOpen = openMenuForPath === pathname;
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const closeMobileMenu = () => setOpenMenuForPath(null);
  const isCustomer = role === "CUSTOMER";

  const navItems = useMemo(
    () => (showNav ? navItemsFor(role, permissions) : []),
    [role, permissions, showNav],
  );
  const activeHref = activeNavHref(navItems, pathname);

  // Innloggings- og kontosidene skal stå alene uten app-navigasjon.
  const isAuthRoute = [
    "/logg-inn",
    "/glemt-passord",
    "/tilbakestill-passord",
    "/aktiver-konto",
  ].some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    fetch("/api/branding")
      .then((res) => res.json())
      .then((b) => {
        const color = b.primaryColor || "#2563eb";
        setBranding({
          companyName: b.companyName || "FSM System",
          logoUrl: b.logoUrl || null,
          primaryColor: color,
        });
        setPrimaryColor(color);
        document.documentElement.style.setProperty("--primary-color", color);
      })
      .catch(() => {
        setBranding({
          companyName: "FSM System",
          logoUrl: null,
          primaryColor: "#2563eb",
        });
        document.documentElement.style.setProperty("--primary-color", "#2563eb");
      });
  }, []);

  // Fokus flyttes inn i menyen når den åpnes, og tilbake til knappen når den
  // lukkes. Selve menyen er en dialog, så Tab holder seg innenfor.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileMenu();
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
      closeMobileMenu();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    // Låser bakgrunnen mens menyen er åpen, slik at mobilen ikke scroller
    // innholdet under det faste overlegget.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (isMobileMenuOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      toggleRef.current?.focus();
    }
  }, [isMobileMenuOpen]);

  if (isAuthRoute) return null;

  const companyName = branding?.companyName || "FSM System";
  const logoUrl = branding?.logoUrl || null;
  const pc = branding?.primaryColor || primaryColor;
  const activeTextColor = readableTextColor(pc);

  return (
    <div className="flex flex-col gap-0">
      {/* Top bar: Logo + Company + Global Navigation */}
      <div className="flex justify-between items-center border-none outline-none py-3 px-4 sm:py-6 sm:px-6 lg:px-8 bg-white">
        {/* Logo + Company name (clickable to dashboard) - ALWAYS visible */}
        <Link
          href={isCustomer ? "/kundeportal" : "/"}
          className="flex items-center gap-3"
          suppressHydrationWarning
          style={{ color: pc }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              className="h-9 w-auto object-contain shrink-0 lg:max-w-[300px]"
            />
          ) : (
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0"
              suppressHydrationWarning
              style={{ backgroundColor: pc }}
            >
              {companyName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="hidden sm:block">
            {title && (
              <h1 className="text-xl font-black text-gray-900">{title}</h1>
            )}
            {!logoUrl && (
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                {companyName}
              </p>
            )}
          </div>
        </Link>

        {/* Desktop navigation */}
        {showNav && (
          <div className="hidden lg:flex gap-1">
            <GlobalNavDesktop
              items={navItems}
              activeHref={activeHref}
              primaryColor={pc}
              activeTextColor={activeTextColor}
              onLogout={closeMobileMenu}
            />
          </div>
        )}

        {/* Varsler og lyd er bare relevante for interne roller. Kundeportalen
            har ingen varsler i proxyen, så bjellen skjules helt der. */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <NotificationBell role={role} />
          {!isCustomer && (
            <div className="hidden sm:flex items-center gap-2">
              <NotificationSoundToggle compact />
              <LanguageSwitcher />
            </div>
          )}
          {showNav && (
            <button
              ref={toggleRef}
              type="button"
              onClick={() =>
                setOpenMenuForPath(isMobileMenuOpen ? null : pathname)
              }
              className="lg:hidden flex min-h-11 min-w-11 items-center justify-center p-2.5 text-2xl leading-none text-gray-700 hover:bg-gray-100 rounded-xl transition"
              aria-label={
                isMobileMenuOpen
                  ? t("components.header.closeMenu")
                  : t("components.header.openMenu")
              }
              aria-expanded={isMobileMenuOpen}
              aria-controls={MOBILE_MENU_ID}
            >
              {isMobileMenuOpen ? "✕" : "☰"}
            </button>
          )}
        </div>
      </div>

      {/* Globalt søk (ikke for kundeportalbrukere). På mobil er søket
          sammenklappet som standard, slik at det ikke spiser første skjerm. */}
      {showNav && !isCustomer && (
        <>
          <div className="hidden px-4 pb-4 sm:block sm:px-6 lg:px-8 bg-white">
            <GlobalSearch />
          </div>
          <div className="px-4 pb-3 sm:hidden bg-white">
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

      {/* Mobilmenyen er et ekte overlegg: fast posisjon, bakgrunn som dempes
          og låst sidescroll. Den dytter ikke innholdet ned. */}
      {showNav && isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-[1px]"
          />
          <div
            ref={menuRef}
            id={MOBILE_MENU_ID}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${MOBILE_MENU_ID}-title`}
            className="absolute inset-y-0 right-0 flex w-[min(22rem,88vw)] flex-col overflow-y-auto bg-white p-4 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-4">
              <h2
                id={`${MOBILE_MENU_ID}-title`}
                className="font-bold text-gray-900 text-sm"
              >
                {t("components.header.menu")}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeMobileMenu}
                className="flex min-h-11 min-w-11 items-center justify-center text-2xl leading-none text-gray-600 hover:bg-gray-100 rounded-xl p-2.5"
                aria-label={t("components.header.closeMenu")}
              >
                ✕
              </button>
            </div>
            <GlobalNavMobile
              items={navItems}
              activeHref={activeHref}
              primaryColor={pc}
              activeTextColor={activeTextColor}
              onNavigate={closeMobileMenu}
            />
            {!isCustomer && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  href="/varsler"
                  onClick={closeMobileMenu}
                  className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-100"
                >
                  🔔 {t("p3.notifications.title")}
                </Link>
                {navItems.some((item) => item.href === "/innstillinger") && (
                  <Link
                    href="/innstillinger"
                    onClick={closeMobileMenu}
                    className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-100"
                  >
                    ⚙️ {t("settings.title")}
                  </Link>
                )}
              </div>
            )}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3">
              {!isCustomer && <NotificationSoundToggle />}
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function navLinkClass(isActive: boolean, mobile: boolean) {
  return [
    mobile
      ? "w-full px-4 py-3 rounded-xl text-sm font-bold transition-all text-left border border-transparent"
      : "px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap border border-transparent",
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
  onLogout,
}: {
  items: NavItem[];
  activeHref: string | null;
  primaryColor: string;
  activeTextColor: string;
  onLogout?: () => void;
}) {
  const t = useTranslations("common");
  return (
    <nav className="flex gap-1 flex-wrap" aria-label={t("components.header.menu")}>
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
      <LogoutButton
        onNavigate={onLogout}
        className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition border border-transparent whitespace-nowrap disabled:opacity-60"
      />
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
    <nav className="flex flex-col gap-2" aria-label={t("components.header.menu")}>
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
      <LogoutButton
        onNavigate={onNavigate}
        className="w-full px-4 py-3 rounded-xl text-left font-bold text-gray-700 hover:bg-red-50 hover:text-red-800 transition border border-transparent disabled:opacity-60"
      />
    </nav>
  );
}
