import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import UsersAdmin from "@/components/UsersAdmin";
import DepartmentsAdmin from "@/components/DepartmentsAdmin";
import RolesAdmin from "@/components/RolesAdmin";
import SecuritySettings from "@/components/SecuritySettings";
import SettingsTabs from "@/components/settings/SettingsTabs";
import BrandingTab from "@/components/settings/BrandingTab";
import TemplatesTab from "@/components/settings/TemplatesTab";
import TagsTab from "@/components/settings/TagsTab";
import AuditLogTab from "@/components/settings/AuditLogTab";
import StatisticsTab from "@/components/settings/StatisticsTab";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import {
  getAuditLogPage,
  getSettingsOverview,
  getStatistics,
} from "@/server/settings";
import {
  createDocumentTagAction,
  createTagAction,
  createTemplateAction,
  deleteDocumentTagAction,
  deleteTagAction,
  deleteTemplateAction,
  saveBrandingAction,
  updateDocumentTagAction,
  updateTagAction,
} from "./actions";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    customer?: string;
    technician?: string;
    page?: string;
    invite?: string;
    inviteToken?: string;
    error?: string;
    mail?: string;
    role?: string;
    setup?: string;
    ok?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const t = await getTranslations("common");

  const isAdmin = user.role === "ADMIN";
  const canBranding = hasPermission(user, "settings.manage");
  const canUsers = hasPermission(user, "users.view");
  const canTemplates = hasPermission(user, "templates.manage");
  const canDocuments = hasPermission(user, "documents.manage");
  const canAudit = hasPermission(user, "audit.view");
  const canStats = hasPermission(user, "reports.view");
  const canUseSettings =
    canBranding || canUsers || canTemplates || canDocuments || canAudit || canStats || isAdmin;

  // Vent på searchParams (kreves i nyere Next.js) og sett standardfane.
  // Sikkerhetsfanen er åpen for alle innloggede, slik at også montører kan
  // slå på to-trinns verifisering.
  const resolvedParams = await searchParams;
  const requestedTab = resolvedParams.tab;
  const error = resolvedParams.error;

  // Brukere uten administrasjons- eller statistikkrettigheter skal ikke inn her
  // – med mindre de ber om sikkerhetsfanen.
  if (!canUseSettings && requestedTab !== "sikkerhet") redirect("/");

  const currentTab =
    requestedTab ||
    (canUseSettings
      ? canBranding
        ? "branding"
        : canUsers
          ? "ansatte"
          : canTemplates
            ? "maler"
            : canAudit
              ? "auditlog"
              : canStats
                ? "statistikk"
                : "avdelinger"
      : "sikkerhet");
  const searchQuery = resolvedParams.search || "";
  const dateFrom = resolvedParams.dateFrom || "";
  const dateTo = resolvedParams.dateTo || "";
  const statusFilter = resolvedParams.status || "";
  const customerFilter = resolvedParams.customer || "";
  const technicianFilter = resolvedParams.technician || "";
  const page = Math.max(1, parseInt(resolvedParams.page?.toString() || "1", 10) || 1);

  const overview = canUseSettings ? await getSettingsOverview(user) : null;
  if (overview && !overview.ok) redirect("/");
  const branding = overview?.ok ? overview.data.branding : null;
  const templates = overview?.ok ? overview.data.templates : [];
  const tags = overview?.ok ? overview.data.tags : [];
  const documentTags = overview?.ok ? overview.data.documentTags : [];
  const departmentRows = overview?.ok ? overview.data.departmentRows : [];
  const roleRows = overview?.ok ? overview.data.roleRows : [];

  const auditPage =
    currentTab === "auditlog" && canAudit
      ? await getAuditLogPage(user, {
          search: searchQuery,
          dateFrom,
          dateTo,
          page,
        })
      : null;

  const statistics =
    currentTab === "statistikk" && canStats
      ? await getStatistics(user, {
          dateFrom,
          dateTo,
          status: statusFilter,
          customer: customerFilter,
          technician: technicianFilter,
        })
      : null;

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">⚙️ {t("settings.title")}</h1>
            <p className="text-gray-500 mt-1 text-sm">{t("settings.subtitle")}</p>
          </div>
          <Link href="/" className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition shadow-sm">
            &larr; {t("settings.backToDashboard")}
          </Link>
        </div>

        <SettingsTabs
          currentTab={currentTab}
          canBranding={canBranding}
          canUsers={canUsers}
          canTemplates={canTemplates}
          canDocuments={canDocuments}
          canAudit={canAudit}
          canStats={canStats}
          isAdmin={isAdmin}
        />

        {/* FANE 1: BRANDING */}
        {currentTab === "branding" && canBranding && (
          <BrandingTab
            branding={branding}
            error={error}
            saveBranding={saveBrandingAction}
          />
        )}

        {/* FANE 2: ANSATTE */}
        {currentTab === "ansatte" && canUsers && (
          <UsersAdmin
            returnTo="/innstillinger?tab=ansatte"
            currentUserEmail={user.email}
            isAdmin={user.role === "ADMIN"}
            departmentId={user.departmentId}
            canManageCustomers={hasPermission(user, "customers.manage")}
            actorPermissions={Array.from(effectivePermissions(user))}
            invite={resolvedParams.invite}
            inviteToken={resolvedParams.inviteToken}
            error={resolvedParams.error}
            mail={resolvedParams.mail}
            page={page}
            baseUrl="/innstillinger?tab=ansatte"
          />
        )}

        {/* FANE 3: MALER & SJEKKLISTER */}
        {currentTab === "maler" && canTemplates && (
          <TemplatesTab
            templates={templates}
            isAdmin={isAdmin}
            createTemplate={createTemplateAction}
            deleteTemplate={deleteTemplateAction}
          />
        )}

        {/* FANE: TAGS */}
        {currentTab === "tags" && (canTemplates || canDocuments) && (
          <TagsTab
            tags={tags}
            documentTags={documentTags}
            isAdmin={isAdmin}
            createTag={createTagAction}
            updateTag={updateTagAction}
            deleteTag={deleteTagAction}
            createDocumentTag={createDocumentTagAction}
            updateDocumentTag={updateDocumentTagAction}
            deleteDocumentTag={deleteDocumentTagAction}
          />
        )}

        {/* FANE 4: AKTIVITETSLOGG */}
        {currentTab === "auditlog" && canAudit && auditPage?.ok && (
          <AuditLogTab
            logs={auditPage.data.logs}
            total={auditPage.data.total}
            page={auditPage.data.page}
            pageSize={auditPage.data.pageSize}
            search={searchQuery}
            dateFrom={dateFrom}
            dateTo={dateTo}
          />
        )}

        {/* FANE 5: STATISTIKK (AVDELINGSBEGRENSET) */}
        {currentTab === "statistikk" && canStats && statistics?.ok && (
          <StatisticsTab
            data={statistics.data}
            dateFrom={dateFrom}
            dateTo={dateTo}
            statusFilter={statusFilter}
            customerFilter={customerFilter}
            technicianFilter={technicianFilter}
          />
        )}

        {currentTab === "roller" && isAdmin && (
          <div>
            <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                🔐 {t("settings.roles.title")}
              </h2>
              <p className="text-gray-500 text-sm">
                {t("settings.roles.description")}
              </p>
            </div>
            <RolesAdmin
              roles={roleRows}
              error={resolvedParams.error}
              message={resolvedParams.role}
            />
          </div>
        )}

        {currentTab === "avdelinger" && isAdmin && (
          <div>
            <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">🏷️ {t("settings.departments.title")}</h2>
              <p className="text-gray-500 text-sm">
                {t("settings.departments.description")}
              </p>
            </div>
            <DepartmentsAdmin departments={departmentRows} />
          </div>
        )}

        {currentTab === "sikkerhet" && (
          <SecuritySettings
            user={{
              id: user.id,
              email: user.email,
              name: user.name,
              isTwoFactorEnabled: user.isTwoFactorEnabled,
              twoFactorSecret: user.twoFactorSecret,
            }}
            setup={resolvedParams.setup}
            error={resolvedParams.error}
            ok={resolvedParams.ok}
          />
        )}
      </div>
    </div>
  );
}
