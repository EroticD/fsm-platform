"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  flushDraftOutbox,
  pendingDraftCount,
} from "@/lib/offline/draft-outbox";

/**
 * Viser offline-status og hvor mange kladder som venter på sending.
 * Outboxen tømmes automatisk når nettverket kommer tilbake.
 */
export default function OfflineBanner() {
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

  useEffect(() => {
    const refresh = async () => {
      setPending(await pendingDraftCount());
    };

    const goOnline = async () => {
      await flushDraftOutbox();
      await refresh();
    };

    void refresh();
    window.addEventListener("online", goOnline);
    const interval = window.setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 10_000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.clearInterval(interval);
    };
  }, []);

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
