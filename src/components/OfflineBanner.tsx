"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  clearOfflineUserData,
  flushDraftOutbox,
  OUTBOX_CHANGED_EVENT,
  pendingDraftSummary,
  rememberOfflineUser,
  retryFailedDrafts,
  type DraftSummary,
} from "@/lib/offline/draft-outbox";
import { announceOfflineUser } from "@/lib/offline/cache";

/**
 * Viser offline-status og hvor mange kladder som venter på sending.
 *
 * Telleren er unionen av lokale kladder med usendte endringer og outboxen, slik
 * at en kladd som bare rakk å bli skrevet til IndexedDB også vises. Banneret
 * tømmer outboxen ved oppstart, når nettet kommer tilbake, og med jevne
 * mellomrom – men aldri oftere enn retry-policyen i outboxen tillater.
 *
 * Banneret er sticky, slik at statusen er synlig også når montøren har scrollet
 * ned i et langt skjema. Hvis nettleseren mangler IndexedDB/CacheStorage, sier
 * det tydelig fra at lokale kladder ikke kan lagres.
 */
export default function OfflineBanner({ userId }: { userId?: string | null }) {
  const t = useTranslations("common");
  const [summary, setSummary] = useState<DraftSummary>({
    pending: 0,
    failed: 0,
  });
  const [retrying, setRetrying] = useState(false);
  const flushing = useRef(false);

  const online = useSyncExternalStore(
    (callback) => {
      window.addEventListener("online", callback);
      window.addEventListener("offline", callback);
      return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
      };
    },
    () => navigator.onLine,
    () => true,
  );

  // Capability detection som en ekstern store, så vi ikke setter state i en
  // effect. Serveren antar at lagring finnes; banneret er uansett skjult til
  // det finnes ventende kladder eller nettet er borte.
  const storageSupported = useSyncExternalStore(
    () => () => undefined,
    () => typeof indexedDB !== "undefined" && typeof caches !== "undefined",
    () => true,
  );

  // Ved innlogging bekrefter vi hvilken bruker som eier de lokale kladdene, og
  // hvilken bruker service workeren skal scope side-cachen til.
  useEffect(() => {
    if (!userId) return;
    rememberOfflineUser(userId);
    announceOfflineUser(userId);
  }, [userId]);

  const refresh = useCallback(async () => {
    setSummary(await pendingDraftSummary());
  }, []);

  const flushAndRefresh = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      if (!navigator.onLine) {
        await refresh();
        return;
      }
      await flushDraftOutbox();
      await refresh();
    } finally {
      flushing.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    // Etter vellykket rapportinnsending kan outboxen inneholde en gammel kladd
    // for den samme rapporten. La ryddekomponenten fjerne den først, så vi ikke
    // replayer stale data over den signerte rapporten.
    const awaitingReportCleanup = new URLSearchParams(
      window.location.search,
    ).has("reportSubmitted");

    if (awaitingReportCleanup) {
      void Promise.resolve().then(refresh);
    } else {
      void Promise.resolve().then(flushAndRefresh);
    }

    const onOnline = () => void flushAndRefresh();
    // En lokal lagring legger kladden i outboxen. Da skal telleren oppdateres,
    // men vi skal ikke sende for hvert tastetrykk.
    const onOutboxChanged = () => void refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged);
    const interval = window.setInterval(() => {
      if (navigator.onLine) void flushAndRefresh();
      else void refresh();
    }, 30_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged);
      window.clearInterval(interval);
    };
  }, [flushAndRefresh, refresh, userId]);

  const retryNow = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (summary.failed > 0) await retryFailedDrafts();
      else await flushDraftOutbox();
      await refresh();
    } finally {
      setRetrying(false);
    }
  };

  const discardDrafts = async () => {
    if (retrying) return;
    if (!window.confirm(t("p3.offline.discardConfirm"))) return;
    setRetrying(true);
    try {
      await clearOfflineUserData();
      await refresh();
    } finally {
      setRetrying(false);
    }
  };

  const total = summary.pending + summary.failed;
  if (online && (total === 0 || !storageSupported)) return null;

  const statusText = !storageSupported
    ? t("p3.offline.noStorage")
    : !online && total > 0
      ? t("p3.offline.offlineWithPending", { count: total })
      : !online
        ? t("p3.offline.offline")
        : summary.pending > 0 && summary.failed > 0
          ? `${t("p3.offline.pending", { count: summary.pending })} · ${t("p3.offline.failed", { count: summary.failed })}`
          : summary.failed > 0
            ? t("p3.offline.failed", { count: summary.failed })
            : t("p3.offline.pending", { count: summary.pending });

  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-50 border-b px-4 py-2 text-xs font-bold backdrop-blur ${
        online
          ? "border-blue-200 bg-blue-50/95 text-blue-900"
          : "border-amber-300 bg-amber-50/95 text-amber-950"
      }`}
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span>{statusText}</span>
        {(!online || total > 0) && storageSupported && (
          <a
            href="/offline.html"
            className="underline decoration-2 underline-offset-2 hover:no-underline"
          >
            {t("p3.offline.openDrafts")}
          </a>
        )}
        {online && total > 0 && storageSupported && (
          <button
            type="button"
            onClick={() => void retryNow()}
            disabled={retrying}
            className="rounded-lg border border-current px-2.5 py-1 font-black transition hover:bg-white/60 disabled:opacity-60"
          >
            {retrying
              ? t("p3.offline.retrying")
              : summary.failed > 0
                ? t("p3.offline.retryFailed")
                : t("p3.offline.retryNow")}
          </button>
        )}
        {total > 0 && storageSupported && (
          <button
            type="button"
            onClick={() => void discardDrafts()}
            disabled={retrying}
            className="underline decoration-2 underline-offset-2 opacity-80 hover:opacity-100 disabled:opacity-60"
          >
            {t("p3.offline.discardDrafts")}
          </button>
        )}
      </div>
    </div>
  );
}
