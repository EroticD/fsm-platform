import Link from "next/link";

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

export default function SettingsTabs({
  currentTab,
  canBranding,
  canUsers,
  canTemplates,
  canDocuments,
  canAudit,
  canStats,
  isAdmin,
}: SettingsTabsProps) {
  return (
    <div className="flex space-x-2 border-b border-gray-200">
      {canBranding && (
        <Link href="?tab=branding" className={linkClass(currentTab === "branding")}>
          🎨 Merkevare
        </Link>
      )}
      {canUsers && (
        <Link href="?tab=ansatte" className={linkClass(currentTab === "ansatte")}>
          👥 Ansatte & Roller
        </Link>
      )}
      {canTemplates && (
        <Link href="?tab=maler" className={linkClass(currentTab === "maler")}>
          📋 Sjekklister / Maler
        </Link>
      )}
      {(canTemplates || canDocuments) && (
        <Link href="?tab=tags" className={linkClass(currentTab === "tags")}>
          🏷️ Tags
        </Link>
      )}
      {canAudit && (
        <Link href="?tab=auditlog" className={linkClass(currentTab === "auditlog")}>
          📋 Aktivitetslogg
        </Link>
      )}
      {canStats && (
        <Link href="?tab=statistikk" className={linkClass(currentTab === "statistikk")}>
          📊 Statistikk
        </Link>
      )}
      {isAdmin && (
        <Link href="?tab=roller" className={linkClass(currentTab === "roller")}>
          🔐 Roller & rettigheter
        </Link>
      )}
      {isAdmin && (
        <Link href="?tab=avdelinger" className={linkClass(currentTab === "avdelinger")}>
          🏷️ Avdelinger
        </Link>
      )}
      <Link href="?tab=sikkerhet" className={linkClass(currentTab === "sikkerhet")}>
        🔐 Sikkerhet
      </Link>
    </div>
  );
}
