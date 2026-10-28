"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  flushDraftOutbox,
  OUTBOX_CHANGED_EVENT,
  pendingDraftCount,
  rememberOfflineUser,
} from "@/lib/offline/draft-outbox";

/**
 * Viser offline-status og hvor mange kladder som venter på sending.
 * Outboxen tømmes ved oppstart når nettet er tilbake, og når nettverket
 * skifter til online – ikke bare i det siste tilfellet. Ellers ville en kladd
 * som ble liggende fra forrige økt stå fast til neste nettbrudd.
 */
export default function OfflineBanner({ userId }: { userId?: string | null }) {
  const t = useTranslations("common");
  const [pending, setPending] = useState(0);
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

  // Ved innlogging bekrefter vi hvilken bruker som eier de lokale kladdene.
  // Først da kan outboxen sendes – aldri på vegne av forrige bruker.
  useEffect(() => {
    if (userId) rememberOfflineUser(userId);
  }, [userId]);

  useEffect(() => {
    const refresh = async () => {
      setPending(await pendingDraftCount());
    };

    const flushAndRefresh = async () => {
      if (!navigator.onLine) {
        await refresh();
        return;
      }
      await flushDraftOutbox();
      await refresh();
    };

    // Etter vellykket rapportinnsending kan outboxen inneholde en gammel kladd
    // for den samme rapporten. La ryddekomponenten fjerne den først, så vi ikke
    // replayer stale data over den signerte rapporten.
    const awaitingReportCleanup = new URLSearchParams(
      window.location.search,
    ).has("reportSubmitted");

    if (awaitingReportCleanup) {
      void refresh();
    } else {
      void flushAndRefresh();
    }
    window.addEventListener("online", flushAndRefresh);
    // Outboxen kan tømmes av rapportskjemaet etter vellykket innsending.
    // Da skal telleren nullstilles med en gang, ikke ved neste intervall.
    window.addEventListener(OUTBOX_CHANGED_EVENT, flushAndRefresh);
    const interval = window.setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 10_000);

    return () => {
      window.removeEventListener("online", flushAndRefresh);
      window.removeEventListener(OUTBOX_CHANGED_EVENT, flushAndRefresh);
      window.clearInterval(interval);
    };
  }, [userId]);

  if (online && pending === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`px-4 py-2 text-center text-xs font-bold ${
        online
          ? "bg-blue-50 text-blue-800 border-b border-blue-200"
          : "bg-amber-50 text-amber-900 border-b border-amber-200"
      }`}
    >
      {online
        ? t("p3.offline.pending", { count: pending })
        : t("p3.offline.offline")}
    </div>
  );
}
