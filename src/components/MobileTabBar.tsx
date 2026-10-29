"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  isAuthPath,
  isMobileTabActive,
  mobileTabItemsFor,
  OPEN_MENU_EVENT,
  type NavItem,
} from "@/lib/navigation";

/**
 * Fast bunnlinje på mobil (< lg). «Mer» åpner den samme menyen som
 * hamburgerknappen i toppen, slik at det bare finnes én dialog med fokusfelle
 * og retur av fokus. Linjen skjules for kundeportalen og innloggingssidene.
 */
export default function MobileTabBar({
  role,
  permissions,
}: {
  role?: string | null;
  permissions?: string[];
}) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const items = mobileTabItemsFor(role, permissions);

  if (
    role === "CUSTOMER" ||
    isAuthPath(pathname) ||
    pathname.startsWith("/kundeportal") ||
    items.length === 0
  ) {
    return null;
  }

  const hasActiveTab = items.some((item) =>
    isMobileTabActive(item.href, pathname),
  );

  function openMenu() {
    window.dispatchEvent(
      new CustomEvent(OPEN_MENU_EVENT, {
        detail: { opener: menuButtonRef.current },
      }),
    );
  }

  return (
    <nav
      aria-label={t("components.header.menu")}
      className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-4">
        {items.map((item) => (
          <TabLink key={item.href} item={item} pathname={pathname} />
        ))}
        <button
          ref={menuButtonRef}
          type="button"
          onClick={openMenu}
          aria-haspopup="dialog"
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-bold transition ${
            hasActiveTab ? "text-gray-600 hover:bg-gray-50" : "text-gray-900"
          }`}
          style={
            hasActiveTab
              ? undefined
              : { color: "var(--primary-color, #2563eb)" }
          }
        >
          <span aria-hidden className="text-xl leading-none">
            ☰
          </span>
          <span className="truncate">{t("components.header.more")}</span>
        </button>
      </div>
    </nav>
  );
}

function TabLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const t = useTranslations("common");
  const isActive = isMobileTabActive(item.href, pathname);

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-bold transition ${
        isActive
          ? "text-gray-900"
          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      }`}
      style={isActive ? { color: "var(--primary-color, #2563eb)" } : undefined}
    >
      <span aria-hidden className="text-xl leading-none">
        {item.icon}
      </span>
      <span className="truncate">{t(`nav.${item.labelKey}`)}</span>
    </Link>
  );
}
