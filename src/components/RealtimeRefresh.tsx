"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** Slår sammen raske hendelser til én oppdatering. */
const REFRESH_DEBOUNCE_MS = 300;

/** Begrenset gjenoppkobling: en 401/403 skal ikke gi en uendelig løkke. */
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type RealtimeEventDetail = {
  kind: string;
};

/** Eksportert for test: pause før neste forsøk, med litt jitter. */
export function reconnectDelayMs(attempt: number): number {
  const safe = Math.max(1, Math.floor(attempt));
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (safe - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/**
 * Lytter på `/api/events` og oppdaterer serverkomponentene når data endres.
 *
 * Oppdateringen utsettes når fanen er skjult, og kjøres én gang når den blir
 * synlig igjen. Hendelsen sendes også videre på `window` som `fsm:realtime`,
 * slik at for eksempel varsellyden kan reagere uten å eie forbindelsen.
 */
export default function RealtimeRefresh() {
  const router = useRouter();
  const t = useTranslations("common");
  const [paused, setPaused] = useState(false);
  const retryRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let dirty = false;
    let disposed = false;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const refresh = () => {
      if (disposed || !dirty) return;
      if (document.visibilityState === "hidden") return;
      dirty = false;
      router.refresh();
    };

    const schedule = (kind: string) => {
      if (disposed) return;
      window.dispatchEvent(
        new CustomEvent<RealtimeEventDetail>("fsm:realtime", {
          detail: { kind },
        }),
      );

      dirty = true;
      if (document.visibilityState === "hidden") return;

      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      clearTimer();
      refresh();
    };

    const onRefresh = (event: Event) => {
      const kind =
        event instanceof MessageEvent && typeof event.data === "string"
          ? event.data.trim()
          : "";
      schedule(kind || "all");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    const connect = () => {
      if (disposed) return;
      clearReconnect();
      retryRef.current = () => {
        reconnectAttempts = 0;
        connect();
      };

      // Vi lukker selv på feil og prøver på nytt med tak. EventSource sin
      // automatiske retry ville ellers fortsatt i det uendelige på 401/403.
      const current = new EventSource("/api/events");
      source = current;

      current.addEventListener("open", () => {
        reconnectAttempts = 0;
        setPaused(false);
      });
      current.addEventListener("refresh", onRefresh);
      current.addEventListener("error", () => {
        if (disposed) return;
        current.close();
        if (source === current) source = null;

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          // Etter flere mislykkede forsøk gir vi opp automatisk reconnect.
          // Brukeren får en synlig status og kan prøve igjen selv.
          setPaused(true);
          return;
        }
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(connect, reconnectDelayMs(reconnectAttempts));
      });
    };

    connect();

    return () => {
      disposed = true;
      clearTimer();
      clearReconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      source?.removeEventListener("refresh", onRefresh);
      source?.close();
      source = null;
    };
  }, [router]);

  if (!paused) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[65] flex max-w-[min(92vw,24rem)] items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950 shadow-lg"
    >
      <span aria-hidden="true">⏸️</span>
      <span className="flex-1">{t("components.realtime.paused")}</span>
      <button
        type="button"
        onClick={() => {
          setPaused(false);
          retryRef.current();
        }}
        className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-100"
      >
        {t("components.realtime.retry")}
      </button>
    </div>
  );
}
