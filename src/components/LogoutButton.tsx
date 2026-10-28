"use client";

import { useState, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { clearOfflineCaches } from "@/lib/offline/cache";

/**
 * Logger ut gjennom next-auth sin egen signOut, som henter CSRF-token først.
 *
 * Den gamle headeren postet rett til `/api/auth/signout` uten CSRF-token. Da
 * svarte NextAuth med en feilside i stedet for å avslutte økten, og lokale
 * kladder/cacher ble liggende igjen. Her tømmes offline-data først, og
 * innloggingen sendes alltid til `/logg-inn` etterpå.
 */
export default function LogoutButton({
  className,
  onNavigate,
  children,
}: {
  className?: string;
  onNavigate?: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("common");
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    onNavigate?.();
    try {
      await clearOfflineCaches();
    } catch {
      // En nettleser uten IndexedDB/CacheStorage skal fortsatt kunne logge ut.
    }
    await signOut({ callbackUrl: "/logg-inn" });
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      aria-busy={busy}
      className={className}
    >
      {children ?? `🚪 ${t("components.header.logOut")}`}
    </button>
  );
}
