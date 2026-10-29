"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  /** Intern retursti fra søket, f.eks. /sok?q=pumpe. */
  returnTo: string | null;
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
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "rename") renameInputRef.current?.focus();
  }, [mode]);

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
                  ref={renameInputRef}
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
  returnTo,
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
    libraryTotal,
    rootDocumentCount,
    folderDocumentCounts,
  } = data;

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [panel, setPanel] = useState<null | "folder" | "upload" | "bulk">(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scope, setScope] = useState<"folder" | "library">(
    onlyFolder ? "folder" : "library",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState("");
  const [confirmBulkMove, setConfirmBulkMove] = useState(false);
  const [undoMove, setUndoMove] = useState<{
    groups: Array<{ folderId: string | null; ids: string[] }>;
    destination: string;
  } | null>(null);
  const [bulkResult, setBulkResult] = useState<
    DocumentBulkMutationResult | { error: string } | null
  >(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const formContext: DocumentFormContext = {
    folderId,
    searchQuery,
    tagFilter,
    page,
    onlyFolder,
  };

  const filtering = Boolean(searchQuery || tagFilter);
  const globalSearch = filtering && !onlyFolder;
  const libraryScope = Boolean(folderId) && !onlyFolder;
  const showFolderPath = !onlyFolder;
  const activeFilterCount =
    (searchQuery ? 1 : 0) + (tagFilter ? 1 : 0);
  const emptyTitle =
    searchQuery || tagFilter
      ? t("documents.browser.empty")
      : folderId
        ? t("documents.browser.empty")
        : onlyFolder
          ? t("documents.browser.emptyRootFiles")
          : t("documents.browser.emptyLibrary");
  const emptyHint =
    searchQuery || tagFilter
      ? t("documents.browser.emptyFiltered")
      : !folderId && onlyFolder
        ? t("documents.browser.emptyRootFilesHint")
        : t("documents.browser.emptyUpload");
  const currentPage = clampPage(page, totalPages);
  const canSelect = !showDeleted && (office || isAdmin);
  const allVisibleSelected =
    documents.length > 0 &&
    documents.every((document) => selected.has(document.id));

  function addScope(params: URLSearchParams) {
    if (libraryScope) params.set("scope", "library");
    else if (onlyFolder) params.set("scope", "folder");
  }

  function contextParams() {
    const params = new URLSearchParams();
    if (folderId) params.set("folder", folderId);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    addScope(params);
    return params;
  }

  const folderLink = (fid: string | null) => {
    const params = new URLSearchParams();
    if (fid) params.set("folder", fid);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    addScope(params);
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  const resetLink = () => resetHref(folderId, onlyFolder, libraryScope);

  const toggleTagLink = (tagName: string) =>
    toggleTagHref(tagName, {
      folderId,
      searchQuery,
      tagFilter,
      onlyFolder,
      libraryScope,
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
    if (returnTo) params.set("returnTo", returnTo);
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

  // Når et søketreff åpner detaljvisningen, skal dokumentet være synlig med
  // én gang – ikke ligge under filterpanelet og mappekortene.
  useEffect(() => {
    if (!detailDocument) return;
    const frame = window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailDocument]);

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
    clearUndo = true,
  ) {
    if (!result.ok) {
      setBulkResult({ error: t(errorKey(result.reason)) });
      return;
    }
    if (clearUndo) setUndoMove(null);
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

  const moveDestinationLabel =
    bulkMoveTarget === "__root__"
      ? t("documents.folders.root")
      : folderOptions.find((folder) => folder.id === bulkMoveTarget)?.name ??
        "";

  async function submitBulkMove() {
    if (!bulkMoveTarget) return;
    setBulkBusy(true);
    setConfirmBulkMove(false);
    setUndoMove(null);

    const previousFolders = new Map<string, string | null>();
    for (const document of documents) {
      if (selected.has(document.id)) {
        previousFolders.set(document.id, document.folderId);
      }
    }

    const formData = new FormData();
    formData.set("folderId", bulkMoveTarget === "__root__" ? "" : bulkMoveTarget);
    for (const id of selected) formData.append("ids", id);

    try {
      const result = await bulkMoveDocumentsAction(formData);
      if (result.ok) {
        // Bare dokumentene som faktisk ble flyttet kan angres. Grupper på
        // opprinnelig mappe, slik at hver mappe flyttes tilbake i ett kall.
        const movedIds = result.results
          .filter((item) => item.status === "ok")
          .map((item) => item.id);
        const groups = new Map<
          string,
          { folderId: string | null; ids: string[] }
        >();
        for (const id of movedIds) {
          const folder = previousFolders.get(id) ?? null;
          const key = folder ?? "__root__";
          const group = groups.get(key) ?? { folderId: folder, ids: [] };
          group.ids.push(id);
          groups.set(key, group);
        }
        if (groups.size > 0) {
          setUndoMove({
            groups: [...groups.values()],
            destination: moveDestinationLabel,
          });
        }
        setBulkMoveTarget("");
      }
      handleBulkResponse(result, true, false);
    } catch {
      setBulkResult({ error: t("documents.errors.generic") });
    } finally {
      setBulkBusy(false);
    }
  }

  async function undoLastMove() {
    if (!undoMove) return;
    setBulkBusy(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const group of undoMove.groups) {
        const formData = new FormData();
        formData.set("folderId", group.folderId ?? "");
        for (const id of group.ids) formData.append("ids", id);
        const result = await bulkMoveDocumentsAction(formData);
        if (result.ok) {
          succeeded += result.succeeded;
          failed += result.failed;
        } else {
          failed += group.ids.length;
        }
      }
      setUndoMove(null);
      if (failed > 0) {
        setBulkResult({ error: t("documents.bulkActions.undoFailed") });
      } else {
        setBulkResult({ succeeded, failed: 0, results: [] });
        setSelected(new Set());
      }
      router.refresh();
    } catch {
      setBulkResult({ error: t("documents.bulkActions.undoFailed") });
    } finally {
      setBulkBusy(false);
    }
  }

  async function submitBulkTag(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBulkBusy(true);
    setUndoMove(null);
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
    setUndoMove(null);
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

      {/* SØK + TAG-FILTER – alltid synlig på desktop, sammenklappet på mobil */}
      <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="document-search-panel"
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-bold text-gray-800 transition hover:bg-gray-100 lg:hidden"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden>⚙️</span>
            <span className="truncate">
              {activeFilterCount > 0
                ? t("documents.browser.filterToggleActive", {
                    count: activeFilterCount,
                  })
                : t("documents.browser.filterToggle")}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-xs text-gray-400">
            {filtersOpen ? "▲" : "▼"}
          </span>
        </button>

        <div
          id="document-search-panel"
          className={`${filtersOpen ? "mt-3 block" : "mt-3 hidden lg:block"} space-y-3`}
        >
          <form
            ref={searchFormRef}
            method="GET"
            action="/dokumenter"
            className="space-y-3"
          >
            {folderId && <input type="hidden" name="folder" value={folderId} />}
            {tagFilter && <input type="hidden" name="tag" value={tagFilter} />}
            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                name="q"
                defaultValue={searchQuery}
                aria-label={t("documents.browser.searchPlaceholder")}
                placeholder={t("documents.browser.searchPlaceholder")}
                className="min-w-0 flex-1 basis-56 rounded-xl border-2 border-gray-200 bg-gray-50 p-2.5 text-sm font-medium text-gray-900 focus:border-blue-700"
              />
              <button
                type="submit"
                className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-gray-800"
              >
                {t("documents.browser.search")}
              </button>
              {(searchQuery || tagFilter) && (
                <Link
                  href={resetLink()}
                  className="rounded-xl bg-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-300"
                >
                  {t("documents.browser.reset")}
                </Link>
              )}
            </div>

            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">
                {t("documents.browser.scopeLabel")}
              </legend>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                {t("documents.browser.scopeLabel")}
              </span>
              <div className="inline-flex rounded-xl border-2 border-gray-200 bg-gray-50 p-0.5">
                <label
                  className={`cursor-pointer rounded-[10px] px-3 py-1.5 text-xs font-bold transition ${
                    scope === "folder"
                      ? "bg-blue-700 text-white shadow-sm"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    value="folder"
                    checked={scope === "folder"}
                    onChange={() => {
                      setScope("folder");
                      searchFormRef.current?.requestSubmit();
                    }}
                    className="sr-only"
                  />
                  {t("documents.browser.scopeFolder")}
                </label>
                <label
                  className={`cursor-pointer rounded-[10px] px-3 py-1.5 text-xs font-bold transition ${
                    scope === "library"
                      ? "bg-blue-700 text-white shadow-sm"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    value="library"
                    checked={scope === "library"}
                    onChange={() => {
                      setScope("library");
                      searchFormRef.current?.requestSubmit();
                    }}
                    className="sr-only"
                  />
                  {t("documents.browser.scopeLibrary")}
                </label>
              </div>
            </fieldset>
          </form>

          {globalSearch && (
            <p className="rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-900">
              🔎 {t("documents.browser.globalSearchNotice")}
            </p>
          )}
          {filtering && onlyFolder && (
            <p className="rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-900">
              🔎 {t("documents.browser.folderScopeNotice")}
            </p>
          )}

          {/* Tag-filter chips */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
              <span className="self-center text-xs font-bold uppercase tracking-wider text-gray-500">
                {t("documents.browser.tagFilter")}
              </span>
              {allTags.map((tag) => (
                <Link
                  key={tag.id}
                  href={toggleTagLink(tag.name)}
                  className={`rounded-full border-2 px-3 py-1 text-xs font-bold transition ${
                    tagFilter === tag.name
                      ? "border-transparent text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                  style={
                    tagFilter === tag.name
                      ? { backgroundColor: tag.color }
                      : {}
                  }
                >
                  🏷️ {tag.name}
                </Link>
              ))}
            </div>
          )}
        </div>
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
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-600">
        <Link href={folderLink(null)} className="transition hover:text-blue-700">
          📚 {t("documents.browser.allDocuments")}
        </Link>
        {breadcrumb.map((folder, index) => (
          <span key={folder.id} className="flex items-center gap-2">
            <span className="text-gray-400">/</span>
            {index === breadcrumb.length - 1 ? (
              <span className="text-gray-900">{folder.name}</span>
            ) : (
              <Link href={folderLink(folder.id)} className="transition hover:text-blue-700">
                {folder.name}
              </Link>
            )}
          </span>
        ))}
      </div>

      {!folderId && (
        <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-base font-black text-gray-900">
              📚 {t("documents.browser.allDocuments")}
            </h2>
            <p className="text-sm font-bold text-gray-700">
              {t("documents.browser.allDocumentsCount", {
                count: libraryTotal,
              })}
            </p>
          </div>
          <p className="mt-1 text-xs font-bold text-blue-800">
            {t("documents.browser.rootFilesCount", {
              count: rootDocumentCount,
            })}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            {t("documents.browser.libraryHint")}
          </p>
        </div>
      )}

      {/* DOKUMENTDETALJ – versjoner og filbytte */}
      {detailDocument && (
        <div
          ref={detailRef}
          className="scroll-mt-24 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200 space-y-4"
        >
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
              <p className="mt-1 text-xs font-bold text-blue-700">
                {t("documents.browser.folderPath", {
                  path:
                    detailDocument.folderPath ??
                    t("documents.browser.root"),
                })}
              </p>
            </div>
            <Link
              href={returnTo ?? pageLink(page)}
              className="bg-gray-100 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 transition whitespace-nowrap"
            >
              {returnTo
                ? returnTo.startsWith("/sok")
                  ? t("documents.browser.backToSearch")
                  : t("documents.browser.backToContext")
                : `✕ ${t("documents.browser.close")}`}
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

      <div className="flex flex-col gap-6">
        {/* UNDERMAPPER */}
        {subFolders.length > 0 && !libraryScope && (
          <div className={folderId ? undefined : "order-2 lg:order-1"}>
            <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-gray-500">
              {folderId
                ? t("documents.browser.subfolders")
                : t("documents.browser.rootFolders")}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {subFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="relative rounded-2xl border-2 border-gray-200 bg-white shadow-sm transition hover:border-blue-400 hover:shadow-md"
                >
                  <Link
                    href={folderLink(folder.id)}
                    prefetch={false}
                    className="block p-4 text-center"
                  >
                    <div className="mb-1 text-3xl">📁</div>
                    <p className="truncate text-sm font-bold text-gray-900">{folder.name}</p>
                    <p
                      className="mt-0.5 text-xs font-semibold text-gray-500"
                      title={t("documents.browser.folderCountHint")}
                    >
                      {t("documents.browser.folderCount", {
                        count: folderDocumentCounts[folder.id] ?? 0,
                      })}
                    </p>
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
        <div className={folderId ? undefined : "order-1 lg:order-2"}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black uppercase tracking-wider text-gray-500">
              {(!folderId && !onlyFolder) || libraryScope
                ? t("documents.browser.allDocumentsHeading", {
                    count: totalDocuments,
                  })
                : !folderId && onlyFolder
                  ? t("documents.browser.rootFilesHeading", {
                      count: totalDocuments,
                    })
                  : t("documents.browser.documents", { count: totalDocuments })}
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
            <p className="text-gray-600 font-bold">{emptyTitle}</p>
            <p className="mt-1 text-xs text-gray-500">{emptyHint}</p>
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
                      {showFolderPath && (
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
                            prefetch={false}
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
                              className="text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-xl border border-red-200 transition whitespace-nowrap"
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
                onClick={() => {
                  setSelected(new Set());
                  setBulkMoveTarget("");
                }}
                className="text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl"
              >
                {t("documents.bulkActions.clear")}
              </button>

              {office && (
                <div className="flex items-center gap-1">
                  <select
                    value={bulkMoveTarget}
                    onChange={(event) => setBulkMoveTarget(event.target.value)}
                    aria-label={t("documents.bulkActions.moveTo")}
                    className="border border-gray-300 p-2 rounded-xl text-xs text-gray-900 bg-white"
                  >
                    <option value="" disabled>
                      {t("documents.bulkActions.moveDestination")}
                    </option>
                    <option value="__root__">
                      {t("documents.folders.root")}
                    </option>
                    {folderOptions.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkMove(true)}
                    disabled={bulkBusy || !bulkMoveTarget}
                    className="text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-xl disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("documents.bulkActions.move")}
                  </button>
                </div>
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
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {undoMove && !("error" in bulkResult) && (
                    <button
                      type="button"
                      onClick={undoLastMove}
                      disabled={bulkBusy}
                      title={t("documents.bulkActions.moveUndoTarget", {
                        destination: undoMove.destination,
                      })}
                      className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
                    >
                      ↩️ {t("documents.bulkActions.moveUndo")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setBulkResult(null);
                      setUndoMove(null);
                    }}
                    className="text-xs font-bold text-gray-500 hover:text-gray-800"
                  >
                    {t("documents.bulkActions.dismiss")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmBulkMove && (
        <ConfirmDialog
          open
          title={t("documents.bulkActions.moveConfirmTitle")}
          description={t("documents.bulkActions.moveConfirmDescription", {
            count: selected.size,
            folder: moveDestinationLabel,
          })}
          confirmLabel={t("documents.bulkActions.move")}
          cancelLabel={t("documents.folders.cancel")}
          busy={bulkBusy}
          onCancel={() => setConfirmBulkMove(false)}
          onConfirm={submitBulkMove}
        />
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
