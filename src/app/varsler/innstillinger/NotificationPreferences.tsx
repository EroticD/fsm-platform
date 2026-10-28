import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import {
  getNotificationPreferences,
  NOTIFICATION_TYPES,
} from "@/server/notifications";
import NotificationPreferencesForm from "./NotificationPreferencesForm";

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

  return (
    <NotificationPreferencesForm
      types={[...NOTIFICATION_TYPES]}
      labels={labels}
      preferences={result.data}
    />
  );
}
