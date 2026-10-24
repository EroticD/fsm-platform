"use client";

import { useEffect, useState } from "react";
import {
  flushDraftOutbox,
  pendingDraftCount,
} from "@/lib/offline/draft-outbox";

/**
 * Viser offline-status og hvor mange kladder som venter på sending.
 * Outboxen tømmes automatisk når nettverket kommer tilbake.
 */
export default function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const refresh = async () => {
      setPending(await pendingDraftCount());
    };

    const goOnline = async () => {
      setOnline(true);
      await flushDraftOutbox();
      await refresh();
    };

    const goOffline = () => setOnline(false);

    setOnline(navigator.onLine);
    void refresh();
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const interval = window.setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 10_000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
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
        ? `📤 ${pending} kladd${pending === 1 ? "" : "er"} venter på sending`
        : "📴 Du er offline – kladder lagres lokalt og sendes når nettet er tilbake"}
    </div>
  );
}
