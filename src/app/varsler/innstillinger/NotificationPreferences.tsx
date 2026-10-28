import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import {
  getNotificationPreferences,
  NOTIFICATION_TYPES,
} from "@/server/notifications";
import NotificationSoundToggle from "@/components/NotificationSoundToggle";
import SubmitButton from "@/components/SubmitButton";
import { saveNotificationPreferencesAction } from "./actions";


export default async function NotificationPreferences() {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) return null;

  const result = await getNotificationPreferences(user);
  if (!result.ok) return null;
  const labels: Record<string, string> = {
    ASSIGNMENT: t("p3.notificationSettings.labels.ASSIGNMENT"),
    DATE_CHANGED: t("p3.notificationSettings.labels.DATE_CHANGED"),
    CANCELLED: t("p3.notificationSettings.labels.CANCELLED"),
    REPORT_READY: t("p3.notificationSettings.labels.REPORT_READY"),
    BOOKING: t("p3.notificationSettings.labels.BOOKING"),
    CONTRACT_DUE: t("p3.notificationSettings.labels.CONTRACT_DUE"),
    OVERDUE: t("p3.notificationSettings.labels.OVERDUE"),
    CONTACT_UPDATE: t("p3.notificationSettings.labels.CONTACT_UPDATE"),
  };

  const preferences = new Map(
    result.data.map((preference) => [preference.type, preference]),
  );

  return (
    <form action={saveNotificationPreferencesAction} className="space-y-4">
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
            {NOTIFICATION_TYPES.map((type) => {
              const preference = preferences.get(type);
              return (
                <tr key={type}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {labels[type] ?? type}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name={`inApp_${type}`}
                      defaultChecked={preference?.inApp ?? true}
                      aria-label={t("p3.notificationSettings.inAppAria", { label: labels[type] ?? type })}
                      className="h-5 w-5"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name={`email_${type}`}
                      defaultChecked={preference?.email ?? true}
                      aria-label={t("p3.notificationSettings.emailAria", { label: labels[type] ?? type })}
                      className="h-5 w-5"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SubmitButton
        pendingLabel={t("p3.notificationSettings.saving")}
        className="min-h-11 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
      >
        {t("p3.notificationSettings.save")}
      </SubmitButton>
    </form>
  );
}
