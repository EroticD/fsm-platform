import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { parsePage } from "@/lib/pagination";
import { getDocumentLibrary } from "@/server/documents";
import DocumentBrowser from "@/components/documents/DocumentBrowser";
import {
  bulkCreateDocuments,
  createDocument,
  createFolder,
  deleteDocument,
  reindexDocuments,
  restoreDocument,
  restoreVersion,
  updateDocument,
} from "./actions";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    folder?: string;
    q?: string;
    tag?: string;
    page?: string;
    doc?: string;
    error?: string;
    slettet?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "documents.view")) redirect("/");

  const t = await getTranslations("common");

  const office = hasPermission(user, "documents.manage");
  const isAdmin = user.role === "ADMIN";

  const resolved = await searchParams;
  const folderId = resolved.folder || null;
  const searchQuery = resolved.q?.trim() || "";
  const tagFilter = resolved.tag || "";
  const error = resolved.error;
  const page = parsePage(resolved.page);
  const showDeleted = resolved.slettet === "1" && isAdmin;

  const result = await getDocumentLibrary(user, {
    folderId,
    search: searchQuery,
    tag: tagFilter,
    page,
    documentId: resolved.doc || null,
    deleted: showDeleted,
  });
  if (!result.ok) redirect("/");

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">{t("documents.page.title")}</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              {t("documents.page.description")}
            </p>
          </div>
          <Link href="/" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap">
            ← {t("documents.page.dashboard")}
          </Link>
        </div>

        {error === "ugyldig-data" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            ⛔ {t("documents.page.errorInvalidData")}
          </div>
        )}

        <DocumentBrowser
          data={result.data}
          folderId={folderId}
          searchQuery={searchQuery}
          tagFilter={tagFilter}
          page={page}
          office={office}
          isAdmin={isAdmin}
          showDeleted={showDeleted}
          createFolderAction={createFolder.bind(null, folderId)}
          restoreVersionAction={restoreVersion}
          deleteDocumentAction={deleteDocument}
          restoreDocumentAction={restoreDocument}
          updateDocumentAction={updateDocument}
          createDocumentAction={createDocument}
          bulkCreateDocumentsAction={bulkCreateDocuments}
          reindexDocumentsAction={reindexDocuments}
        />
      </div>
    </div>
  );
}
