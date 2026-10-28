"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { readableTextColor } from "@/lib/colors";
import type {
  DocumentBulkMutationResult,
  DocumentLibraryData,
} from "@/server/documents";
import ConfirmDialog from "@/components/ConfirmDialog";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Pagination, {
  clampPage,
  paginationLabels,
} from "@/components/Pagination";
import UploadDocumentForm from "@/app/dokumenter/UploadDocumentForm";
import BulkUploadForm from "@/app/dokumenter/BulkUploadForm";
import EditDocumentForm from "@/app/dokumenter/EditDocumentForm";
import DocumentContextFields from "@/app/dokumenter/DocumentContextFields";
import type {
  DocumentActionResult,
  DocumentBulkActionResult,
  DocumentBulkMutationActionResult,
  DocumentDiscardUploadsResult,
  DocumentFormContext,
} from "@/app/dokumenter/action-types";
import { resetHref, toggleTagHref } from "./document-links";

type Folder = { id: string; name: string; parentId: string | null };

type DocumentBrowserProps = {
  data: DocumentLibraryData;
  folderId: string | null;
  searchQuery: string;
  tagFilter: string;
  onlyFolder: boolean;
  page: number;
  office: boolean;
  isAdmin: boolean;
  showDeleted: boolean;
  createFolderAction: (formData: FormData) => Promise<DocumentActionResult>;
  renameFolderAction: (formData: FormData) => Promise<DocumentActionResult>;
  moveFolderAction: (formData: FormData) => Promise<DocumentActionResult>;
  deleteFolderAction: (formData: FormData) => Promise<DocumentActionResult>;
  restoreVersionAction: (formData: FormData) => Promise<void>;
  deleteDocumentAction: (formData: FormData) => Promise<void>;
  restoreDocumentAction: (formData: FormData) => Promise<void>;
  updateDocumentAction: (formData: FormData) => Promise<void>;
  createDocumentAction: (formData: FormData) => Promise<void>;
  bulkCreateDocumentsAction: (
    formData: FormData,
  ) => Promise<DocumentBulkActionResult>;
  bulkMoveDocumentsAction: (
    formData: FormData,
  ) => Promise<DocumentBulkMutationActionResult>;
  bulkDeleteDocumentsAction: (
    formData: FormData,
  ) => Promise<DocumentBulkMutationActionResult>;
  bulkTagDocumentsAction: (
    formData: FormData,
  ) => Promise<DocumentBulkMutationActionResult>;
  discardUploadsAction: (
    formData: FormData,
  ) => Promise<DocumentDiscardUploadsResult>;
  reindexDocumentsAction: (formData: FormData) => Promise<void>;
};

const ACTION_ERROR_KEYS: Record<string, string> = {
  forbidden: "documents.errors.forbidden",
  invalid: "documents.errors.invalid",
  not_found: "documents.errors.notFound",
  conflict: "documents.errors.conflict",
  not_owned: "documents.errors.notOwned",
  error: "documents.errors.generic",
};

function errorKey(reason: string): string {
  return ACTION_ERROR_KEYS[reason] ?? "documents.errors.generic";
}

