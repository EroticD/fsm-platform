import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SettingsOverviewData } from "@/server/settings";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import TemplateCreateForm from "@/components/settings/TemplateCreateForm";
import { HMS_FORM_GROUPS } from "@/lib/hms";

type TemplateCategoryFilter = "SERVICE" | "HMS" | null;

type TemplatesTabProps = {
  templates: SettingsOverviewData["templates"];
  isAdmin: boolean;
  categoryFilter?: TemplateCategoryFilter;
  createTemplate: (formData: FormData) => Promise<void>;
  deleteTemplate: (formData: FormData) => Promise<void>;
};

function filterHref(category: TemplateCategoryFilter): string {
  return `/innstillinger?tab=maler${category ? `&category=${category}` : ""}`;
}

const filterClass = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    active
      ? "border-blue-300 bg-blue-50 text-blue-800"
      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
  }`;

export default async function TemplatesTab({
  templates,
  isAdmin,
  categoryFilter = null,
  createTemplate,
  deleteTemplate,
}: TemplatesTabProps) {
  const t = await getTranslations("common");

  const hmsTypes = HMS_FORM_GROUPS.map((group) => ({
    value: group.type,
    label: t(`settings.templates.hmsTypes.${group.type}`),
  }));
  const hmsTypeLabels = new Map(
    hmsTypes.map((option) => [option.value, option.label]),
  );

  const visibleTemplates = categoryFilter
    ? templates.filter((template) => template.category === categoryFilter)
    : templates;
  const serviceCount = templates.filter(
    (template) => template.category === "SERVICE",
  ).length;
  const hmsCount = templates.filter(
    (template) => template.category === "HMS",
  ).length;

  return (
    <div className="space-y-6">
      {/* Opprett ny mal */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t("settings.templates.createTitle")}</h2>
        <p className="text-sm text-gray-500 mb-5">{t("settings.templates.createDesc")}</p>

        <TemplateCreateForm createTemplate={createTemplate} hmsTypes={hmsTypes} />
      </div>

      {/* Eksisterende maler */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-gray-900">
            {t("settings.templates.available", { count: visibleTemplates.length })}
          </h2>
          <Link
            href="/innstillinger?tab=maler&category=HMS"
            className="text-sm font-bold text-blue-700 hover:text-blue-900"
          >
            🦺 {t("settings.templates.hmsTemplatesLink")}
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-black uppercase tracking-wider text-gray-500">
            {t("settings.templates.filterLabel")}
          </span>
          <Link href={filterHref(null)} className={filterClass(categoryFilter === null)}>
            {t("settings.templates.filterAll")} ({templates.length})
          </Link>
          <Link
            href={filterHref("SERVICE")}
            className={filterClass(categoryFilter === "SERVICE")}
          >
            {t("settings.templates.categories.SERVICE")} ({serviceCount})
          </Link>
          <Link
            href={filterHref("HMS")}
            className={filterClass(categoryFilter === "HMS")}
          >
            {t("settings.templates.categories.HMS")} ({hmsCount})
          </Link>
        </div>

        {visibleTemplates.length === 0 ? (
          <p className="text-sm text-gray-500 italic">{t("settings.templates.empty")}</p>
        ) : (
          <div className="space-y-3">
            {visibleTemplates.map((template) => {
              const usage =
                template._count.reports +
                template._count.workOrder +
                template._count.contracts;
              const deleteMessage =
                usage > 0
                  ? t("settings.templates.deleteUsageWarning", {
                      title: template.title,
                      reports: template._count.reports,
                      workOrders: template._count.workOrder,
                      contracts: template._count.contracts,
                    })
                  : t("settings.templates.deleteConfirm", {
                      title: template.title,
                    });
              const hmsLabel =
                template.category === "HMS" && template.hmsType
                  ? hmsTypeLabels.get(template.hmsType) ?? template.hmsType
                  : null;
              return (
              <div key={template.id} className="flex justify-between items-center gap-3 p-4 bg-gray-50 border border-gray-100 rounded-xl">
                <div className="min-w-0">
                  <span className="font-bold text-gray-800">{template.title}</span>
                  {template.description && (
                    <p className="text-sm text-gray-600 mt-1">
                      {template.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {template.category === "HMS" ? (
                      <span className="text-xs font-bold text-purple-900 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                        🦺 HMS{hmsLabel ? ` · ${hmsLabel}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-sky-900 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
                        {t("settings.templates.categories.SERVICE")}
                      </span>
                    )}
                    <span className="text-xs font-bold text-gray-700 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                      {t("settings.templateBuilder.reportName")}: {template.reportName || template.title}
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                        template.requiresUnits
                          ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                          : "text-amber-800 bg-amber-50 border-amber-200"
                      }`}
                    >
                      {template.requiresUnits ? "✓" : "✕"} {t("settings.templateBuilder.requiresUnits")}
                    </span>
                    {usage > 0 && (
                      <span className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        ⚠ {t("settings.templates.inUse", { count: usage })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/innstillinger/maler/${template.id}`}
                    className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-bold text-sm px-3 py-1.5 rounded-lg transition"
                  >
                    {t("settings.templates.edit")}
                  </Link>

                  {isAdmin && (
                    <ConfirmSubmitForm
                      action={deleteTemplate}
                      confirmMessage={deleteMessage}
                      confirmLabel={t("delete")}
                      danger
                    >
                      <input type="hidden" name="id" value={template.id} />
                      <button type="submit" className="text-red-700 hover:text-red-800 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">
                        {t("settings.templates.delete")}
                      </button>
                    </ConfirmSubmitForm>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
