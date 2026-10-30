"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import {
  calendarFeedAction,
  type CalendarFeedActionState,
} from "@/app/innstillinger/calendar-actions";

const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)] disabled:cursor-wait";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:cursor-wait disabled:opacity-60";

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
    <section className="office-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
        <Icon name="calendar" className="h-4 w-4 shrink-0" />
        {t("p3.calendarFeed.title")}
      </h2>
      <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
        {t("p3.calendarFeed.description")}
      </p>

      <div className="mt-4 space-y-3">
        {feedUrl && (
          <>
            <label className="block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
              {t("p3.calendarFeed.link")}
              <input
                readOnly
                value={feedUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 text-sm font-medium text-[var(--ink,#101310)]"
              />
            </label>
            <p className="flex items-center gap-1.5 text-xs font-bold text-[#6b4a05]">
              <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
              {t("p3.calendarFeed.once")}
            </p>
          </>
        )}

        {state.active && !feedUrl && (
          <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--ink,#101310)]">
            <Icon name="check" className="h-4 w-4 shrink-0" />
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
              className={SIGNAL_BUTTON}
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
                className={INK_BUTTON}
              >
                {t("p3.calendarFeed.regenerate")}
              </button>
              <button
                type="submit"
                name="intent"
                value="revoke"
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--risk,#f04427)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fae8e0] disabled:cursor-wait disabled:opacity-60"
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
