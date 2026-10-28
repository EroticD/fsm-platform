"use client";

import { useState, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { clearOfflineCaches } from "@/lib/offline/cache";

/**
 * Logger ut gjennom next-auth sin egen signOut, som henter CSRF-token først.
 *
 * Ved utlogging ryddes service-worker-cacher og nylige søk, men ventende
 * kladder beholdes på enheten under brukerens id. De er uferdig arbeid som
 * ellers ville gått tapt, og de kan verken leses eller sendes av en annen
 * bruker. Innloggingen sendes alltid til `/logg-inn` etterpå.
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
