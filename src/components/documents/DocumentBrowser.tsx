import Link from "next/link";
import type { DocumentLibraryData } from "@/server/documents";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import UploadDocumentForm from "@/app/dokumenter/UploadDocumentForm";
import BulkUploadForm from "@/app/dokumenter/BulkUploadForm";
import EditDocumentForm from "@/app/dokumenter/EditDocumentForm";

type DocumentBrowserProps = {
  data: DocumentLibraryData;
  folderId: string | null;
  searchQuery: string;
  tagFilter: string;
  page: number;
  office: boolean;
  isAdmin: boolean;
  createFolderAction: (formData: FormData) => Promise<void>;
  restoreVersionAction: (formData: FormData) => Promise<void>;
  deleteDocumentAction: (formData: FormData) => Promise<void>;
  updateDocumentAction: (formData: FormData) => Promise<void>;
  createDocumentAction: (formData: FormData) => Promise<void>;
  bulkCreateDocumentsAction: (formData: FormData) => Promise<void>;
  reindexDocumentsAction: (formData: FormData) => Promise<void>;
};

export default function DocumentBrowser({
  data,
  folderId,
  searchQuery,
  tagFilter,
  page,
  office,
  isAdmin,
  createFolderAction,
  restoreVersionAction,
  deleteDocumentAction,
  updateDocumentAction,
  createDocumentAction,
  bulkCreateDocumentsAction,
  reindexDocumentsAction,
}: DocumentBrowserProps) {
  const {
    breadcrumb,
    subFolders,
    documents,
    totalDocuments,
    totalPages,
    detailDocument,
    existingFiles,
    folderOptions,
    allTags,
  } = data;

  const folderLink = (fid: string | null) => {
    const params = new URLSearchParams();
    if (fid) params.set("folder", fid);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  const tagLink = (tagName: string) => {
    const params = new URLSearchParams();
    if (folderId) params.set("folder", folderId);
    if (searchQuery) params.set("q", searchQuery);
    if (tagName) params.set("tag", tagName);
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  const pageLink = (nextPage: number) => {
    const params = new URLSearchParams();
    if (folderId) params.set("folder", folderId);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  const docLink = (id: string) => {
    const params = new URLSearchParams();
    if (folderId) params.set("folder", folderId);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    params.set("doc", id);
    return `/dokumenter?${params.toString()}`;
  };

  return (
    <>
      {/* SØK + TAG-FILTER */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
        <form method="GET" action="/dokumenter" className="flex flex-wrap gap-2">
          {folderId && <input type="hidden" name="folder" value={folderId} />}
          {tagFilter && <input type="hidden" name="tag" value={tagFilter} />}
          <input
            type="search"
            name="q"
            defaultValue={searchQuery}
            placeholder="Søk i tittel, beskrivelse, filnavn eller tags..."
            className="flex-1 min-w-[14rem] border-2 border-gray-200 p-2.5 rounded-xl text-sm font-medium text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
          />
          <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition">
            Søk
          </button>
          {(searchQuery || tagFilter) && (
            <Link
              href={folderLink(folderId)}
              className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
            >
              Nullstill
            </Link>
          )}
        </form>

        {/* Tag-filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider self-center">Filter på tag:</span>
            {allTags.map((tag) => (
              <Link
                key={tag.id}
                href={tagFilter === tag.name ? folderLink(folderId) : tagLink(tag.name)}
                className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition ${
                  tagFilter === tag.name
                    ? "text-white border-transparent"
                    : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                }`}
                style={tagFilter === tag.name ? { backgroundColor: tag.color } : {}}
              >
                🏷️ {tag.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* BREADCRUMB */}
      <div className="flex items-center gap-2 text-sm font-bold text-gray-600 flex-wrap">
        <Link href="/dokumenter" className="hover:text-blue-700 transition">📁 Rot</Link>
        {breadcrumb.map((f, i) => (
          <span key={f.id} className="flex items-center gap-2">
            <span className="text-gray-400">/</span>
            {i === breadcrumb.length - 1 ? (
              <span className="text-gray-900">{f.name}</span>
            ) : (
              <Link href={folderLink(f.id)} className="hover:text-blue-700 transition">{f.name}</Link>
            )}
          </span>
        ))}
      </div>

      {/* DOKUMENTDETALJ – versjoner lastes bare her */}
      {detailDocument && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200 space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
            <div className="min-w-0">
              <h2 className="font-black text-gray-900 truncate">🗂️ {detailDocument.title}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {detailDocument.fileName} • {(detailDocument.fileSize / 1024).toFixed(0)} KB
                {detailDocument.versions.length > 0
                  ? ` • ${detailDocument.versions.length} tidligere versjon(er)`
                  : " • Ingen tidligere versjoner"}
              </p>
            </div>
            <Link
              href={pageLink(page)}
              className="bg-gray-100 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 transition whitespace-nowrap"
            >
              ✕ Lukk
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={detailDocument.filePath}
              target="_blank"
              rel="noreferrer"
              className="bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
            >
              📖 Åpne PDF
            </a>
            {office && (
              <EditDocumentForm
                doc={detailDocument}
                allFolders={folderOptions}
                allTags={allTags}
                updateDocument={updateDocumentAction}
                restoreVersion={restoreVersionAction}
              />
            )}
          </div>
        </div>
      )}

      {/* UNDERMAPPER */}
      {subFolders.length > 0 && (
        <div>
          <h2 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-3">Undermapper</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {subFolders.map((f) => (
              <Link
                key={f.id}
                href={folderLink(f.id)}
                className="bg-white p-4 rounded-2xl shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition text-center"
              >
                <div className="text-3xl mb-1">📁</div>
                <p className="font-bold text-gray-900 text-sm truncate">{f.name}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* DOKUMENTER */}
      <div>
        <h2 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-3">
          Dokumenter ({totalDocuments})
        </h2>
        {documents.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">Ingen dokumenter i denne mappen.</p>
            <p className="text-xs text-gray-500 mt-1">
              {searchQuery || tagFilter
                ? "Prøv et annet søkeord eller fjern filteret."
                : "Last opp en PDF nedenfor."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xl">📄</span>
                      <p className="font-black text-gray-900 truncate">{doc.title}</p>
                    </div>
                    {doc.description && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{doc.description}</p>
                    )}
                    <p className="text-[10px] text-gray-500 mt-1">
                      {doc.fileName} • {(doc.fileSize / 1024).toFixed(0)} KB
                      {doc.uploadedBy ? ` • Lastet opp av ${doc.uploadedBy}` : ""}
                    </p>
                    {doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {doc.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="text-white px-2 py-0.5 rounded-full text-[9px] font-bold shadow-sm"
                            suppressHydrationWarning
                            style={{ backgroundColor: tag.color || "#3b82f6" }}
                          >
                            🏷️ {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    <a
                      href={doc.filePath}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
                    >
                      📖 Åpne PDF
                    </a>
                    {office && (
                      <Link
                        href={docLink(doc.id)}
                        className="bg-gray-100 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 transition whitespace-nowrap"
                      >
                        🗂️ Versjoner
                      </Link>
                    )}
                    {office && (
                      <EditDocumentForm
                        doc={doc}
                        allFolders={folderOptions}
                        allTags={allTags}
                        updateDocument={updateDocumentAction}
                        restoreVersion={restoreVersionAction}
                      />
                    )}
                    {isAdmin && (
                      <ConfirmSubmitForm action={deleteDocumentAction} confirmMessage={`Slette dokumentet «${doc.title}»?`}>
                        <input type="hidden" name="id" value={doc.id} />
                        <button
                          type="submit"
                          className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-xl border border-red-200 transition whitespace-nowrap"
                        >
                          🗑️ Slett
                        </button>
                      </ConfirmSubmitForm>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-3 mt-3 text-sm font-bold">
            {page > 1 && (
              <Link href={pageLink(page - 1)} className="text-blue-700 hover:underline">
                &larr; Forrige
              </Link>
            )}
            <span className="text-gray-500 text-xs">
              Side {page} av {totalPages} • {totalDocuments} dokument(er)
            </span>
            {page < totalPages && (
              <Link href={pageLink(page + 1)} className="text-blue-700 hover:underline">
                Neste &rarr;
              </Link>
            )}
          </div>
        )}
      </div>

      {/* OPPLASTING + NY MAPPE (kontor only) */}
      {office && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* NY MAPPE */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4">📁 Opprett ny mappe</h2>
            <form action={createFolderAction} className="flex gap-3">
              <input
                type="text"
                name="name"
                placeholder="Navn på mappe"
                required
                className="flex-1 min-w-0 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
              />
              <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm whitespace-nowrap">
                + Opprett
              </button>
            </form>
          </div>

          {/* LAST OPP DOKUMENT */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4">⬆️ Last opp PDF</h2>
            <UploadDocumentForm folderId={folderId} allTags={allTags} createDocument={createDocumentAction} />
          </div>

          {/* LAST OPP MAPPESTRUKTUR */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 lg:col-span-2">
            <h2 className="text-lg font-bold text-gray-900 mb-2">📥 Last opp mappestruktur</h2>
            <p className="text-sm text-gray-500 mb-4">
              Velg en mappe på din PC. Alle PDF-filer lastes opp og undermapper opprettes automatisk.
            </p>
            <BulkUploadForm folderId={folderId} allTags={allTags} existingFiles={existingFiles} bulkCreateDocuments={bulkCreateDocumentsAction} />

            <div className="border-t-2 border-gray-200 pt-4 mt-4">
              <form action={reindexDocumentsAction}>
                <button
                  type="submit"
                  className="w-full bg-gray-200 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-300 transition shadow-sm"
                >
                  🔄 Indekser alle PDF-er for søk
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  Ekstraherer tekst fra PDF-ene slik at innhold kan søkes på. Kjøres automatisk ved opplasting, men kan kjøres manuelt for å fylle ut manglende.
                </p>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
