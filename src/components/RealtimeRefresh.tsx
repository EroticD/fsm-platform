"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Slår sammen raske hendelser til én oppdatering. */
const REFRESH_DEBOUNCE_MS = 300;

export type RealtimeEventDetail = {
  kind: string;
};

/**
 * Lytter på `/api/events` og oppdaterer serverkomponentene når data endres.
 *
 * Oppdateringen utsettes når fanen er skjult, og kjøres én gang når den blir
 * synlig igjen. Hendelsen sendes også videre på `window` som `fsm:realtime`,
 * slik at for eksempel varsellyden kan reagere uten å eie forbindelsen.
 */
export default function RealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    let disposed = false;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
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

    // EventSource kobler automatisk til på nytt ved nettverksfeil.
    source = new EventSource("/api/events");
    source.addEventListener("refresh", onRefresh);

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      source?.removeEventListener("refresh", onRefresh);
      source?.close();
      source = null;
    };
  }, [router]);

  return null;
}
