"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDateTimeLocalized } from "@/lib/dates";
import type { TrackingEtaSource } from "@/server/tracking";

const POLL_INTERVAL_MS = 30_000;
/** Samme grense som `LOCATION_PING_FRESH_MS` på serveren. */
const LOCATION_FRESH_MS = 10 * 60_000;

export type TrackingEtaSnapshot = {
  status: string;
  etaSource: TrackingEtaSource;
  etaMinutes: number | null;
  estimatedArrivalAt: string | null;
  plannedStartsAt: string;
  lastUpdatedAt: string | null;
  pingAgeMinutes: number | null;
  stale: boolean;
  hasLivePosition: boolean;
};

/**
 * Oppdaterer ETA-en uten å laste hele siden på nytt. Komponenten får bare
 * tider og tilstand – aldri navn, adresse eller koordinater.
 *
 * Et gammelt ping vises som «sist kjente posisjon», ikke som live. Da faller
 * vi tilbake til den planlagte tiden fra kalenderen.
 */
export default function TrackingEtaLive({
  token,
  locale,
  initial,
}: {
  token: string;
  locale: string;
  initial: TrackingEtaSnapshot;
}) {
  const t = useTranslations("common");
  const [snapshot, setSnapshot] = useState<TrackingEtaSnapshot>(initial);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      setNowMs(Date.now());
      try {
        const response = await fetch(
          `/api/tracking/${encodeURIComponent(token)}/eta`,
          { cache: "no-store", headers: { accept: "application/json" } },
        );
        if (!response.ok) return;
        const data = (await response.json()) as Partial<TrackingEtaSnapshot>;
        if (!cancelled && data && typeof data.etaSource === "string") {
          setSnapshot((current) => ({ ...current, ...data }));
        }
      } catch {
        // Nettverksfeil skal ikke skjule den forrige, gyldige tilstanden.
      }
    };

    timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [token]);

  // Selv om polling skulle feile, skal en gammel posisjon aldri fremstå som
  // live. Vi regner alderen på nytt i nettleseren også.
  const lastUpdatedMs = snapshot.lastUpdatedAt
    ? Date.parse(snapshot.lastUpdatedAt)
    : Number.NaN;
  const clockStale =
    Number.isFinite(lastUpdatedMs) && nowMs - lastUpdatedMs > LOCATION_FRESH_MS;
  const stale = snapshot.stale || clockStale;
  const pingAgeMinutes = Math.max(
    snapshot.pingAgeMinutes ?? 0,
    Number.isFinite(lastUpdatedMs)
      ? Math.floor((nowMs - lastUpdatedMs) / 60_000)
      : 0,
  );
  const liveEta = !stale ? snapshot.etaMinutes : null;

  const arrival = snapshot.estimatedArrivalAt
    ? formatDateTimeLocalized(snapshot.estimatedArrivalAt, locale)
    : null;
  const planned = formatDateTimeLocalized(snapshot.plannedStartsAt, locale);
  const lastUpdated = snapshot.lastUpdatedAt
    ? formatDateTimeLocalized(snapshot.lastUpdatedAt, locale)
    : null;

  if (snapshot.status === "ON_SITE") {
    return (
      <p className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3 text-sm font-bold text-[var(--ink,#101310)]">
        {t("tracking.public.onSite")}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-[var(--line,#dedcd1)] pt-3">
      {liveEta !== null ? (
        <div aria-live="polite">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
            {t("tracking.public.etaLabel")}
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums text-[var(--ink,#101310)]">
            {t("tracking.public.etaMinutes", {
              count: liveEta,
            })}
          </p>
          {arrival && (
            <p className="mt-1 text-sm font-medium text-[var(--muted,#62685f)]">
              {t("tracking.public.etaArrival", { time: arrival })}
            </p>
          )}
        </div>
      ) : (
        <div aria-live="polite">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
            {t("tracking.public.plannedLabel")}
          </p>
          <p className="mt-1 text-lg font-black tabular-nums text-[var(--ink,#101310)]">
            {t("tracking.public.plannedTime", { time: planned })}
          </p>
        </div>
      )}

      {stale && (
        <p
          role="status"
          className="rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t("tracking.public.stalePosition", {
            minutes: pingAgeMinutes,
          })}
        </p>
      )}

      {snapshot.etaSource === "planned" &&
        snapshot.hasLivePosition &&
        !stale && (
          <p className="text-sm font-medium text-[var(--muted,#62685f)]">
            {t("tracking.public.livePositionNoRoute")}
          </p>
        )}

      {snapshot.etaSource === "planned" && !snapshot.hasLivePosition && (
        <p className="text-sm font-medium text-[var(--muted,#62685f)]">
          {t("tracking.public.etaUnavailable")}
        </p>
      )}

      <p className="text-sm font-medium text-[var(--muted,#62685f)]">
        {lastUpdated
          ? stale
            ? t("tracking.public.lastKnownPosition", { time: lastUpdated })
            : t("tracking.public.lastUpdated", { time: lastUpdated })
          : t("tracking.public.noPosition")}
      </p>
      <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("tracking.public.refreshHint")}
      </p>
    </div>
  );
}
