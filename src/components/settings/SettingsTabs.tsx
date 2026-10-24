import Link from "next/link";
import { getTranslations } from "next-intl/server";

type SettingsTabsProps = {
  currentTab: string;
  canBranding: boolean;
  canUsers: boolean;
  canTemplates: boolean;
  canDocuments: boolean;
  canAudit: boolean;
  canStats: boolean;
  isAdmin: boolean;
};

const linkClass = (active: boolean) =>
  `flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-bold transition-colors sm:px-5 sm:py-3 sm:text-sm ${
    active
      ? "border-blue-600 text-blue-600"
      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
  }`;

export default async function SettingsTabs({
  currentTab,
  canBranding,
  canUsers,
  canTemplates,
  canDocuments,
  canAudit,
  canStats,
  isAdmin,
}: SettingsTabsProps) {
  const t = await getTranslations("common");

  return (
    <nav
      aria-label={t("settings.title")}
      className="flex flex-wrap gap-x-1 border-b border-gray-200"
    >
      {canBranding && (
        <Link href="?tab=branding" className={linkClass(currentTab === "branding")} aria-current={currentTab === "branding" ? "page" : undefined}>
          🎨 {t("settings.tabs.branding")}
        </Link>
      )}
      {canUsers && (
        <Link href="?tab=ansatte" className={linkClass(currentTab === "ansatte")} aria-current={currentTab === "ansatte" ? "page" : undefined}>
          👥 {t("settings.tabs.employees")}
        </Link>
      )}
      {canTemplates && (
        <Link href="?tab=maler" className={linkClass(currentTab === "maler")} aria-current={currentTab === "maler" ? "page" : undefined}>
          📋 {t("settings.tabs.templates")}
        </Link>
      )}
      {(canTemplates || canDocuments) && (
        <Link href="?tab=tags" className={linkClass(currentTab === "tags")} aria-current={currentTab === "tags" ? "page" : undefined}>
          🏷️ {t("settings.tabs.tags")}
        </Link>
      )}
      {canAudit && (
        <Link href="?tab=auditlog" className={linkClass(currentTab === "auditlog")} aria-current={currentTab === "auditlog" ? "page" : undefined}>
          📋 {t("settings.tabs.auditLog")}
        </Link>
      )}
      {canStats && (
        <Link href="?tab=statistikk" className={linkClass(currentTab === "statistikk")} aria-current={currentTab === "statistikk" ? "page" : undefined}>
          📊 {t("settings.tabs.statistics")}
        </Link>
      )}
      {isAdmin && (
        <Link href="?tab=roller" className={linkClass(currentTab === "roller")} aria-current={currentTab === "roller" ? "page" : undefined}>
          🔐 {t("settings.tabs.roles")}
        </Link>
      )}
      {isAdmin && (
        <Link href="?tab=avdelinger" className={linkClass(currentTab === "avdelinger")} aria-current={currentTab === "avdelinger" ? "page" : undefined}>
          🏷️ {t("settings.tabs.departments")}
        </Link>
      )}
      <Link href="?tab=sikkerhet" className={linkClass(currentTab === "sikkerhet")} aria-current={currentTab === "sikkerhet" ? "page" : undefined}>
        🔐 {t("settings.tabs.security")}
      </Link>
    </nav>
  );
}
