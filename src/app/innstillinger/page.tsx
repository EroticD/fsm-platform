import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import UsersAdmin from "@/components/UsersAdmin";
import DepartmentsAdmin from "@/components/DepartmentsAdmin";
import RolesAdmin from "@/components/RolesAdmin";
import SecuritySettings from "@/components/SecuritySettings";
import SettingsTabs from "@/components/settings/SettingsTabs";
import BrandingTab from "@/components/settings/BrandingTab";
import CalendarFeedSettings from "@/components/CalendarFeedSettings";
import TemplatesTab from "@/components/settings/TemplatesTab";
import TagsTab from "@/components/settings/TagsTab";
import AuditLogTab from "@/components/settings/AuditLogTab";
import StatisticsTab from "@/components/settings/StatisticsTab";
import MapSettingsTab from "@/components/settings/MapSettingsTab";
import PageHeader from "@/components/PageHeader";
import SectionCard from "@/components/SectionCard";
import { parseTemplateCategoryFilter } from "@/lib/template-category";
import { chooseSettingsTab } from "@/lib/settings-tabs";
import { getMapSettingsView } from "@/server/map-settings";
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
  saveMapSettingsAction,
  updateDocumentTagAction,
  updateTagAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.innstillinger") };
}

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
    error?: string;
    role?: string;
    setup?: string;
    ok?: string;
    category?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const t = await getTranslations("common");

  const isAdmin = user.role === "ADMIN";
  const canBranding = hasPermission(user, "settings.manage");
  const canMap = hasPermission(user, "settings.manage");
  const canUsers = hasPermission(user, "users.view");
  const canTemplates = hasPermission(user, "templates.manage");
  const canDocuments = hasPermission(user, "documents.manage");
  const canAudit = hasPermission(user, "audit.view");
  const canStats = hasPermission(user, "reports.view");
  const canUseSettings =
    canBranding || canMap || canUsers || canTemplates || canDocuments || canAudit || canStats || isAdmin;

  // Vent på searchParams (kreves i nyere Next.js) og sett standardfane.
  // Sikkerhetsfanen er åpen for alle innloggede, slik at også montører kan
  // slå på to-trinns verifisering.
  const resolvedParams = await searchParams;
  const requestedTab = resolvedParams.tab;
  const error = resolvedParams.error;

  // Brukere uten administrasjons- eller statistikkrettigheter skal ikke inn her
  // – med mindre de ber om sikkerhetsfanen.
  if (!canUseSettings && requestedTab !== "sikkerhet") redirect("/");

  const currentTab = chooseSettingsTab(requestedTab, {
    canBranding,
    canMap,
    canUsers,
    canTemplates,
    canDocuments,
    canAudit,
    canStats,
    isAdmin,
  });
  const searchQuery = resolvedParams.search || "";
  const dateFrom = resolvedParams.dateFrom || "";
  const dateTo = resolvedParams.dateTo || "";
  const statusFilter = resolvedParams.status || "";
  const customerFilter = resolvedParams.customer || "";
  const technicianFilter = resolvedParams.technician || "";
  const page = Math.max(1, parseInt(resolvedParams.page?.toString() || "1", 10) || 1);
  const templateCategory = parseTemplateCategoryFilter(resolvedParams.category);

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

  const mapSettings =
    currentTab === "kart" && canMap ? await getMapSettingsView(user) : null;

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
        <PageHeader
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          icon="⚙️"
          actions={
            <Link href="/" className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition shadow-sm">
              &larr; {t("settings.backToDashboard")}
            </Link>
          }
        />

        <SettingsTabs
          currentTab={currentTab}
          canBranding={canBranding}
          canMap={canMap}
          canUsers={canUsers}
          canTemplates={canTemplates}
          canDocuments={canDocuments}
          canAudit={canAudit}
          canStats={canStats}
          isAdmin={isAdmin}
        />

        {currentTab === "kart" && canMap && mapSettings?.ok && (
          <MapSettingsTab
            settings={mapSettings.data}
            error={error}
            saved={resolvedParams.ok === "map"}
            action={saveMapSettingsAction}
          />
        )}

        {/* FANE 1: BRANDING */}
        {currentTab === "branding" && canBranding && (
          <div className="space-y-6">
            <BrandingTab
              branding={branding}
              error={error}
              saveBranding={saveBrandingAction}
            />
            <CalendarFeedSettings />
          </div>
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
            error={resolvedParams.error}
            page={page}
            baseUrl="/innstillinger?tab=ansatte"
          />
        )}

        {/* FANE 3: MALER & SJEKKLISTER */}
        {currentTab === "maler" && canTemplates && (
          <TemplatesTab
            templates={templates}
            isAdmin={isAdmin}
            categoryFilter={templateCategory}
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
            <SectionCard
              title={`🔐 ${t("settings.roles.title")}`}
              description={t("settings.roles.description")}
              className="mb-6"
            />
            <RolesAdmin
              roles={roleRows}
              error={resolvedParams.error}
              message={resolvedParams.role}
            />
          </div>
        )}

        {currentTab === "avdelinger" && isAdmin && (
          <div>
            <SectionCard
              title={`🏷️ ${t("settings.departments.title")}`}
              description={t("settings.departments.description")}
              className="mb-6"
            />
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
