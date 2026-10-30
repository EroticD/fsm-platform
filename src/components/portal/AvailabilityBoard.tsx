"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addDaysUtc, formatDateLocalized, parseDateOnly, toDateOnly } from "@/lib/dates";
import type {
  PortalAvailabilityDay,
  PortalAvailabilitySlot,
} from "@/server/availability";
import {
  holdSlotAction,
  loadAvailabilityAction,
  releaseHoldAction,
} from "@/app/kundeportal/booking-actions";

export type SlotPickerSite = {
  id: string;
  name: string;
  address: string | null;
};

export type HeldSlot = {
  token: string;
  expiresAt: string;
  date: string;
  from: string;
  to: string;
  technicianId: string;
  technicianName: string;
  siteId: string | null;
};

const WEEK = 7;

function secondsUntil(expiresAt: string): number {
  return Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
}

function stripDates(anchor: string): string[] {
  const parsed = parseDateOnly(anchor);
  if (!parsed) return [];
  return Array.from({ length: WEEK }, (_, index) =>
    toDateOnly(addDaysUtc(parsed, index)),
  );
}

/**
 * Ekte slotvelger: dato → ledige halvtimer per montør → kort reservasjon.
 *
 * Komponenten erstatter den gamle dagbretten. Den henter bare én dato om
 * gangen, slik at kundeportalen ikke laster hele 60-dagers horisonten.
 */
