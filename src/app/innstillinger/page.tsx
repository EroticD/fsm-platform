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
import ApiKeysTab from "@/components/settings/ApiKeysTab";
import SlaSettingsTab from "@/components/settings/SlaSettingsTab";
import SmsSettingsTab from "@/components/settings/SmsSettingsTab";
import DispatchSettingsTab from "@/components/settings/DispatchSettingsTab";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/icons";
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
import { listApiKeys } from "@/server/api-keys";
import { getSlaSettingsView } from "@/server/sla";
import { getSmsSettingsView } from "@/server/sms";
import { getDispatchSettings } from "@/server/dispatch";
import { listPriceLists } from "@/server/contracts";
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
import { createApiKeyAction, revokeApiKeyAction } from "./api-actions";
import {
  addPriceListItemAction,
  createPriceListAction,
  deactivateSlaPolicyAction,
  deleteHolidayAction,
  deletePriceListItemAction,
  saveBusinessHoursAction,
  saveHolidayAction,
  saveSlaPolicyAction,
} from "./sla-actions";
import {
  saveSmsSettingsAction,
  saveSmsTemplateAction,
} from "./sms-actions";
import {
  deleteTerritoryAction,
  saveDispatchPolicyAction,
  saveTerritoryAction,
} from "./dispatch-actions";

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
    department?: string;
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
  const canSla = hasPermission(user, "sla.manage");
  const canSms = hasPermission(user, "settings.manage");
  const canDispatch =
    hasPermission(user, "dispatch.configure") ||
    hasPermission(user, "settings.manage");
  const canUseSettings =
    canBranding ||
    canMap ||
    canUsers ||
    canTemplates ||
    canDocuments ||
    canAudit ||
    canStats ||
    canSla ||
    canSms ||
    canDispatch ||
    isAdmin;
  // Lesetilgang til statistikk/aktivitetslogg er ikke det samme som å kunne
  // administrere systemet. Tekstene skal ikke love mer enn rettighetene.
  const canManageSettings =
    canBranding ||
    canMap ||
    canTemplates ||
    canDocuments ||
    isAdmin ||
    hasPermission(user, "users.manage");

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
    canSla,
    canSms,
    canDispatch,
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

  const apiKeys =
    currentTab === "api" && isAdmin ? await listApiKeys(user) : null;

  const slaSettings =
    currentTab === "sla" && canSla
      ? await getSlaSettingsView(user, resolvedParams.department)
      : null;
  const smsSettings =
    currentTab === "sms" && canSms ? await getSmsSettingsView(user) : null;
  const priceLists =
    currentTab === "sla" && hasPermission(user, "contracts.manage")
      ? await listPriceLists(user)
      : null;

  const dispatchSettings =
    currentTab === "dispatch" && canDispatch
      ? await getDispatchSettings(user, resolvedParams.department)
      : null;

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title={t("settings.title")}
          subtitle={
            canManageSettings
              ? t("settings.subtitle")
              : t("settings.subtitleReadOnly")
          }
          icon={<Icon name="settings" className="h-5 w-5" />}
          actions={
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("settings.backToDashboard")}
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
          canSla={canSla}
          canSms={canSms}
          canDispatch={canDispatch}
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

        {currentTab === "sla" && canSla && slaSettings?.ok && (
          <SlaSettingsTab
            policies={slaSettings.data.policies}
            departments={slaSettings.data.departments}
            departmentId={slaSettings.data.departmentId}
            hours={slaSettings.data.hours}
            holidays={slaSettings.data.holidays}
            priceLists={
              priceLists?.ok ? priceLists.data.priceLists : []
            }
            canManageContracts={hasPermission(user, "contracts.manage")}
            error={resolvedParams.error}
            ok={resolvedParams.ok}
            savePolicy={saveSlaPolicyAction}
            deactivatePolicy={deactivateSlaPolicyAction}
            saveHours={saveBusinessHoursAction}
            saveHoliday={saveHolidayAction}
            deleteHoliday={deleteHolidayAction}
            createPriceList={createPriceListAction}
            addPriceItem={addPriceListItemAction}
            deletePriceItem={deletePriceListItemAction}
          />
        )}

        {currentTab === "sms" && canSms && smsSettings?.ok && (
          <SmsSettingsTab
            settings={{
              defaultLocale: smsSettings.data.settings.defaultLocale,
              optOutKeywords: smsSettings.data.settings.optOutKeywords,
              optInKeywords: smsSettings.data.settings.optInKeywords,
              monthlyCap: smsSettings.data.settings.monthlyCap,
            }}
            templates={smsSettings.data.templates}
            provider={smsSettings.data.provider}
            senderId={smsSettings.data.senderId}
            error={resolvedParams.error}
            ok={resolvedParams.ok}
            saveSettings={saveSmsSettingsAction}
            saveTemplate={saveSmsTemplateAction}
          />
        )}

        {currentTab === "dispatch" && canDispatch && dispatchSettings?.ok && (
          <DispatchSettingsTab
            policies={dispatchSettings.data.policies}
            territories={dispatchSettings.data.territories}
            departments={departmentRows.map((department) => ({
              id: department.id,
              name: department.name,
              isDefault: department.isDefault,
            }))}
            departmentId={
              resolvedParams.department ??
              departmentRows.find((department) => department.isDefault)?.id ??
              departmentRows[0]?.id ??
              ""
            }
            error={resolvedParams.error}
            ok={resolvedParams.ok}
            savePolicy={saveDispatchPolicyAction}
            saveTerritory={saveTerritoryAction}
            deleteTerritory={deleteTerritoryAction}
          />
        )}

        {currentTab === "roller" && isAdmin && (
          <div className="space-y-4">
            <div className="office-card flex items-start gap-3 p-4 sm:p-5">
              <span
                aria-hidden="true"
                className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
                  <Icon name="shield" className="h-4 w-4 shrink-0" />
                  {t("settings.roles.title")}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                  {t("settings.roles.description")}
                </p>
              </div>
            </div>
            <RolesAdmin
              roles={roleRows}
              error={resolvedParams.error}
              message={resolvedParams.role}
            />
          </div>
        )}

        {currentTab === "avdelinger" && isAdmin && (
          <div className="space-y-4">
            <div className="office-card flex items-start gap-3 p-4 sm:p-5">
              <span
                aria-hidden="true"
                className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
              />
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
                  <Icon name="building" className="h-4 w-4 shrink-0" />
                  {t("settings.departments.title")}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                  {t("settings.departments.description")}
                </p>
              </div>
            </div>
            <DepartmentsAdmin departments={departmentRows} />
          </div>
        )}

        {currentTab === "api" && isAdmin && (
          <ApiKeysTab
            keys={apiKeys?.ok ? apiKeys.keys : []}
            error={
              apiKeys && !apiKeys.ok ? apiKeys.error : resolvedParams.error
            }
            createKey={createApiKeyAction}
            revokeKey={revokeApiKeyAction}
          />
        )}

        {currentTab === "sikkerhet" && (
          <SecuritySettings
            user={{
              id: user.id,
              email: user.email,
              name: user.name,
              isTwoFactorEnabled: user.isTwoFactorEnabled,
              twoFactorSecret: user.twoFactorSecret,
              twoFactorSetupStartedAt: user.twoFactorSetupStartedAt,
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
