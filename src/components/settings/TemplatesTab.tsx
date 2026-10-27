import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SettingsOverviewData } from "@/server/settings";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";

type TemplatesTabProps = {
  templates: SettingsOverviewData["templates"];
  isAdmin: boolean;
  createTemplate: (formData: FormData) => Promise<void>;
  deleteTemplate: (formData: FormData) => Promise<void>;
};

export default async function TemplatesTab({
  templates,
  isAdmin,
  createTemplate,
  deleteTemplate,
}: TemplatesTabProps) {
  const t = await getTranslations("common");

  return (
    <div className="space-y-6">
      {/* Opprett ny mal */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t("settings.templates.createTitle")}</h2>
        <p className="text-sm text-gray-500 mb-5">{t("settings.templates.createDesc")}</p>

        <form action={createTemplate} className="max-w-lg space-y-3">
          <input
            type="text"
            name="title"
            placeholder={t("settings.templates.titlePlaceholder")}
            required
            className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
          />
          <input
            type="text"
            name="reportName"
            placeholder={t("settings.templates.reportNamePlaceholder")}
            className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
          />
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input type="hidden" name="requiresUnits" value="false" />
            <input
              type="checkbox"
              name="requiresUnits"
              value="true"
              defaultChecked
              className="w-4 h-4 rounded border-gray-400 text-blue-700 focus:ring-blue-600"
            />
            {t("settings.templates.createRequiresUnits")}
          </label>
          <button type="submit" className="w-full bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            {t("settings.templates.createButton")}
          </button>
        </form>
      </div>

      {/* Eksisterende maler */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          {t("settings.templates.available", { count: templates.length })}
        </h2>

        {templates.length === 0 ? (
          <p className="text-sm text-gray-500 italic">{t("settings.templates.empty")}</p>
        ) : (
          <div className="space-y-3">
            {templates.map((template) => {
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
              return (
              <div key={template.id} className="flex justify-between items-center gap-3 p-4 bg-gray-50 border border-gray-100 rounded-xl">
                <div className="min-w-0">
                  <span className="font-bold text-gray-800">{template.title}</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <span className="text-[11px] font-bold text-gray-700 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                      {t("settings.templateBuilder.reportName")}: {template.reportName || template.title}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                        template.requiresUnits
                          ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                          : "text-amber-800 bg-amber-50 border-amber-200"
                      }`}
                    >
                      {template.requiresUnits ? "✓" : "✕"} {t("settings.templateBuilder.requiresUnits")}
                    </span>
                    {usage > 0 && (
                      <span className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
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
                    >
                      <input type="hidden" name="id" value={template.id} />
                      <button type="submit" className="text-red-500 hover:text-red-700 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">
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