export default function AvailabilityBoard({
  sites,
  minDate,
  horizonEnd,
  siteId,
  onSelect,
  onClear,
}: {
  sites: SlotPickerSite[];
  minDate: string;
  horizonEnd: string;
  siteId: string;
  onSelect: (slot: HeldSlot | null) => void;
  onClear?: () => void;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const [anchor, setAnchor] = useState(minDate);
  const [selectedDate, setSelectedDate] = useState(minDate);
  const [day, setDay] = useState<PortalAvailabilityDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<HeldSlot | null>(null);
  const [holdingKey, setHoldingKey] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const dates = useMemo(() => stripDates(anchor), [anchor]);
  const canGoBack = anchor > minDate;
  const canGoForward = anchor < horizonEnd;

  const load = useCallback(
    async (date: string) => {
      const result = await loadAvailabilityAction(date);
      if (result.ok) {
        setDay(result.data);
        setError(null);
      } else {
        setDay(null);
        setError(
          result.reason === "forbidden"
            ? t("portal.bookingWizard.errors.forbidden")
            : t("portal.bookingWizard.errors.loadFailed"),
        );
      }
      setLoading(false);
    },
    [t],
  );

  useEffect(() => {
    // Utsatt til etter render, slik at effekten ikke kaller setState synkront.
    const timer = window.setTimeout(() => {
      void load(selectedDate);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, selectedDate]);

  useEffect(() => {
    if (!held) return;
    const tick = () => {
      const remaining = secondsUntil(held.expiresAt);
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        setHeld(null);
        onSelect(null);
        onClear?.();
      }
    };
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [held, onSelect, onClear]);

  const chooseDate = (date: string) => {
    if (date < minDate || date > horizonEnd) return;
    if (held) {
      void releaseHoldAction(held.token);
      setHeld(null);
      setRemainingSeconds(0);
      onSelect(null);
      onClear?.();
    }
    setLoading(true);
    setError(null);
    setSelectedDate(date);
  };

  const chooseSlot = async (slot: PortalAvailabilitySlot) => {
    const key = `${slot.technicianId}:${slot.startsAt}`;
    if (holdingKey) return;
    setHoldingKey(key);
    setError(null);
    if (held) {
      await releaseHoldAction(held.token);
      setHeld(null);
      onSelect(null);
    }
    const result = await holdSlotAction({
      date: slot.date,
      from: slot.from,
      to: slot.to,
      technicianId: slot.technicianId,
      siteId: siteId || null,
    });
    setHoldingKey(null);
    if (!result.ok) {
      setError(
        result.reason === "conflict"
          ? t("portal.bookingWizard.errors.slotTaken")
          : t("portal.bookingWizard.errors.holdFailed"),
      );
      void load(selectedDate);
      return;
    }
    const heldSlot: HeldSlot = {
      token: result.data.token,
      expiresAt: result.data.expiresAt,
      date: result.data.date,
      from: result.data.from,
      to: result.data.to,
      technicianId: result.data.technicianId,
      technicianName: result.data.technicianName,
      siteId: result.data.siteId,
    };
    setHeld(heldSlot);
    setRemainingSeconds(secondsUntil(heldSlot.expiresAt));
    onSelect(heldSlot);
  };

  const clearHeld = async () => {
    if (held) await releaseHoldAction(held.token);
    setHeld(null);
    onSelect(null);
    onClear?.();
  };

  const slotsByTechnician = useMemo(() => {
    const map = new Map<
      string,
      { technicianId: string; technicianName: string; slots: PortalAvailabilitySlot[] }
    >();
    for (const slot of day?.slots ?? []) {
      const existing = map.get(slot.technicianId);
      if (existing) existing.slots.push(slot);
      else
        map.set(slot.technicianId, {
          technicianId: slot.technicianId,
          technicianName: slot.technicianName,
          slots: [slot],
        });
    }
    return [...map.values()];
  }, [day]);

  const selectedDateLabel = formatDateLocalized(selectedDate, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-[var(--muted,#62685f)]"
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
              aria-hidden="true"
            />
            {t("portal.bookingWizard.legendFree")}
          </span>
          <span>{t("portal.bookingWizard.legendSlot", { minutes: day?.slotMinutes ?? 30 })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const parsed = parseDateOnly(anchor);
              const previous = parsed
                ? toDateOnly(addDaysUtc(parsed, -WEEK))
                : minDate;
              const next = previous < minDate ? minDate : previous;
              setAnchor(next);
              chooseDate(next);
            }}
            disabled={!canGoBack}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm font-bold text-[var(--ink,#101310)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("portal.bookingWizard.previousWeek")}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              const parsed = parseDateOnly(anchor);
              const next = parsed
                ? toDateOnly(addDaysUtc(parsed, WEEK))
                : horizonEnd;
              const clamped = next > horizonEnd ? horizonEnd : next;
              setAnchor(clamped);
              chooseDate(clamped);
            }}
            disabled={!canGoForward}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm font-bold text-[var(--ink,#101310)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("portal.bookingWizard.nextWeek")}
          >
            →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {dates.map((date) => {
          const active = date === selectedDate;
          const isToday = date === minDate;
          return (
            <button
              key={date}
              type="button"
              onClick={() => chooseDate(date)}
              aria-pressed={active}
              aria-label={formatDateLocalized(date, locale, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl border px-1 py-2 text-center transition ${
                active
                  ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                  : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]"
              }`}
            >
              <span className="text-xs font-bold uppercase leading-tight">
                {formatDateLocalized(date, locale, { weekday: "short" })}
              </span>
              <span className="text-base font-black leading-tight">
                {formatDateLocalized(date, locale, { day: "numeric" })}
              </span>
              {isToday && (
                <span className="text-[10px] font-bold leading-tight">
                  {t("portal.bookingWizard.earliest")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
        <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("portal.bookingWizard.dayTitle", { date: selectedDateLabel })}
        </h3>
        {held && (
          <div
            role="status"
            className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#b9cdb4] bg-[#eaf3e4] px-3 py-2 text-xs font-bold text-[#24502f]"
          >
            <span>
              {t("portal.bookingWizard.held", {
                technician:
                  held.technicianName || t("portal.availability.unknownName"),
                from: held.from,
                to: held.to,
                minutes: Math.max(0, Math.ceil(remainingSeconds / 60)),
              })}
            </span>
            <button
              type="button"
              onClick={() => void clearHeld()}
              className="inline-flex min-h-11 items-center rounded-full border border-[#24502f] px-3 text-xs font-bold"
            >
              {t("portal.bookingWizard.release")}
            </button>
          </div>
        )}
        {loading ? (
          <p className="mt-2 text-sm italic text-[var(--muted,#62685f)]">
            {t("portal.bookingWizard.loading")}
          </p>
        ) : error ? (
          <p role="alert" className="mt-2 text-sm font-bold text-[#a92a12]">
            {error}
          </p>
        ) : slotsByTechnician.length === 0 ? (
          <div className="mt-2 space-y-1 text-sm text-[var(--muted,#62685f)]">
            <p className="font-bold">{t("portal.bookingWizard.noSlots")}</p>
            <p>{t("portal.bookingWizard.tryAnotherDay")}</p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {slotsByTechnician.map((technician) => (
              <div key={technician.technicianId}>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                  {technician.technicianName ||
                    t("portal.availability.unknownName")}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {technician.slots.map((slot) => {
                    const key = `${slot.technicianId}:${slot.startsAt}`;
                    const active =
                      held?.technicianId === slot.technicianId &&
                      held?.from === slot.from;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => void chooseSlot(slot)}
                        disabled={Boolean(holdingKey)}
                        aria-pressed={active}
                        className={`inline-flex min-h-11 items-center justify-center rounded-full border px-3 text-sm font-bold tabular-nums transition ${
                          active
                            ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                            : "border-[#c7d98e] bg-[#f3fbd1] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)] hover:bg-[var(--signal,#d8ff3e)]"
                        } disabled:cursor-wait`}
                      >
                        {slot.from}–{slot.to}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {day?.unconfiguredPolicy && (
          <p className="mt-3 text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("portal.bookingWizard.unconfiguredPolicy", {
              count: day.unconfiguredTechnicianCount,
            })}
          </p>
        )}
        {day && !day.businessHoursConfigured && (
          <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("portal.bookingWizard.defaultBusinessHours")}
          </p>
        )}
      </div>

      {sites.length > 0 && (
        <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("portal.bookingWizard.siteHint")}
        </p>
      )}
    </div>
  );
}
