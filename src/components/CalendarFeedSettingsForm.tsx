"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  calendarFeedAction,
  type CalendarFeedActionState,
} from "@/app/innstillinger/calendar-actions";

/**
 * Kalenderlenken er en hemmelighet. Derfor finnes den bare i klienttilstanden
 * rett etter at den ble opprettet eller rotert – aldri i server-rendret HTML.
 */
export default function CalendarFeedSettingsForm({
  initialActive,
  baseUrl,
}: {
  initialActive: boolean;
  baseUrl: string;
}) {
  const t = useTranslations("common");
  const [state, action, pending] = useActionState<CalendarFeedActionState, FormData>(
    calendarFeedAction,
    { token: null, active: initialActive },
  );

  const feedUrl = state.token
    ? `${baseUrl.replace(/\/$/, "")}/api/kalender/ical?token=${state.token}`
    : null;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">📅 {t("p3.calendarFeed.title")}</h2>
      <p className="mt-1 text-sm text-gray-600">
        {t("p3.calendarFeed.description")}
      </p>

      <div className="mt-4 space-y-3">
        {feedUrl && (
          <>
            <label className="block text-xs font-bold text-gray-600">
              {t("p3.calendarFeed.link")}
              <input
                readOnly
                value={feedUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900"
              />
            </label>
            <p className="text-xs font-semibold text-amber-700">
              {t("p3.calendarFeed.once")}
            </p>
          </>
        )}

        {state.active && !feedUrl && (
          <p className="text-sm font-medium text-green-700">
            {t("p3.calendarFeed.active")}
          </p>
        )}

        <form action={action} className="flex flex-wrap gap-2">
          {!state.active && (
            <button
              type="submit"
              name="intent"
              value="create"
              disabled={pending}
              className="min-h-11 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
            >
              {t("p3.calendarFeed.create")}
            </button>
          )}

          {state.active && (
            <>
              <button
                type="submit"
                name="intent"
                value="regenerate"
                disabled={pending}
                className="min-h-11 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
              >
                {t("p3.calendarFeed.regenerate")}
              </button>
              <button
                type="submit"
                name="intent"
                value="revoke"
                disabled={pending}
                className="min-h-11 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {t("p3.calendarFeed.revoke")}
              </button>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
