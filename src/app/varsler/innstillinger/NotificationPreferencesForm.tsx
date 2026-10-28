"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import NotificationSoundToggle from "@/components/NotificationSoundToggle";
import {
  saveNotificationPreferencesAction,
  type NotificationPreferencesState,
} from "./actions";

type Preference = { type: string; inApp: boolean; email: boolean };

const INITIAL_STATE: NotificationPreferencesState = { status: "idle" };

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
          className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-bold text-green-900"
        >
          {t("p3.notificationSettings.saved")}
        </p>
      )}
      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800"
        >
          {t("p3.notificationSettings.saveError")}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-gray-900">
            {t("p3.notificationSettings.soundTitle")}
          </p>
          <p className="text-xs text-gray-600">
            {t("p3.notificationSettings.soundDescription")}
          </p>
        </div>
        <NotificationSoundToggle />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white" tabIndex={0}>
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-bold">{t("p3.notificationSettings.event")}</th>
              <th className="px-4 py-3 font-bold">{t("p3.notificationSettings.inApp")}</th>
              <th className="px-4 py-3 font-bold">{t("p3.notificationSettings.email")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {types.map((type) => {
              const preference = preferenceByType.get(type);
              const label = labels[type] ?? type;
              return (
                <tr key={type}>
                  <td className="px-4 py-3 font-medium text-gray-900">{label}</td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name={`inApp_${type}`}
                      defaultChecked={preference?.inApp ?? true}
                      aria-label={t("p3.notificationSettings.inAppAria", {
                        label,
                      })}
                      className="h-5 w-5"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name={`email_${type}`}
                      defaultChecked={preference?.email ?? true}
                      aria-label={t("p3.notificationSettings.emailAria", {
                        label,
                      })}
                      className="h-5 w-5"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        {pending
          ? t("p3.notificationSettings.saving")
          : t("p3.notificationSettings.save")}
      </button>
    </form>
  );
}
