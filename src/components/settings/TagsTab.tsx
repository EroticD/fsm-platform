import { getTranslations } from "next-intl/server";
import type { SettingsOverviewData } from "@/server/settings";

type TagsTabProps = {
  tags: SettingsOverviewData["tags"];
  documentTags: SettingsOverviewData["documentTags"];
  isAdmin: boolean;
  createTag: (formData: FormData) => Promise<void>;
  updateTag: (formData: FormData) => Promise<void>;
  deleteTag: (formData: FormData) => Promise<void>;
  createDocumentTag: (formData: FormData) => Promise<void>;
  updateDocumentTag: (formData: FormData) => Promise<void>;
  deleteDocumentTag: (formData: FormData) => Promise<void>;
};

export default async function TagsTab({
  tags,
  documentTags,
  isAdmin,
  createTag,
  updateTag,
  deleteTag,
  createDocumentTag,
  updateDocumentTag,
  deleteDocumentTag,
}: TagsTabProps) {
  const t = await getTranslations("common");

  return (
    <div className="space-y-6">
      {/* OPPDRAG-TAGS */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t("settings.tags.workOrdersTitle")}</h2>
        <p className="text-sm text-gray-500 mb-5">{t("settings.tags.workOrdersDesc")}</p>

        <form action={createTag} className="flex gap-3 max-w-lg flex-wrap mb-6">
          <input
            type="text"
            name="name"
            aria-label={t("settings.tags.name")}
            placeholder={t("settings.tags.namePlaceholder")}
            required
            className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium focus:border-blue-500 min-w-[150px]"
          />
          <input
            type="color"
            name="color"
            aria-label={t("settings.tags.color")}
            defaultValue="#3b82f6"
            className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300"
          />
          <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            {t("settings.tags.createButton")}
          </button>
        </form>

        {tags.length === 0 ? (
          <p className="text-sm text-gray-500 italic">{t("settings.tags.emptyWorkOrders")}</p>
        ) : (
          <div className="space-y-3">
            {tags.map((tag) => (
              <div key={tag.id} className="flex justify-between items-center p-4 bg-gray-50 border border-gray-100 rounded-xl flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-6 h-6 rounded-full border-2 border-gray-300" style={{ backgroundColor: tag.color }} suppressHydrationWarning />
                  <span className="font-bold text-gray-800">{tag.name}</span>
                  <span className="text-xs text-gray-500">{tag.color}</span>
                </div>
                <div className="flex gap-2">
                  <details className="relative">
                    <summary className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-bold text-sm px-3 py-1.5 rounded-lg transition cursor-pointer">
                      {t("settings.tags.edit")}
                    </summary>
                    <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-10 w-72">
                      <form action={updateTag} className="space-y-3">
                        <input type="hidden" name="id" value={tag.id} />
                        <div>
                          <label htmlFor={`tag-${tag.id}-name`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.tags.name")}</label>
                          <input id={`tag-${tag.id}-name`} type="text" name="name" defaultValue={tag.name} required className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                        </div>
                        <div>
                          <label htmlFor={`tag-${tag.id}-color`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.tags.color")}</label>
                          <input id={`tag-${tag.id}-color`} type="color" name="color" defaultValue={tag.color} className="w-10 h-10 p-1 rounded cursor-pointer border border-gray-300" />
                        </div>
                        <button type="submit" className="w-full bg-blue-700 text-white py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition">{t("settings.tags.save")}</button>
                      </form>
                    </div>
                  </details>
                  {isAdmin && (
                    <form action={deleteTag}>
                      <input type="hidden" name="id" value={tag.id} />
                      <button type="submit" className="text-red-500 hover:text-red-700 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">{t("settings.tags.delete")}</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DOKUMENT-TAGS */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t("settings.tags.documentsTitle")}</h2>
        <p className="text-sm text-gray-500 mb-5">{t("settings.tags.documentsDesc")}</p>

        <form action={createDocumentTag} className="flex gap-3 max-w-lg flex-wrap mb-6">
          <input
            type="text"
            name="name"
            aria-label={t("settings.tags.name")}
            placeholder={t("settings.tags.namePlaceholder")}
            required
            className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium focus:border-blue-500 min-w-[150px]"
          />
          <input
            type="color"
            name="color"
            aria-label={t("settings.tags.color")}
            defaultValue="#10b981"
            className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300"
          />
          <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            {t("settings.tags.createButton")}
          </button>
        </form>

        {documentTags.length === 0 ? (
          <p className="text-sm text-gray-500 italic">{t("settings.tags.emptyDocuments")}</p>
        ) : (
          <div className="space-y-3">
            {documentTags.map((tag) => (
              <div key={tag.id} className="flex justify-between items-center p-4 bg-gray-50 border border-gray-100 rounded-xl flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-6 h-6 rounded-full border-2 border-gray-300" style={{ backgroundColor: tag.color }} suppressHydrationWarning />
                  <span className="font-bold text-gray-800">{tag.name}</span>
                  <span className="text-xs text-gray-500">{tag.color}</span>
                </div>
                <div className="flex gap-2">
                  <details className="relative">
                    <summary className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-bold text-sm px-3 py-1.5 rounded-lg transition cursor-pointer">
                      {t("settings.tags.edit")}
                    </summary>
                    <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-10 w-72">
                      <form action={updateDocumentTag} className="space-y-3">
                        <input type="hidden" name="id" value={tag.id} />
                        <div>
                          <label htmlFor={`doctag-${tag.id}-name`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.tags.name")}</label>
                          <input id={`doctag-${tag.id}-name`} type="text" name="name" defaultValue={tag.name} required className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                        </div>
                        <div>
                          <label htmlFor={`doctag-${tag.id}-color`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.tags.color")}</label>
                          <input id={`doctag-${tag.id}-color`} type="color" name="color" defaultValue={tag.color} className="w-10 h-10 p-1 rounded cursor-pointer border border-gray-300" />
                        </div>
                        <button type="submit" className="w-full bg-blue-700 text-white py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition">{t("settings.tags.save")}</button>
                      </form>
                    </div>
                  </details>
                  {isAdmin && (
                    <form action={deleteDocumentTag}>
                      <input type="hidden" name="id" value={tag.id} />
                      <button type="submit" className="text-red-500 hover:text-red-700 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">{t("settings.tags.delete")}</button>
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
