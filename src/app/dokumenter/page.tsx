import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { parsePage } from "@/lib/pagination";
import { getDocumentLibrary } from "@/server/documents";
import DocumentBrowser from "@/components/documents/DocumentBrowser";
import { safeDocumentReturnTo } from "@/components/documents/document-links";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/icons";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.dokumenter") };
}

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
    returnTo?: string;
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
  // Søkeomfanget er eksplisitt, men standarden følger konteksten: inne i en
  // mappe søker vi i mappen, på rot i hele biblioteket. `scope=folder` på rot
  // gir bare løse rotfiler.
  const scopeParam = resolved.scope ?? "";
  const onlyFolder = folderId
    ? scopeParam !== "library"
    : scopeParam === "folder";
  const libraryScope = Boolean(folderId) && scopeParam === "library";
  const returnTo = safeDocumentReturnTo(resolved.returnTo);
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
    libraryScope,
  });
  if (!result.ok) redirect("/");

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          title={t("documents.page.title")}
          subtitle={t("documents.page.description")}
          icon={<Icon name="folder" className="h-5 w-5" />}
          actions={
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("documents.page.dashboard")}
            </Link>
          }
        />

        {error === "ugyldig-data" && (
          <div className="flex items-center gap-2 rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {t("documents.page.errorInvalidData")}
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
            returnTo,
          ])}
          data={result.data}
          folderId={folderId}
          searchQuery={searchQuery}
          tagFilter={tagFilter}
          onlyFolder={onlyFolder}
          returnTo={returnTo}
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
