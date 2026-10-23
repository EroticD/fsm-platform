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

export default function TagsTab({
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
  return (
    <div className="space-y-6">
      {/* OPPDRAG-TAGS */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Tags for oppdrag</h2>
        <p className="text-sm text-gray-500 mb-5">Brukes for å spore beredskap på oppdrag (f.eks. klar, mangler-deler, trenger-gjennomgang).</p>

        <form action={createTag} className="flex gap-3 max-w-lg flex-wrap mb-6">
          <input
            type="text"
            name="name"
            placeholder="Navn på tag"
            required
            className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500 min-w-[150px]"
          />
          <input
            type="color"
            name="color"
            defaultValue="#3b82f6"
            className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300"
          />
          <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            + Opprett
          </button>
        </form>

        {tags.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Ingen oppdrag-tags opprettet ennå.</p>
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
                      Rediger
                    </summary>
                    <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-10 w-72">
                      <form action={updateTag} className="space-y-3">
                        <input type="hidden" name="id" value={tag.id} />
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Navn</label>
                          <input type="text" name="name" defaultValue={tag.name} required className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Farge</label>
                          <input type="color" name="color" defaultValue={tag.color} className="w-10 h-10 p-1 rounded cursor-pointer border border-gray-300" />
                        </div>
                        <button type="submit" className="w-full bg-blue-700 text-white py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition">Lagre</button>
                      </form>
                    </div>
                  </details>
                  {isAdmin && (
                    <form action={deleteTag}>
                      <input type="hidden" name="id" value={tag.id} />
                      <button type="submit" className="text-red-500 hover:text-red-700 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">Slett</button>
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
        <h2 className="text-xl font-bold text-gray-900 mb-2">Tags for dokumenter</h2>
        <p className="text-sm text-gray-500 mb-5">Brukes for å kategorisere og søke i dokumentbiblioteket.</p>

        <form action={createDocumentTag} className="flex gap-3 max-w-lg flex-wrap mb-6">
          <input
            type="text"
            name="name"
            placeholder="Navn på tag"
            required
            className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500 min-w-[150px]"
          />
          <input
            type="color"
            name="color"
            defaultValue="#10b981"
            className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300"
          />
          <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            + Opprett
          </button>
        </form>

        {documentTags.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Ingen dokument-tags opprettet ennå.</p>
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
                      Rediger
                    </summary>
                    <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-10 w-72">
                      <form action={updateDocumentTag} className="space-y-3">
                        <input type="hidden" name="id" value={tag.id} />
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Navn</label>
                          <input type="text" name="name" defaultValue={tag.name} required className="w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 font-medium" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Farge</label>
                          <input type="color" name="color" defaultValue={tag.color} className="w-10 h-10 p-1 rounded cursor-pointer border border-gray-300" />
                        </div>
                        <button type="submit" className="w-full bg-blue-700 text-white py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition">Lagre</button>
                      </form>
                    </div>
                  </details>
                  {isAdmin && (
                    <form action={deleteDocumentTag}>
                      <input type="hidden" name="id" value={tag.id} />
                      <button type="submit" className="text-red-500 hover:text-red-700 font-bold text-sm px-3 py-1.5 bg-red-50 rounded-lg hover:bg-red-100 transition">Slett</button>
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
