"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "./icons";
import LogoutButton from "./LogoutButton";
import {
  activeNavHref,
  homePathForRole,
  isAuthPath,
  menuNavFor,
  navItemsFor,
  primaryNavFor,
  settingsNavItem,
  type NavItem,
} from "@/lib/navigation";

/**
 * Fast venstrelinje for kontor og administrasjon på brede skjermer.
 *
 * Linjen eier den primære navigasjonen når den er synlig. Topplinjen i
 * BrandedHeader skjuler da logo og den gamle hovedmenyen, slik at det bare
 * finnes én kilde til navigasjon. På mobil er linjen skjult og den eksisterende
 * bunnlinjen og hamburgermenyen brukes som før.
 */
export default function OfficeRail({
  role,
  permissions,
  companyName = "FSM System",
  logoUrl = null,
  userName = null,
  userEmail = null,
}: {
  role?: string | null;
  permissions?: string[];
  companyName?: string;
  logoUrl?: string | null;
  userName?: string | null;
  userEmail?: string | null;
}) {
  const t = useTranslations("common");
  const pathname = usePathname();
  // Innloggings- og kontosidene skal stå alene, også for en innlogget
  // kontorbruker som åpner dem direkte.
  if (isAuthPath(pathname)) return null;
  const items = navItemsFor(role, permissions);
  const primaryItems = primaryNavFor(items);
  const menuItems = menuNavFor(items);
  const quickCreate = menuItems.find((item) => item.href === "/oppdrag/ny");
  const secondaryItems = menuItems.filter(
    (item) => item.href !== "/oppdrag/ny",
  );
  const settingsItem = settingsNavItem(items);
  const rawActiveHref = activeNavHref(items, pathname);
  // «/oppdrag/ny» er en handling, ikke et eget arbeidsområde. Når den er aktiv
  // markerer vi fortsatt «Oppdrag» i hovedgruppen, mens hurtigknappen får
  // aria-current for seg selv.
  const primaryMatch = activeNavHref(primaryItems, pathname);
  const activeHref =
    quickCreate && rawActiveHref === quickCreate.href
      ? (primaryMatch ?? rawActiveHref)
      : rawActiveHref;
  const workspace =
    role === "ADMIN"
      ? t("components.header.adminWorkspace")
      : t("components.header.officeWorkspace");
  const displayName = userName?.trim() || userEmail?.trim() || "";
  const initials = getInitials(displayName);

  function focusSearch() {
    // GlobalSearch lytter allerede på ⌘K/Ctrl+K. Den samme snarveien brukes
    // her, slik at den pinned knappen fokuserer søket i topplinjen – eller
    // søkefeltet på /sok – uten en ekstra søkeimplementasjon.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      }),
    );
  }

  return (
    <aside
      aria-label={t("components.header.officeNavigation")}
      className="office-rail fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col lg:flex"
    >
      <div className="shrink-0 border-b border-white/10 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <Link
          href={homePathForRole(role)}
          className="flex min-w-0 items-center gap-3 rounded-xl"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              className="h-9 w-auto max-w-[136px] shrink-0 object-contain"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-signal text-lg font-bold text-ink">
              {companyName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-paper">
              {companyName}
            </span>
            <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
              {workspace}
            </span>
          </span>
        </Link>
      </div>

      {quickCreate && (
        <div className="shrink-0 px-3 pt-4">
          <Link
            href={quickCreate.href}
            aria-current={
              rawActiveHref === quickCreate.href ? "page" : undefined
            }
            className="signal-button w-full"
          >
            <Icon name="plus" className="h-4 w-4" />
            {t(`nav.${quickCreate.labelKey}`)}
          </Link>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {primaryItems.length > 0 && (
          <RailGroup
            label={t("components.header.workspace")}
            items={primaryItems}
            activeHref={activeHref}
          />
        )}
        {(secondaryItems.length > 0 || settingsItem) && (
          <div className={primaryItems.length > 0 ? "mt-6" : undefined}>
            <RailGroup
              label={t("components.header.tools")}
              items={[
                ...secondaryItems,
                ...(settingsItem ? [settingsItem] : []),
              ]}
              activeHref={activeHref}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={focusSearch}
          aria-keyshortcuts="Meta+K Control+K"
          className="rail-link w-full"
        >
          <kbd
            aria-hidden
            className="shrink-0 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/70"
          >
            ⌘K
          </kbd>
          <span className="truncate">{t("nav.search")}</span>
        </button>

        <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/[0.04] p-2">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal text-xs font-bold text-ink"
          >
            {initials || <Icon name="user" className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-paper">
              {displayName || t("components.header.user")}
            </span>
            {userEmail && (
              <span className="block truncate text-[11px] text-white/50">
                {userEmail}
              </span>
            )}
          </span>
          <LogoutButton className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-white/60 transition hover:bg-red-500/15 hover:text-red-200 disabled:opacity-50">
            <Icon name="logout" className="h-5 w-5" />
            <span className="sr-only">
              {t("components.header.logOut")}
            </span>
          </LogoutButton>
        </div>
      </div>
    </aside>
  );
}

function RailGroup({
  label,
  items,
  activeHref,
}: {
  label: string;
  items: NavItem[];
  activeHref: string | null;
}) {
  const t = useTranslations("common");
  return (
    <nav aria-label={label}>
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
        {label}
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const isActive = activeHref === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`rail-link ${isActive ? "rail-active" : ""}`}
              >
                <span
                  aria-hidden
                  className="flex w-5 shrink-0 items-center justify-center"
                >
                  <Icon name={item.icon} className="h-[18px] w-[18px]" />
                </span>
                <span className="truncate">{t(`nav.${item.labelKey}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
