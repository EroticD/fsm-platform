import Link from "next/link";
import Icon from "@/components/icons";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import PageHeader from "@/components/PageHeader";
import NotificationPreferences from "./NotificationPreferences";

export default async function NotificationSettingsPage() {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title={t("p3.notificationSettings.title")}
        subtitle={t("p3.notificationSettings.description")}
        icon={<Icon name="settings" className="h-5 w-5" />}
        actions={
          <Link
            href="/varsler"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("p3.notificationSettings.toNotifications")}
          </Link>
        }
      />
      <NotificationPreferences />
    </div>
  );
}