/** Alle mapper under en gitt mappe, brukt for å hindre sykliske flyttinger. */
function descendantIds(folders: Folder[], rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

function FolderMenu({
  folder,
  allFolders,
  office,
  isAdmin,
  renameFolderAction,
  moveFolderAction,
  deleteFolderAction,
  onDeleted,
}: {
  folder: Folder;
  allFolders: Folder[];
  office: boolean;
  isAdmin: boolean;
  renameFolderAction: (formData: FormData) => Promise<DocumentActionResult>;
  moveFolderAction: (formData: FormData) => Promise<DocumentActionResult>;
  deleteFolderAction: (formData: FormData) => Promise<DocumentActionResult>;
  onDeleted?: () => void;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [mode, setMode] = useState<
    "closed" | "menu" | "rename" | "move" | "delete"
  >("closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!office && !isAdmin) return null;

  const blockedIds = descendantIds(allFolders, folder.id);

  async function run(
    action: (formData: FormData) => Promise<DocumentActionResult>,
    formData: FormData,
    afterSuccess?: () => void,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await action(formData);
      if (!result.ok) {
        setError(
          result.reason === "conflict"
            ? t("documents.folders.notEmpty")
            : t(errorKey(result.reason)),
        );
        return false;
      }
      setMode("closed");
      router.refresh();
      afterSuccess?.();
      return true;
    } catch {
      setError(t("documents.errors.generic"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("id", folder.id);
    await run(renameFolderAction, formData);
  }

  async function handleMove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("id", folder.id);
    await run(moveFolderAction, formData);
  }

  async function handleDelete() {
    const formData = new FormData();
    formData.set("id", folder.id);
    const ok = await run(deleteFolderAction, formData, onDeleted);
    if (!ok) setMode("menu");
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setMode(mode === "closed" ? "menu" : "closed");
          setError(null);
        }}
        aria-label={t("documents.folders.menu", { name: folder.name })}
        title={t("documents.folders.menu", { name: folder.name })}
        className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-600 font-black hover:bg-gray-100 transition"
      >
        ⋯
      </button>

      {mode !== "closed" && (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-xl border-2 border-gray-200 bg-white p-3 shadow-xl">
          {mode === "menu" && (
            <div className="space-y-1">
              {office && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("rename");
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-100"
                >
                  ✏️ {t("documents.folders.rename")}
                </button>
              )}
              {office && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("move");
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-100"
                >
                  📂 {t("documents.folders.move")}
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("delete");
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-bold text-red-700 hover:bg-red-50"
                >
                  🗑️ {t("documents.folders.delete")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode("closed")}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100"
              >
                {t("documents.folders.cancel")}
              </button>
            </div>
          )}

          {mode === "rename" && (
            <form onSubmit={handleRename} className="space-y-2">
              <label className="block text-xs font-bold text-gray-700">
                {t("documents.folders.renameTitle")}
                <input
                  type="text"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={folder.name}
                  autoFocus
                  className="mt-1 w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 bg-white"
                />
              </label>
              <MenuButtons
                busy={busy}
                onCancel={() => setMode("menu")}
                saveLabel={t("documents.folders.save")}
                cancelLabel={t("documents.folders.cancel")}
              />
            </form>
          )}

          {mode === "move" && (
            <form onSubmit={handleMove} className="space-y-2">
              <label className="block text-xs font-bold text-gray-700">
                {t("documents.folders.moveTitle")}
                <select
                  name="parentId"
                  defaultValue={folder.parentId ?? ""}
                  className="mt-1 w-full border border-gray-300 p-2 rounded-lg text-sm text-gray-900 bg-white"
                >
                  <option value="">{t("documents.folders.root")}</option>
                  {allFolders
                    .filter((option) => !blockedIds.has(option.id))
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                </select>
              </label>
              <MenuButtons
                busy={busy}
                onCancel={() => setMode("menu")}
                saveLabel={t("documents.folders.save")}
                cancelLabel={t("documents.folders.cancel")}
              />
            </form>
          )}

          {mode === "delete" && (
            <p className="text-xs text-gray-600">
              {t("documents.folders.deleteHint")}
            </p>
          )}

          {error && mode !== "delete" && (
            <p className="mt-2 text-xs text-red-700">{error}</p>
          )}
        </div>
      )}

      {mode === "delete" && (
        <ConfirmDialog
          open
          title={t("documents.folders.deleteTitle", { name: folder.name })}
          description={t("documents.folders.deleteHint")}
          confirmLabel={t("documents.folders.delete")}
          cancelLabel={t("documents.folders.cancel")}
          danger
          busy={busy}
          onCancel={() => setMode("menu")}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function MenuButtons({
  busy,
  onCancel,
  saveLabel,
  cancelLabel,
}: {
  busy: boolean;
  onCancel: () => void;
  saveLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={busy}
        className="flex-1 px-3 py-2 rounded-lg text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50"
      >
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
      >
        {cancelLabel}
      </button>
    </div>
  );
}

export default function DocumentBrowser({
  data,
  folderId,
  searchQuery,
  tagFilter,
  onlyFolder,
  page,
  office,
  isAdmin,
  showDeleted,
  createFolderAction,
  renameFolderAction,
  moveFolderAction,
  deleteFolderAction,
  restoreVersionAction,
  deleteDocumentAction,
  restoreDocumentAction,
  updateDocumentAction,
  createDocumentAction,
  bulkCreateDocumentsAction,
  bulkMoveDocumentsAction,
  bulkDeleteDocumentsAction,
  bulkTagDocumentsAction,
  discardUploadsAction,
  reindexDocumentsAction,
}: DocumentBrowserProps) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const {
    currentFolder,
    breadcrumb,
    subFolders,
    documents,
    totalDocuments,
    totalPages,
    detailDocument,
    folderOptions,
    allTags,
  } = data;

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [panel, setPanel] = useState<null | "folder" | "upload" | "bulk">(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<
    DocumentBulkMutationResult | { error: string } | null
  >(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const formContext: DocumentFormContext = {
    folderId,
    searchQuery,
    tagFilter,
    page,
    onlyFolder,
  };

  const filtering = Boolean(searchQuery || tagFilter);
  const globalSearch = filtering && !onlyFolder;
  const currentPage = clampPage(page, totalPages);
  const canSelect = !showDeleted && (office || isAdmin);
  const allVisibleSelected =
    documents.length > 0 &&
    documents.every((document) => selected.has(document.id));

  function contextParams() {
    const params = new URLSearchParams();
    if (folderId) params.set("folder", folderId);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    if (onlyFolder) params.set("scope", "folder");
    return params;
  }

  const folderLink = (fid: string | null) => {
    const params = new URLSearchParams();
    if (fid) params.set("folder", fid);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    if (onlyFolder) params.set("scope", "folder");
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  const resetLink = () => resetHref(folderId, onlyFolder);

  const toggleTagLink = (tagName: string) =>
    toggleTagHref(tagName, {
      folderId,
      searchQuery,
      tagFilter,
      onlyFolder,
    });

  const pageLink = (nextPage: number) => {
    const params = contextParams();
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  const docLink = (id: string) => {
    const params = contextParams();
    if (page > 1) params.set("page", String(page));
    params.set("doc", id);
    return `/dokumenter?${params.toString()}`;
  };

  const deletedLink = () => {
    const params = contextParams();
    if (page > 1) params.set("page", String(page));
    if (!showDeleted) params.set("slettet", "1");
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  function toggleSelected(id: string) {
    setBulkResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setBulkResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const document of documents) next.delete(document.id);
      } else {
        for (const document of documents) next.add(document.id);
      }
      return next;
    });
  }

  async function handleCreateFolder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPanelError(null);
    const formData = new FormData(e.currentTarget);
    formData.set("parentId", folderId ?? "");
    const result = await createFolderAction(formData);
    if (!result.ok) {
      setPanelError(t(errorKey(result.reason)));
      return;
    }
    setPanel(null);
    router.refresh();
  }

  function handleBulkResponse(
    result: DocumentBulkMutationActionResult,
    clearSelection = true,
  ) {
    if (!result.ok) {
      setBulkResult({ error: t(errorKey(result.reason)) });
      return;
    }
    setBulkResult(result);
    const failedIds = result.results
      .filter((item) => item.status === "failed")
      .map((item) => item.id);
    if (clearSelection && failedIds.length === 0) {
      setSelected(new Set());
    } else if (failedIds.length > 0) {
      setSelected(new Set(failedIds));
    }
    router.refresh();
  }

  async function submitBulkMove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBulkBusy(true);
    const formData = new FormData(e.currentTarget);
    for (const id of selected) formData.append("ids", id);
    try {
      const result = await bulkMoveDocumentsAction(formData);
      handleBulkResponse(result);
    } catch {
      setBulkResult({ error: t("documents.errors.generic") });
    } finally {
      setBulkBusy(false);
    }
  }

  async function submitBulkTag(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBulkBusy(true);
    const formData = new FormData(e.currentTarget);
    for (const id of selected) formData.append("ids", id);
    try {
      const result = await bulkTagDocumentsAction(formData);
      handleBulkResponse(result);
    } catch {
      setBulkResult({ error: t("documents.errors.generic") });
    } finally {
      setBulkBusy(false);
    }
  }

  async function submitBulkDelete() {
    setBulkBusy(true);
    setConfirmBulkDelete(false);
    const formData = new FormData();
    for (const id of selected) formData.append("ids", id);
    try {
      const result = await bulkDeleteDocumentsAction(formData);
      handleBulkResponse(result);
    } catch {
      setBulkResult({ error: t("documents.errors.generic") });
    } finally {
      setBulkBusy(false);
    }
  }

  function openPanel(next: "folder" | "upload" | "bulk") {
    setPanel(panel === next ? null : next);
    setPanelError(null);
    setNewMenuOpen(false);
  }

  return (
    <>
      {showDeleted && (
        <div className="bg-amber-50 border-2 border-amber-200 text-amber-900 p-4 rounded-2xl text-sm font-bold">
          {t("documents.browser.deletedTitle")}
        </div>
      )}

      {/* SØK + TAG-FILTER */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
        <form method="GET" action="/dokumenter" className="flex flex-wrap gap-2">
          {folderId && <input type="hidden" name="folder" value={folderId} />}
          {tagFilter && <input type="hidden" name="tag" value={tagFilter} />}
          <input
            type="search"
            name="q"
            defaultValue={searchQuery}
            aria-label={t("documents.browser.searchPlaceholder")}
            placeholder={t("documents.browser.searchPlaceholder")}
            className="flex-1 min-w-[14rem] border-2 border-gray-200 p-2.5 rounded-xl text-sm font-medium text-gray-900 bg-gray-50 focus:border-blue-700"
          />
          <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition">
            {t("documents.browser.search")}
          </button>
          {(searchQuery || tagFilter) && (
            <Link
              href={resetLink()}
              className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
            >
              {t("documents.browser.reset")}
            </Link>
          )}
          <label className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-gray-200 bg-gray-50 text-xs font-bold text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              name="scope"
              value="folder"
              defaultChecked={onlyFolder}
              className="h-4 w-4"
            />
            {t("documents.browser.onlyFolder")}
          </label>
        </form>

        {globalSearch && (
          <p className="bg-blue-50 border-2 border-blue-200 text-blue-900 px-4 py-2.5 rounded-xl text-xs font-bold">
            🔎 {t("documents.browser.globalSearchNotice")}
          </p>
        )}
        {filtering && onlyFolder && (
          <p className="bg-blue-50 border-2 border-blue-200 text-blue-900 px-4 py-2.5 rounded-xl text-xs font-bold">
            🔎 {t("documents.browser.folderScopeNotice")}
          </p>
        )}

        {/* Tag-filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider self-center">{t("documents.browser.tagFilter")}</span>
            {allTags.map((tag) => (
              <Link
                key={tag.id}
                href={toggleTagLink(tag.name)}
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

      {/* STICKY VERKTØYLINJE – alltid over dokumentlisten */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 md:-mx-8 border-y border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur sm:px-6 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {office && !showDeleted && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setNewMenuOpen((open) => !open)}
                aria-expanded={newMenuOpen}
                className="bg-[var(--primary-color)] text-white px-4 py-2.5 rounded-xl text-sm font-black hover:opacity-90 transition shadow-sm"
              >
                ＋ {t("documents.toolbar.new")}
              </button>
              {newMenuOpen && (
                <div className="absolute left-0 z-40 mt-1 w-64 rounded-xl border-2 border-gray-200 bg-white p-2 shadow-xl">
                  <ToolbarMenuButton onClick={() => openPanel("upload")}>
                    ⬆️ {t("documents.toolbar.upload")}
                  </ToolbarMenuButton>
                  <ToolbarMenuButton onClick={() => openPanel("folder")}>
                    📁 {t("documents.toolbar.newFolder")}
                  </ToolbarMenuButton>
                  <ToolbarMenuButton onClick={() => openPanel("bulk")}>
                    📥 {t("documents.toolbar.import")}
                  </ToolbarMenuButton>
                </div>
              )}
            </div>
          )}

          {currentFolder && (office || isAdmin) && (
            <div className="flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-3 py-1.5">
              <span className="text-xs font-bold text-gray-600 truncate max-w-[12rem]">
                📁 {currentFolder.name}
              </span>
              <FolderMenu
                folder={currentFolder}
                allFolders={folderOptions}
                office={office}
                isAdmin={isAdmin}
                renameFolderAction={renameFolderAction}
                moveFolderAction={moveFolderAction}
                deleteFolderAction={deleteFolderAction}
                onDeleted={() =>
                  router.push(folderLink(currentFolder.parentId))
                }
              />
            </div>
          )}

          {isAdmin && (
            <Link
              href={deletedLink()}
              className="ml-auto text-xs font-bold text-gray-700 bg-white border-2 border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-100 transition"
            >
              {showDeleted
                ? t("documents.browser.showActive")
                : t("documents.browser.showDeleted")}
            </Link>
          )}
        </div>

        {panel && (
          <div className="mt-3 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-black text-gray-900">
                {panel === "folder"
                  ? t("documents.toolbar.newFolder")
                  : panel === "upload"
                    ? t("documents.toolbar.upload")
                    : t("documents.toolbar.import")}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setPanel(null);
                  setPanelError(null);
                }}
                className="text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl"
              >
                ✕ {t("documents.browser.close")}
              </button>
            </div>

            {panel === "folder" && (
              <form onSubmit={handleCreateFolder} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  name="name"
                  required
                  maxLength={200}
                  aria-label={t("documents.folders.namePlaceholder")}
                  placeholder={t("documents.browser.folderNamePlaceholder")}
                  className="flex-1 min-w-[12rem] border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 font-medium focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="bg-[var(--primary-color)] text-white px-5 py-2.5 rounded-xl font-bold hover:opacity-90 transition shadow-sm"
                >
                  + {t("documents.browser.createFolder")}
                </button>
              </form>
            )}

            {panel === "upload" && (
              <UploadDocumentForm
                folderId={folderId}
                allTags={allTags}
                createDocument={createDocumentAction}
                context={formContext}
              />
            )}

            {panel === "bulk" && (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  {t("documents.browser.uploadStructureHint")}
                </p>
                <BulkUploadForm
                  context={formContext}
                  bulkCreateDocuments={bulkCreateDocumentsAction}
                  discardUploads={discardUploadsAction}
                />
                <div className="border-t-2 border-gray-200 pt-3 mt-4">
                  <form action={reindexDocumentsAction}>
                    <DocumentContextFields context={formContext} />
                    <button
                      type="submit"
                      className="w-full bg-gray-200 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-300 transition shadow-sm"
                    >
                      {t("documents.browser.reindex")}
                    </button>
                    <p className="text-xs text-gray-500 mt-2">
                      {t("documents.browser.reindexHint")}
                    </p>
                  </form>
                </div>
              </>
            )}

            {panelError && (
              <p role="alert" className="mt-2 text-xs font-bold text-red-700">
                {panelError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* BREADCRUMB */}
      <div className="flex items-center gap-2 text-sm font-bold text-gray-600 flex-wrap">
        <Link href={folderLink(null)} className="hover:text-blue-700 transition">📁 {t("documents.browser.root")}</Link>
        {breadcrumb.map((folder, index) => (
          <span key={folder.id} className="flex items-center gap-2">
            <span className="text-gray-400">/</span>
            {index === breadcrumb.length - 1 ? (
              <span className="text-gray-900">{folder.name}</span>
            ) : (
              <Link href={folderLink(folder.id)} className="hover:text-blue-700 transition">{folder.name}</Link>
            )}
          </span>
        ))}
      </div>

      {/* DOKUMENTDETALJ – versjoner og filbytte */}
      {detailDocument && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200 space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
            <div className="min-w-0">
              <h2 className="font-black text-gray-900 truncate">🗂️ {detailDocument.title}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {detailDocument.fileName} • {(detailDocument.fileSize / 1024).toFixed(0)} KB
                {detailDocument.versions.length > 0
                  ? ` • ${t("documents.browser.versionsCount", {
                      count: detailDocument.versions.length,
                    })}`
                  : ` • ${t("documents.browser.noPreviousVersions")}`}
              </p>
            </div>
            <Link
              href={pageLink(page)}
              className="bg-gray-100 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 transition whitespace-nowrap"
            >
              ✕ {t("documents.browser.close")}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={detailDocument.filePath}
              target="_blank"
              rel="noreferrer"
              className="bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
            >
              📖 {t("documents.browser.openPdf")}
            </a>
            {office && !showDeleted && (
              <EditDocumentForm
                doc={detailDocument}
                allFolders={folderOptions}
                allTags={allTags}
                updateDocument={updateDocumentAction}
                restoreVersion={restoreVersionAction}
                context={formContext}
              />
            )}
          </div>

          {detailDocument.versions.length > 0 && (
            <details className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-xs font-black text-gray-700">
                🗂️{" "}
                {t("documents.versions.drawer", {
                  count: detailDocument.versions.length,
                })}
              </summary>
              <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
                {detailDocument.versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-bold text-gray-800">
                        {version.fileName}
                      </p>
                      <p className="text-gray-500">
                        {new Date(version.createdAt).toLocaleString(locale)} •{" "}
                        {(version.fileSize / 1024).toFixed(0)} KB
                        {version.createdBy ? ` • ${version.createdBy}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={version.filePath}
                        download={version.fileName}
                        className="font-bold text-blue-700 hover:underline whitespace-nowrap"
                      >
                        ⬇️ {t("documents.versions.download")}
                      </a>
                      {office && !showDeleted && (
                        <form action={restoreVersionAction}>
                          <DocumentContextFields context={formContext} />
                          <input
                            type="hidden"
                            name="versionId"
                            value={version.id}
                          />
                          <button
                            type="submit"
                            className="font-bold text-amber-700 hover:underline whitespace-nowrap"
                          >
                            {t("documents.versions.restore")}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* UNDERMAPPER */}
      {subFolders.length > 0 && (
        <div>
          <h2 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-3">{t("documents.browser.subfolders")}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {subFolders.map((folder) => (
              <div
                key={folder.id}
                className="relative rounded-2xl border-2 border-gray-200 bg-white shadow-sm transition hover:border-blue-400 hover:shadow-md"
              >
                <Link
                  href={folderLink(folder.id)}
                  className="block p-4 text-center"
                >
                  <div className="text-3xl mb-1">📁</div>
                  <p className="font-bold text-gray-900 text-sm truncate">{folder.name}</p>
                </Link>
                <div className="absolute right-1.5 top-1.5">
                  <FolderMenu
                    folder={folder}
                    allFolders={folderOptions}
                    office={office}
                    isAdmin={isAdmin}
                    renameFolderAction={renameFolderAction}
                    moveFolderAction={moveFolderAction}
                    deleteFolderAction={deleteFolderAction}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DOKUMENTER */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-gray-500 uppercase tracking-wider">
            {t("documents.browser.documents", { count: totalDocuments })}
          </h2>
          {canSelect && documents.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-600">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAll}
                disabled={bulkBusy}
                className="h-4 w-4"
              />
              {t("documents.bulkActions.selectAll")}
            </label>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">{t("documents.browser.empty")}</p>
            <p className="text-xs text-gray-500 mt-1">
              {searchQuery || tagFilter
                ? t("documents.browser.emptyFiltered")
                : t("documents.browser.emptyUpload")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`bg-white p-3 sm:p-4 rounded-2xl border-2 transition space-y-3 ${
                  selected.has(doc.id)
                    ? "border-blue-500 shadow-md"
                    : "border-gray-200 hover:border-blue-400 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {canSelect && (
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelected(doc.id)}
                        disabled={bulkBusy}
                        aria-label={t("documents.bulkActions.selectDocument", {
                          title: doc.title,
                        })}
                        className="mt-1 h-4 w-4 flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl">📄</span>
                        <p className="font-black text-gray-900 truncate">{doc.title}</p>
                      </div>
                      {doc.description && (
                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">{doc.description}</p>
                      )}
                      {globalSearch && (
                        <p className="mt-1 text-xs font-bold text-blue-700">
                          📁 {doc.folderPath ?? t("documents.browser.root")}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {doc.fileName} • {(doc.fileSize / 1024).toFixed(0)} KB
                        {doc.uploadedBy
                          ? ` • ${t("documents.browser.uploadedBy", { name: doc.uploadedBy })}`
                          : ""}
                      </p>
                      {doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {doc.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="px-2 py-0.5 rounded-full text-xs font-bold shadow-sm"
                              suppressHydrationWarning
                              style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
                            >
                              🏷️ {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {showDeleted ? (
                      <form action={restoreDocumentAction}>
                        <DocumentContextFields context={formContext} />
                        <input type="hidden" name="id" value={doc.id} />
                        <button
                          type="submit"
                          className="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-xl border border-emerald-200 transition whitespace-nowrap"
                        >
                          ♻️ {t("documents.browser.restore")}
                        </button>
                      </form>
                    ) : (
                      <>
                        <a
                          href={doc.filePath}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
                        >
                          📖 {t("documents.browser.openPdf")}
                        </a>
                        {office && (
                          <Link
                            href={docLink(doc.id)}
                            className="bg-gray-100 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 transition whitespace-nowrap"
                          >
                            🗂️ {t("documents.browser.versions")}
                          </Link>
                        )}
                        {office && (
                          <EditDocumentForm
                            doc={doc}
                            allFolders={folderOptions}
                            allTags={allTags}
                            updateDocument={updateDocumentAction}
                            restoreVersion={restoreVersionAction}
                            context={formContext}
                          />
                        )}
                        {isAdmin && (
                          <ConfirmSubmitForm
                            action={deleteDocumentAction}
                            confirmMessage={t("documents.browser.deleteConfirm", {
                              title: doc.title,
                            })}
                            confirmLabel={t("delete")}
                            danger
                          >
                            <DocumentContextFields context={formContext} />
                            <input type="hidden" name="id" value={doc.id} />
                            <button
                              type="submit"
                              className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-xl border border-red-200 transition whitespace-nowrap"
                            >
                              🗑️ {t("documents.browser.delete")}
                            </button>
                          </ConfirmSubmitForm>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          hrefFor={pageLink}
          labels={paginationLabels(t)}
          summary={`${t("documents.browser.pageOf", {
            page: currentPage,
            totalPages,
          })} • ${t("documents.browser.documentCount", {
            count: totalDocuments,
          })}`}
          className="mt-3"
        />
      </div>

      {/* STICKY HANDLINGSSTOLPE FOR MERKEDE DOKUMENTER */}
      {(selected.size > 0 || bulkResult) && (
        <div className="sticky bottom-0 z-30 -mx-4 border-t-2 border-blue-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black text-gray-900">
                {t("documents.bulkActions.selected", { count: selected.size })}
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl"
              >
                {t("documents.bulkActions.clear")}
              </button>

              {office && (
                <form onSubmit={submitBulkMove} className="flex items-center gap-1">
                  <select
                    name="folderId"
                    defaultValue=""
                    aria-label={t("documents.bulkActions.moveTo")}
                    className="border border-gray-300 p-2 rounded-xl text-xs text-gray-900 bg-white"
                  >
                    <option value="">{t("documents.folders.root")}</option>
                    {folderOptions.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={bulkBusy}
                    className="text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-xl disabled:opacity-50"
                  >
                    {t("documents.bulkActions.move")}
                  </button>
                </form>
              )}

              {office && allTags.length > 0 && (
                <form onSubmit={submitBulkTag} className="flex items-center gap-1">
                  <select
                    name="tags"
                    defaultValue=""
                    required
                    aria-label={t("documents.bulkActions.tagPlaceholder")}
                    className="border border-gray-300 p-2 rounded-xl text-xs text-gray-900 bg-white"
                  >
                    <option value="" disabled>
                      {t("documents.bulkActions.tagPlaceholder")}
                    </option>
                    {allTags.map((tag) => (
                      <option key={tag.id} value={tag.name}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={bulkBusy}
                    className="text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 px-3 py-2 rounded-xl disabled:opacity-50"
                  >
                    {t("documents.bulkActions.addTag")}
                  </button>
                </form>
              )}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={bulkBusy}
                  className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-3 py-2 rounded-xl disabled:opacity-50"
                >
                  {t("documents.bulkActions.delete")}
                </button>
              )}

              {bulkBusy && (
                <span className="text-xs font-bold text-blue-700">
                  {t("documents.bulkActions.busy")}
                </span>
              )}
            </div>
          )}

          {bulkResult && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {"error" in bulkResult ? (
                    <p role="alert" className="font-bold text-red-700">
                      {bulkResult.error}
                    </p>
                  ) : (
                    <>
                      <p className="font-bold text-gray-800">
                        {t("documents.bulkActions.result", {
                          succeeded: bulkResult.succeeded,
                          failed: bulkResult.failed,
                        })}
                      </p>
                      {bulkResult.results.length > 0 && (
                        <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                          {bulkResult.results.map((item) => (
                            <li
                              key={item.id}
                              className={
                                item.status === "failed"
                                  ? "text-red-700"
                                  : "text-emerald-800"
                              }
                            >
                              {item.status === "failed" ? "⛔" : "✅"}{" "}
                              {item.title || item.id}:{" "}
                              {item.status === "failed"
                                ? t(errorKey(item.reason ?? "error"))
                                : t("documents.bulkActions.itemOk")}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setBulkResult(null)}
                  className="text-xs font-bold text-gray-500 hover:text-gray-800"
                >
                  {t("documents.bulkActions.dismiss")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          open
          title={t("documents.bulkActions.delete")}
          description={t("documents.bulkActions.deleteConfirm", {
            count: selected.size,
          })}
          confirmLabel={t("delete")}
          cancelLabel={t("documents.folders.cancel")}
          danger
          busy={bulkBusy}
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={submitBulkDelete}
        />
      )}
    </>
  );
}

function ToolbarMenuButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-gray-700 hover:bg-gray-100"
    >
      {children}
    </button>
  );
}
