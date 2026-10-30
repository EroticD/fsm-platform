"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import NotificationSoundToggle from "@/components/NotificationSoundToggle";
import {
  saveNotificationPreferencesAction,
  type NotificationPreferencesState,
} from "./actions";

type Preference = { type: string; inApp: boolean; email: boolean };

const INITIAL_STATE: NotificationPreferencesState = { status: "idle" };
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)] disabled:cursor-wait";

/**
 * Skjemaet eier innsendingsstatusen, slik at brukeren får en tydelig kvittering
 * på at valgene er lagret – og en feilmelding hvis lagringen feiler.
 */
export default function NotificationPreferencesForm({
  types,
  labels,
  preferences,
}: {
  types: string[];
  labels: Record<string, string>;
  preferences: Preference[];
}) {
  const t = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    saveNotificationPreferencesAction,
    INITIAL_STATE,
  );
  const preferenceByType = new Map(
    preferences.map((preference) => [preference.type, preference]),
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "success" && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm font-bold text-[var(--ink,#101310)]"
        >
          <Icon name="check" className="h-4 w-4 shrink-0" />
          {t("p3.notificationSettings.saved")}
        </p>
      )}
      {state.status === "error" && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-3 py-2 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {t("p3.notificationSettings.saveError")}
        </p>
      )}

      <div className="office-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-[var(--ink,#101310)]">
            {t("p3.notificationSettings.soundTitle")}
          </p>
          <p className="text-xs text-[var(--muted,#62685f)]">
            {t("p3.notificationSettings.soundDescription")}
          </p>
        </div>
        <NotificationSoundToggle />
      </div>
      <div
        className="office-card overflow-x-auto"
        role="region"
        aria-label={t("components.notificationPreferences.caption")}
        tabIndex={0}
      >
        <table className="office-table">
          <caption className="sr-only">
            {t("components.notificationPreferences.caption")}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("p3.notificationSettings.event")}</th>
              <th scope="col">{t("p3.notificationSettings.inApp")}</th>
              <th scope="col">{t("p3.notificationSettings.email")}</th>
            </tr>
          </thead>
          <tbody>
            {types.map((type) => {
              const preference = preferenceByType.get(type);
              const label = labels[type] ?? type;
              return (
                <tr key={type}>
                  <th scope="row" className="text-left font-semibold text-[var(--ink,#101310)]">
                    {label}
                  </th>
                  <td>
                    <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                      <span className="sr-only">
                        {t("p3.notificationSettings.inAppAria", { label })}
                      </span>
                      <input
                        type="checkbox"
                        name={`inApp_${type}`}
                        defaultChecked={preference?.inApp ?? true}
                        className="h-5 w-5 accent-[var(--ink,#101310)]"
                      />
                    </label>
                  </td>
                  <td>
                    <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                      <span className="sr-only">
                        {t("p3.notificationSettings.emailAria", { label })}
                      </span>
                      <input
                        type="checkbox"
                        name={`email_${type}`}
                        defaultChecked={preference?.email ?? true}
                        className="h-5 w-5 accent-[var(--ink,#101310)]"
                      />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="submit" disabled={pending} className={SIGNAL_BUTTON}>
        {pending
          ? t("p3.notificationSettings.saving")
          : t("p3.notificationSettings.save")}
      </button>
    </form>
  );
}
