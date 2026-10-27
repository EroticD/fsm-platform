"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  NOTIFICATION_REALTIME_EVENT,
  ensureAudioContext,
  isNotificationRealtimeKind,
  playNotificationSound,
  resumeAudioContext,
  shouldPlayNotificationSound,
} from "@/lib/notification-sound";
import { isNotificationSoundEnabled } from "@/lib/notification-sound-preference";

/**
 * Bjelle i headeren med antall uleste varsler. Poller hvert minutt som
 * fallback, og henter på nytt når realtime-laget varsler om endringer.
 * Spiller en kort lyd når antallet øker etter første innlasting.
 */
export default function NotificationBell() {
  const t = useTranslations("common");
  const [count, setCount] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousCountRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    let latestRequest = 0;

    const load = async () => {
      const request = ++latestRequest;
      try {
        const response = await fetch("/api/notifications/unread");
        if (!response.ok) return;
        const data = await response.json();
        // Ignorer svar som er eldre enn det nyeste, slik at et realtidsvarsel
        // ikke blir overstyrt av en tidligere poll.
        if (!active || request !== latestRequest) return;
        const next = Number(data.count) || 0;
        setCount(next);
        if (
          shouldPlayNotificationSound(previousCountRef.current, next) &&
          isNotificationSoundEnabled()
        ) {
          playNotificationSound(audioContextRef.current);
        }
        previousCountRef.current = next;
      } catch {
        // Nettverksfeil skal ikke påvirke resten av headeren.
      }
    };

    const onRealtime = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: unknown } | undefined>).detail;
      if (isNotificationRealtimeKind(detail?.kind)) void load();
    };

    void load();
    const interval = window.setInterval(load, 60_000);
    window.addEventListener(NOTIFICATION_REALTIME_EVENT, onRealtime);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(NOTIFICATION_REALTIME_EVENT, onRealtime);
    };
  }, []);

  useEffect(() => {
    // Nettlesere blokkerer lyd til brukeren har samhandlet med siden. Lås opp
    // AudioContext på første gesture, og slutt å lytte når det er gjort.
    const unlock = () => {
      audioContextRef.current = ensureAudioContext(audioContextRef.current);
      resumeAudioContext(audioContextRef.current);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };

    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      try {
        void audioContextRef.current?.close();
      } catch {
        // Ignorer feil ved lukking.
      }
      audioContextRef.current = null;
    };
  }, []);

  return (
    <Link
      href="/varsler"
      aria-label={count > 0 ? t("p3.bell.unread", { count }) : t("p3.bell.label")}
      className="relative flex h-11 w-11 items-center justify-center rounded-xl text-xl text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      🔔
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-5 text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
