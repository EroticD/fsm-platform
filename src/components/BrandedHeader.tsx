"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "./LanguageSwitcher";import GlobalSearch from "./GlobalSearch";

type NavItem = {
  href: string;
  label?: string;
  labelKey?: string;
  icon: string;
};

// Kontor og admin: full oversikt, inkludert kontorverktøyene.
const NAV_ITEMS: NavItem[] = [
  { href: "/", labelKey: "dashboard", icon: "🏠" },
  { href: "/mine-oppdrag", labelKey: "myWorkOrders", icon: "📋" },
  { href: "/kalender", labelKey: "calendar", icon: "📅" },
  { href: "/kunder", labelKey: "customers", icon: "🏢" },
  { href: "/dokumenter", labelKey: "documents", icon: "📚" },
  { href: "/oppdrag/ny", labelKey: "newWorkOrder", icon: "" },
  { href: "/innstillinger", labelKey: "settings", icon: "⚙️" },
];

// Montører: alt som er relevant ute hos kunden – kundeinfo, oppdrag, enheter og
// rapporter. Dispatch, ansatte, maler og innstillinger er kontorverktøy og
// utelates helt, slik at menyen ikke peker på sider de ikke kommer inn på.
const TECHNICIAN_NAV: NavItem[] = [
  { href: "/", labelKey: "dashboard", icon: "🏠" },
  { href: "/mine-oppdrag", labelKey: "myWorkOrders", icon: "📋" },
  { href: "/oppdrag", labelKey: "workOrders", icon: "📂" },
  { href: "/kalender", labelKey: "calendar", icon: "📅" },
  { href: "/kunder", labelKey: "customers", icon: "🏢" },
  { href: "/dokumenter", labelKey: "documents", icon: "📚" },
  { href: "/enheter", labelKey: "equipment", icon: "🔧" },
  { href: "/rapporter", labelKey: "reports", icon: "📄" },
  { href: "/mine-oppdrag/ny", labelKey: "newWorkOrder", icon: "" },
];

// Kundeportalbrukere har bare sin egen portal.
const CUSTOMER_NAV: NavItem[] = [
  { href: "/kundeportal", labelKey: "customerPortal", icon: "👤" },
];

function navItemsFor(role?: string): NavItem[] {
  if (role === "TECHNICIAN") return TECHNICIAN_NAV;
  if (role === "CUSTOMER") return CUSTOMER_NAV;
  return NAV_ITEMS;
}

export default function BrandedHeader({
  title,
  showNav = true,
  role,
}: {
  title?: string;
  showNav?: boolean;
  role?: string;
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
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const pathname = usePathname();
  const isMobileMenuOpen = openMenuForPath === pathname;
  const closeMobileMenu = () => setOpenMenuForPath(null);

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

  if (isAuthRoute) return null;

  const companyName = branding?.companyName || "FSM System";
  const logoUrl = branding?.logoUrl || null;
  const pc = branding?.primaryColor || primaryColor;

  return (
    <div className="flex flex-col gap-0">
      {/* Top bar: Logo + Company + Global Navigation */}
      <div
        className="flex justify-between items-center border-none outline-none py-6 px-4 sm:px-6 lg:px-8 bg-white"
      >
        {/* Logo + Company name (clickable to dashboard) - ALWAYS visible */}
        <Link
          href="/"
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

        {/* Mobile hamburger menu button */}
        {showNav && (
          <button
            type="button"
            onClick={() => setOpenMenuForPath(isMobileMenuOpen ? null : pathname)}
            className="lg:hidden flex items-center justify-center p-2.5 text-2xl leading-none text-gray-600 hover:bg-gray-100 rounded-xl transition"
            aria-label={t("components.header.openMenu")}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? "✕" : "☰"}
          </button>
        )}

        {/* Desktop navigation */}
        {showNav && (
          <div className="hidden lg:flex gap-1">
            <GlobalNavDesktop primaryColor={pc} role={role} />
          </div>
        )}

        {/* Language switcher */}
        <div className="hidden lg:flex items-center">
          <LanguageSwitcher />
        </div>
      </div>

      {/* Globalt søk (ikke for kundeportalbrukere) */}
      {showNav && role !== "CUSTOMER" && (
        <div className="px-4 sm:px-6 lg:px-8 pb-4 bg-white">
          <GlobalSearch />
        </div>
      )}

      {/* Mobile navigation drawer */}
      {showNav && isMobileMenuOpen && (
        <div className="lg:hidden px-4 pb-4 border-b border-gray-200 bg-gray-50">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-900 text-sm">{t("components.header.menu")}</h3>
            <button
              type="button"
              onClick={closeMobileMenu}
              className="flex items-center justify-center text-2xl leading-none text-gray-600 hover:bg-gray-100 rounded-xl p-2.5"
              aria-label={t("components.header.closeMenu")}
            >
              ✕
            </button>
          </div>
          <GlobalNavMobile primaryColor={pc} onNavigate={closeMobileMenu} role={role} />
          <div className="mt-4 pt-4 border-t border-gray-200">
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalNavDesktop({ primaryColor, role }: { primaryColor: string; role?: string }) {
  const pathname = usePathname();
  const t = useTranslations("common");
  const items = navItemsFor(role);
  return (
    <nav className="flex gap-1 flex-wrap">
      {items.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap border border-transparent ${isActive ? `bg-[${primaryColor}] text-gray-900 font-bold shadow-sm` : "text-gray-900 hover:bg-gray-50 hover:text-gray-900"}`}
          >
            {item.icon && `${item.icon} `}
            {item.labelKey ? t(`nav.${item.labelKey}`) : item.label}
          </Link>
        )}
      )}
      <form action="/api/auth/signout" method="POST" className="flex items-center">
        <button type="submit" className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition border border-transparent whitespace-nowrap">
          🚪 {t("components.header.logOut")}
        </button>
      </form>
    </nav>
  );
}

function GlobalNavMobile({
  primaryColor,
  onNavigate,
  role,
}: {
  primaryColor: string;
  onNavigate?: () => void;
  role?: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("common");
  const items = navItemsFor(role);
  return (
    <nav className="flex flex-col gap-2">
      {items.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`w-full px-4 py-3 rounded-xl text-sm font-bold transition-all text-left border border-transparent ${isActive ? `bg-[${primaryColor}] text-gray-900 font-bold shadow-sm` : "text-gray-900 hover:bg-gray-100 hover:text-gray-900"}`}
          >
            {item.icon && `${item.icon} `}
            {item.labelKey ? t(`nav.${item.labelKey}`) : item.label}
          </Link>
        )}
      )}
      <form action="/api/auth/signout" method="POST" className="w-full flex items-center">
        <button
          type="submit"
          onClick={onNavigate}
          className="w-full px-4 py-3 rounded-xl text-left font-bold text-gray-700 hover:bg-red-50 hover:text-red-800 transition border border-transparent"
        >
          🚪 {t("components.header.logOut")}
        </button>
      </form>
    </nav>
  );
}
