"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import Icon from "@/components/icons";
import { isStandaloneDisplayMode } from "@/lib/pwa";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function subscribeDisplayMode(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener?.("change", callback);
  return () => query.removeEventListener?.("change", callback);
}

function readStandalone() {
  if (typeof window === "undefined") return false;
  return isStandaloneDisplayMode({
    displayModeStandalone:
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)").matches
        : false,
    navigatorStandalone: Boolean(
      (navigator as Navigator & { standalone?: boolean }).standalone,
    ),
  });
}

/**
 * Kort inngangslinje i feltmodus. Den samler dagens jobber, skanning og
 * nettstatus på ett sted, uten å duplisere oppdragslistens egne handlinger.
 */
export default function FieldModeStrip() {
  const t = useTranslations("common");
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const standalone = useSyncExternalStore(
    subscribeDisplayMode,
    readStandalone,
    () => false,
  );

  return (
    <div className="field-card flex flex-wrap items-center gap-2 p-2">
      <Link
        href="/skann"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-signal/40 bg-signal/10 px-3 text-sm font-black text-signal transition hover:bg-signal/20"
      >
        <Icon name="camera" className="h-4 w-4" />
        {t("fieldTools.scan")}
      </Link>
      <a
        href="#senere"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--field-line)] bg-surface/5 px-3 text-sm font-bold text-paper transition hover:border-signal/60 hover:bg-surface/10"
      >
        <Icon name="calendar" className="h-4 w-4" />
        {t("fieldTools.today")}
      </a>
      <Link
        href="/mine-oppdrag/kunder"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--field-line)] bg-surface/5 px-3 text-sm font-bold text-paper transition hover:border-signal/60 hover:bg-surface/10"
      >
        <Icon name="users" className="h-4 w-4" />
        {t("fieldTools.customers")}
      </Link>

      <span
        role="status"
        aria-live="polite"
        className={`ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-2xs font-black uppercase tracking-[0.12em] ${
          online ? "bg-signal/15 text-signal" : "bg-risk/15 text-risk"
        }`}
      >
        <Icon name={online ? "check" : "alert"} className="h-3.5 w-3.5" />
        {online ? t("fieldTools.online") : t("fieldTools.offline")}
      </span>
      {standalone && (
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface/10 px-2.5 text-2xs font-black text-paper/80">
          <Icon name="grid" className="h-3.5 w-3.5" />
          {t("fieldTools.installed")}
        </span>
      )}
    </div>
  );
}
