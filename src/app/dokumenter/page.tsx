import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { parsePage } from "@/lib/pagination";
import { getDocumentLibrary } from "@/server/documents";
import DocumentBrowser from "@/components/documents/DocumentBrowser";
import PageHeader from "@/components/PageHeader";
import {
  bulkCreateDocuments,
  bulkDeleteDocuments,
  bulkMoveDocuments,
  bulkTagDocuments,
  createDocument,
  createFolder,
  deleteDocument,
  deleteFolder,
  discardDocumentUploads,
  moveFolder,
  reindexDocuments,
  renameFolder,
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
    scope?: string;
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
  const onlyFolder = resolved.scope === "folder";
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
    onlyFolder,
  });
  if (!result.ok) redirect("/");

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader
          title={t("documents.page.title")}
          subtitle={t("documents.page.description")}
          actions={
            <Link href="/" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap">
              ← {t("documents.page.dashboard")}
            </Link>
          }
        />

        {error === "ugyldig-data" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            ⛔ {t("documents.page.errorInvalidData")}
          </div>
        )}

        <DocumentBrowser
          key={JSON.stringify([
            folderId,
            searchQuery,
            tagFilter,
            page,
            onlyFolder,
            showDeleted,
          ])}
          data={result.data}
          folderId={folderId}
          searchQuery={searchQuery}
          tagFilter={tagFilter}
          onlyFolder={onlyFolder}
          page={page}
          office={office}
          isAdmin={isAdmin}
          showDeleted={showDeleted}
          createFolderAction={createFolder}
          restoreVersionAction={restoreVersion}
          deleteDocumentAction={deleteDocument}
          restoreDocumentAction={restoreDocument}
          updateDocumentAction={updateDocument}
          createDocumentAction={createDocument}
          bulkCreateDocumentsAction={bulkCreateDocuments}
          bulkMoveDocumentsAction={bulkMoveDocuments}
          bulkDeleteDocumentsAction={bulkDeleteDocuments}
          bulkTagDocumentsAction={bulkTagDocuments}
          discardUploadsAction={discardDocumentUploads}
          renameFolderAction={renameFolder}
          moveFolderAction={moveFolder}
          deleteFolderAction={deleteFolder}
          reindexDocumentsAction={reindexDocuments}
        />
      </div>
    </div>
  );
}
