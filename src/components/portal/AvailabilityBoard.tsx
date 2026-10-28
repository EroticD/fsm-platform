"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDateLocalized } from "@/lib/dates";
import { PORTAL_SLOT_EVENT } from "./slot-selection";

export type AvailabilityDay = { date: string; busy: boolean };
export type AvailabilityTechnician = {
  id: string;
  name: string;
  days: AvailabilityDay[];
};

/**
 * Én kort per tekniker med sju dagchips. Kortet erstatter den brede tabellen,
 * så kundeportalen ikke trenger vannrett scroll på telefon. Ledige dager er
 * knapper som sender valget til bestillingsskjemaet.
 */
export default function AvailabilityBoard({
  technicians,
}: {
  technicians: AvailabilityTechnician[];
}) {
  const t = useTranslations("common");
  const locale = useLocale();

  const choose = (technician: AvailabilityTechnician, date: string) => {
    window.dispatchEvent(
      new CustomEvent(PORTAL_SLOT_EVENT, {
        detail: {
          date,
          technicianId: technician.id,
          technicianName: technician.name,
        },
      }),
    );
    document
      .getElementById("booking-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-gray-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-600" aria-hidden="true" />
          {t("portal.availability.free")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
          {t("portal.availability.busy")}
        </span>
        <span className="font-medium text-gray-600">
          {t("portal.availability.pickHint")}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {technicians.map((technician) => (
          <article
            key={technician.id}
            className="rounded-xl border border-gray-200 bg-gray-50 p-3"
          >
            <h3 className="text-sm font-black text-gray-900">
              {technician.name || t("portal.availability.unknownName")}
            </h3>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {technician.days.map((day) => {
                const fullDate = formatDateLocalized(day.date, locale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                });
                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={day.busy}
                    onClick={() => choose(technician, day.date)}
                    aria-label={t(
                      day.busy
                        ? "portal.availability.dayBusyAria"
                        : "portal.availability.dayFreeAria",
                      {
                        technician:
                          technician.name || t("portal.availability.unknownName"),
                        date: fullDate,
                      },
                    )}
                    className={`flex min-h-14 flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      day.busy
                        ? "cursor-not-allowed border-amber-200 bg-amber-50 text-amber-900"
                        : "cursor-pointer border-green-200 bg-green-50 text-green-950 hover:border-green-400 hover:bg-green-100"
                    }`}
                  >
                    <span className="text-xs font-bold leading-tight">
                      {formatDateLocalized(day.date, locale, { weekday: "short" })}
                    </span>
                    <span className="text-sm font-black leading-tight">
                      {formatDateLocalized(day.date, locale, { day: "numeric" })}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`mt-1 h-1.5 w-1.5 rounded-full ${
                        day.busy ? "bg-amber-500" : "bg-green-600"
                      }`}
                    />
                    <span className="sr-only">
                      {day.busy
                        ? t("portal.availability.busy")
                        : t("portal.availability.free")}
                    </span>
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
