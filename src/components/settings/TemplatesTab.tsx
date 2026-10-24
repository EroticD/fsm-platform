import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SettingsOverviewData } from "@/server/settings";

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

        <form action={createTemplate} className="flex gap-3 max-w-lg">
          <input
            type="text"
            name="title"
            placeholder={t("settings.templates.titlePlaceholder")}
            required
            className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
          />
          <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
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
            {templates.map((template) => (
              <div key={template.id} className="flex justify-between items-center p-4 bg-gray-50 border border-gray-100 rounded-xl">
                <span className="font-bold text-gray-800">{template.title}</span>

                <div className="flex gap-2">
                  <Link
                    href={`/innstillinger/maler/${template.id}`}
                    className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-bold text-sm px-3 py-1.5 rounded-lg transition"
                  >
                    {t("settings.templates.edit")}
                  </Link>

                  {isAdmin && (
                    <form action={deleteTemplate}>
                      <input type="hidden" name="id" value={template.id} />
                      <button type="submit" className="text-red-500 hover:text-red-700 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">
                        {t("settings.templates.delete")}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
