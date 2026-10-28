"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTimeLocalized } from "@/lib/dates";
import { relativeTimeLabel } from "@/lib/notification-time";
import { notificationTypePresentation } from "@/lib/notification-display";
import {
  NOTIFICATION_REALTIME_EVENT,
  ensureAudioContext,
  isNotificationRealtimeKind,
  playNotificationSound,
  resumeAudioContext,
  shouldPlayNotificationSound,
} from "@/lib/notification-sound";
import { isNotificationSoundEnabled } from "@/lib/notification-sound-preference";
import { markAllReadAction, markReadAction } from "@/app/varsler/actions";

type RecentNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  sourceLabel: string | null;
  hasTarget: boolean;
  readAt: string | null;
  createdAt: string;
};

/**
 * Bjelle med popover for de siste varslene. Antallet polles hvert minutt som
 * fallback, og oppdateres umiddelbart etter «merk som lest». Selve
 * varselkortene er vanlige lenker, slik at midtklikk og ny fane virker.
 */
export default function NotificationBell({ role }: { role?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const isCustomer = role === "CUSTOMER";
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<RecentNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousCountRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    if (isCustomer) return;
    try {
      const response = await fetch("/api/notifications/unread");
      if (!response.ok) return;
      const data = await response.json();
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
  }, [isCustomer]);

  const loadRecent = useCallback(async () => {
    if (isCustomer) return;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch("/api/notifications/recent");
      if (!response.ok) throw new Error("Kunne ikke hente varsler");
      const data = await response.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      const next = Number(data.count) || 0;
      setCount(next);
      previousCountRef.current = next;
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [isCustomer]);

  useEffect(() => {
    if (isCustomer) return;
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
  }, [isCustomer]);

  useEffect(() => {
    if (isCustomer) return;
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
  }, [isCustomer]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) void loadRecent();
      return next;
    });
  };

  const markOneRead = (notification: RecentNotification) => {
    if (notification.readAt) return;
    setCount((current) => Math.max(0, current - 1));
    setItems((current) =>
      current.map((item) =>
        item.id === notification.id
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );

    const formData = new FormData();
    formData.set("id", notification.id);
    void markReadAction(formData)
      .then((result) => {
        if (!result.ok) void loadRecent();
        else void loadCount();
      })
      .catch(() => void loadRecent());
  };

  const markAllRead = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    const previousItems = items;
    setCount(0);
    setItems((current) =>
      current.map((item) => ({
        ...item,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    );
    try {
      const result = await markAllReadAction();
      if (!result.ok) {
        setItems(previousItems);
        void loadRecent();
      } else {
        await loadCount();
      }
    } catch {
      setItems(previousItems);
      void loadRecent();
    } finally {
      setMarkingAll(false);
    }
  };

  if (isCustomer) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={
          count > 0 ? t("p3.bell.unread", { count }) : t("p3.bell.label")
        }
        aria-expanded={open}
        aria-controls="notification-popover"
        aria-haspopup="dialog"
        className="relative flex h-11 w-11 items-center justify-center rounded-xl text-xl text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-5 text-white"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id="notification-popover"
          role="dialog"
          aria-label={t("p3.notifications.popover.title")}
          tabIndex={-1}
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl focus:outline-none"
        >
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-bold text-gray-900">
              {t("p3.notifications.popover.title")}
            </h2>
            <div className="flex items-center gap-2">
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={markingAll}
                  className="rounded-lg px-1 py-1 text-xs font-bold text-blue-700 hover:underline disabled:cursor-wait disabled:opacity-60"
                >
                  {markingAll
                    ? t("p3.notifications.popover.markingAll")
                    : t("p3.notifications.markAllRead")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("p3.notifications.popover.close")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {loading ? (
              <p role="status" className="px-4 py-6 text-center text-sm text-gray-600">
                {t("p3.notifications.popover.loading")}
              </p>
            ) : loadError ? (
              <p role="alert" className="px-4 py-6 text-center text-sm font-bold text-red-800">
                {t("p3.notifications.popover.error")}
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-600">
                {t("p3.notifications.popover.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map((notification) => {
                  const presentation = notificationTypePresentation(
                    notification.type,
                  );
                  const time = new Date(notification.createdAt);
                  const absolute = formatDateTimeLocalized(time, locale);
                  const relative = relativeTimeLabel(time, locale);
                  return (
                    <li key={notification.id}>
                      <a
                        href={`/varsler/apne/${notification.id}`}
                        onClick={() => markOneRead(notification)}
                        onAuxClick={(event) => {
                          if (event.button === 1) markOneRead(notification);
                        }}
                        className={`block px-4 py-3 transition-colors hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                          notification.readAt ? "" : "bg-blue-50/30"
                        }`}
                      >
                        <span className="flex items-start gap-2">
                          <span
                            aria-hidden="true"
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              notification.readAt ? "bg-transparent" : "bg-blue-600"
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span aria-hidden="true">
                                {presentation?.icon ?? "🔔"}
                              </span>
                              <span className="truncate text-sm font-bold text-gray-900">
                                {notification.title}
                              </span>
                            </span>
                            {notification.body && (
                              <span className="mt-0.5 block line-clamp-2 text-xs text-gray-600">
                                {notification.body}
                              </span>
                            )}
                            <time
                              dateTime={time.toISOString()}
                              title={absolute}
                              className="mt-1 block text-xs font-medium text-gray-600"
                            >
                              {relative ?? absolute}
                            </time>
                          </span>
                          {notification.hasTarget && (
                            <span aria-hidden="true" className="mt-1 text-blue-700">
                              →
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
            <Link
              href="/varsler"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-9 items-center text-sm font-bold text-blue-700 hover:underline"
            >
              {t("p3.notifications.popover.seeAll")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
