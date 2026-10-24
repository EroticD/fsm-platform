import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import NotificationPreferences from "./NotificationPreferences";

export default async function NotificationSettingsPage() {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("p3.notificationSettings.title")}</h1>
          <p className="text-sm text-gray-600">
            {t("p3.notificationSettings.description")}
          </p>
        </div>
        <Link
          href="/varsler"
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
        >
          {t("p3.notificationSettings.toNotifications")}
        </Link>
      </div>
      <NotificationPreferences />
    </div>
  );
}
