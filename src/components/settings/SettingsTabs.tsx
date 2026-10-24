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
  `px-5 py-3 text-sm font-bold border-b-2 transition-colors ${
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
    <div className="flex space-x-2 border-b border-gray-200">
      {canBranding && (
        <Link href="?tab=branding" className={linkClass(currentTab === "branding")}>
          🎨 {t("settings.tabs.branding")}
        </Link>
      )}
      {canUsers && (
        <Link href="?tab=ansatte" className={linkClass(currentTab === "ansatte")}>
          👥 {t("settings.tabs.employees")}
        </Link>
      )}
      {canTemplates && (
        <Link href="?tab=maler" className={linkClass(currentTab === "maler")}>
          📋 {t("settings.tabs.templates")}
        </Link>
      )}
      {(canTemplates || canDocuments) && (
        <Link href="?tab=tags" className={linkClass(currentTab === "tags")}>
          🏷️ {t("settings.tabs.tags")}
        </Link>
      )}
      {canAudit && (
        <Link href="?tab=auditlog" className={linkClass(currentTab === "auditlog")}>
          📋 {t("settings.tabs.auditLog")}
        </Link>
      )}
      {canStats && (
        <Link href="?tab=statistikk" className={linkClass(currentTab === "statistikk")}>
          📊 {t("settings.tabs.statistics")}
        </Link>
      )}
      {isAdmin && (
        <Link href="?tab=roller" className={linkClass(currentTab === "roller")}>
          🔐 {t("settings.tabs.roles")}
        </Link>
      )}
      {isAdmin && (
        <Link href="?tab=avdelinger" className={linkClass(currentTab === "avdelinger")}>
          🏷️ {t("settings.tabs.departments")}
        </Link>
      )}
      <Link href="?tab=sikkerhet" className={linkClass(currentTab === "sikkerhet")}>
        🔐 {t("settings.tabs.security")}
      </Link>
    </div>
  );
}
