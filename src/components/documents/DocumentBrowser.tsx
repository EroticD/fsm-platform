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
import Icon from "@/components/icons";
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

// Command Center-verdier. Fallbackene matcher office-card/signal-button/
// ink-button-tokenene, slik at biblioteket står riktig også før de er lastet.
const CARD = "office-card";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:cursor-not-allowed disabled:opacity-50";
const QUIET_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] disabled:cursor-not-allowed disabled:opacity-50";
const FIELD =
  "min-h-10 w-full rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]";
const EYEBROW =
  "text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const MUTED = "text-[var(--muted,#62685f)]";
const SELECTED_ROW =
  "bg-[#f8fce4] shadow-[inset_3px_0_0_var(--signal,#d8ff3e)]";

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
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-white text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
      >
        <Icon name="more" className="h-4 w-4" />
      </button>

      {mode !== "closed" && (
        <div className={`${CARD} absolute right-0 z-40 mt-1 w-72 p-2 shadow-xl`}>
          {mode === "menu" && (
            <div className="space-y-0.5">
              {office && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("rename");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                >
                  <Icon name="edit" className="h-4 w-4 shrink-0" />
                  {t("documents.folders.rename")}
                </button>
              )}
              {office && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("move");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                >
                  <Icon name="folder" className="h-4 w-4 shrink-0" />
                  {t("documents.folders.move")}
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("delete");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fbe9e7]"
                >
                  <Icon name="trash" className="h-4 w-4 shrink-0" />
                  {t("documents.folders.delete")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode("closed")}
                className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-[var(--muted,#62685f)] transition hover:bg-[var(--paper,#f2efe6)]"
              >
                {t("documents.folders.cancel")}
              </button>
            </div>
          )}

          {mode === "rename" && (
            <form onSubmit={handleRename} className="space-y-2 p-1">
              <label className="block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                {t("documents.folders.renameTitle")}
                <input
                  type="text"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={folder.name}
                  ref={renameInputRef}
                  className={`${FIELD} mt-1`}
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
            <form onSubmit={handleMove} className="space-y-2 p-1">
              <label className="block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                {t("documents.folders.moveTitle")}
                <select
                  name="parentId"
                  defaultValue={folder.parentId ?? ""}
                  className={`${FIELD} mt-1`}
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
            <p className={`px-1 py-2 text-xs ${MUTED}`}>
              {t("documents.folders.deleteHint")}
            </p>
          )}

          {error && mode !== "delete" && (
            <p className="px-1 pb-1 pt-2 text-xs font-bold text-[var(--risk-text,#b42318)]">
              {error}
            </p>
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
        className={`${INK_BUTTON} flex-1`}
      >
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className={`${QUIET_BUTTON} flex-1`}
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
        <div className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
          {t("documents.browser.deletedTitle")}
        </div>
      )}

      {/* SØK + TAG-FILTER – alltid synlig på desktop, sammenklappet på mobil */}
      <div className={`${CARD} p-3 sm:p-4`}>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="document-search-panel"
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-left text-sm font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] lg:hidden"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="filter" className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {activeFilterCount > 0
                ? t("documents.browser.filterToggleActive", {
                    count: activeFilterCount,
                  })
                : t("documents.browser.filterToggle")}
            </span>
          </span>
          <Icon
            name="chevronDown"
            className={`h-4 w-4 shrink-0 transition ${
              filtersOpen ? "rotate-180" : ""
            }`}
          />
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
                className={`${FIELD} min-w-0 flex-1 basis-56`}
              />
              <button
                type="submit"
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--ink,#101310)] px-4 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85"
              >
                {t("documents.browser.search")}
              </button>
              {(searchQuery || tagFilter) && (
                <Link href={resetLink()} className={INK_BUTTON}>
                  {t("documents.browser.reset")}
                </Link>
              )}
            </div>

            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">
                {t("documents.browser.scopeLabel")}
              </legend>
              <span className={EYEBROW}>
                {t("documents.browser.scopeLabel")}
              </span>
              <div className="inline-flex rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-0.5">
                <label
                  className={`cursor-pointer rounded-[6px] px-3 py-1.5 text-xs font-bold transition ${
                    scope === "folder"
                      ? "bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] shadow-sm"
                      : "text-[var(--ink,#101310)] hover:bg-white"
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
                  className={`cursor-pointer rounded-[6px] px-3 py-1.5 text-xs font-bold transition ${
                    scope === "library"
                      ? "bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] shadow-sm"
                      : "text-[var(--ink,#101310)] hover:bg-white"
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
            <p className="flex items-start gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]">
              <Icon name="search" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("documents.browser.globalSearchNotice")}
            </p>
          )}
          {filtering && onlyFolder && (
            <p className="flex items-start gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]">
              <Icon name="search" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("documents.browser.folderScopeNotice")}
            </p>
          )}

          {/* Tag-filter chips */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line,#dedcd1)] pt-3">
              <span className={`self-center ${EYEBROW}`}>
                {t("documents.browser.tagFilter")}
              </span>
              {allTags.map((tag) => {
                const active = tagFilter === tag.name;
                return (
                  <Link
                    key={tag.id}
                    href={toggleTagLink(tag.name)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition ${
                      active
                        ? "border-transparent"
                        : "border-[var(--line,#dedcd1)] bg-white text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]"
                    }`}
                    style={
                      active
                        ? {
                            backgroundColor: tag.color,
                            color: readableTextColor(tag.color),
                          }
                        : {}
                    }
                  >
                    <Icon name="flag" className="h-3 w-3 shrink-0" />
                    {tag.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* STICKY VERKTØYLINJE – alltid over dokumentlisten */}
      <div className="sticky top-0 z-30 -mx-4 border-y border-[var(--line,#dedcd1)] bg-[var(--canvas,#f4f5f2)]/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {office && !showDeleted && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setNewMenuOpen((open) => !open)}
                aria-expanded={newMenuOpen}
                className={`${SIGNAL_BUTTON} whitespace-nowrap`}
              >
                <Icon name="plus" className="h-4 w-4" />
                {t("documents.toolbar.new")}
              </button>
              {newMenuOpen && (
                <div className={`${CARD} absolute left-0 z-40 mt-1 w-64 p-2 shadow-xl`}>
                  <ToolbarMenuButton onClick={() => openPanel("upload")}>
                    <Icon name="file" className="h-4 w-4 shrink-0" />
                    {t("documents.toolbar.upload")}
                  </ToolbarMenuButton>
                  <ToolbarMenuButton onClick={() => openPanel("folder")}>
                    <Icon name="folder" className="h-4 w-4 shrink-0" />
                    {t("documents.toolbar.newFolder")}
                  </ToolbarMenuButton>
                  <ToolbarMenuButton onClick={() => openPanel("bulk")}>
                    <Icon name="clipboard" className="h-4 w-4 shrink-0" />
                    {t("documents.toolbar.import")}
                  </ToolbarMenuButton>
                </div>
              )}
            </div>
          )}

          {currentFolder && (office || isAdmin) && (
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1.5">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)]">
                <Icon name="folder" className="h-4 w-4 shrink-0" />
                <span className="max-w-[12rem] truncate">
                  {currentFolder.name}
                </span>
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
            <Link href={deletedLink()} className={`${INK_BUTTON} ml-auto`}>
              <Icon
                name={showDeleted ? "arrowRight" : "trash"}
                className={`h-3.5 w-3.5 shrink-0 ${
                  showDeleted ? "rotate-180" : ""
                }`}
              />
              {showDeleted
                ? t("documents.browser.showActive")
                : t("documents.browser.showDeleted")}
            </Link>
          )}
        </div>

        {panel && (
          <div className={`${CARD} mt-2 p-3 shadow-xl sm:p-4`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-extrabold text-[var(--ink,#101310)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
                />
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
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-[var(--muted,#62685f)] transition hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)]"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
                {t("documents.browser.close")}
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
                  className={`${FIELD} min-w-[12rem] flex-1`}
                />
                <button type="submit" className={INK_BUTTON}>
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  {t("documents.browser.createFolder")}
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
                <p className={`mb-3 text-sm ${MUTED}`}>
                  {t("documents.browser.uploadStructureHint")}
                </p>
                <BulkUploadForm
                  context={formContext}
                  bulkCreateDocuments={bulkCreateDocumentsAction}
                  discardUploads={discardUploadsAction}
                />
                <div className="mt-4 border-t border-[var(--line,#dedcd1)] pt-3">
                  <form action={reindexDocumentsAction}>
                    <DocumentContextFields context={formContext} />
                    <button type="submit" className={`${QUIET_BUTTON} w-full`}>
                      <Icon name="sync" className="h-3.5 w-3.5" />
                      {t("documents.browser.reindex")}
                    </button>
                    <p className={`mt-2 text-xs ${MUTED}`}>
                      {t("documents.browser.reindexHint")}
                    </p>
                  </form>
                </div>
              </>
            )}

            {panelError && (
              <p
                role="alert"
                className="mt-2 text-xs font-bold text-[var(--risk-text,#b42318)]"
              >
                {panelError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* BREADCRUMB */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
        <Link
          href={folderLink(null)}
          className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:text-[var(--muted,#62685f)]"
        >
          <Icon name="home" className="h-3.5 w-3.5 shrink-0" />
          {t("documents.browser.allDocuments")}
        </Link>
        {breadcrumb.map((folder, index) => (
          <span key={folder.id} className="flex items-center gap-1.5">
            <Icon
              name="chevronRight"
              className="h-3.5 w-3.5 text-[var(--muted,#62685f)]"
            />
            {index === breadcrumb.length - 1 ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--ink,#101310)]">
                <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                {folder.name}
              </span>
            ) : (
              <Link
                href={folderLink(folder.id)}
                className="inline-flex items-center gap-1.5 text-[var(--muted,#62685f)] transition hover:text-[var(--ink,#101310)]"
              >
                <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                {folder.name}
              </Link>
            )}
          </span>
        ))}
      </div>

      {!folderId && (
        <div className={`${CARD} border-l-4 border-l-[var(--signal,#d8ff3e)] p-3 sm:p-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-2 text-sm font-extrabold text-[var(--ink,#101310)]">
              <Icon name="folder" className="h-4 w-4 shrink-0" />
              {t("documents.browser.allDocuments")}
            </h2>
            <p className="text-xs font-bold text-[var(--ink,#101310)]">
              {t("documents.browser.allDocumentsCount", {
                count: libraryTotal,
              })}
            </p>
          </div>
          <p className="mt-1.5 inline-flex rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2.5 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
            {t("documents.browser.rootFilesCount", {
              count: rootDocumentCount,
            })}
          </p>
          <p className={`mt-2 text-sm ${MUTED}`}>
            {t("documents.browser.libraryHint")}
          </p>
        </div>
      )}

      {/* DOKUMENTDETALJ – versjoner og filbytte */}
      {detailDocument && (
        <div
          ref={detailRef}
          className={`${CARD} relative scroll-mt-24 space-y-4 overflow-hidden p-4 sm:p-5`}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
          />
          <div className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
                <Icon name="file" className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                  {detailDocument.title}
                </h2>
                <p className={`mt-0.5 truncate font-mono text-xs ${MUTED}`}>
                  {detailDocument.fileName} ·{" "}
                  {(detailDocument.fileSize / 1024).toFixed(0)} KB
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
                    <Icon name="folder" className="h-3 w-3 shrink-0" />
                    {t("documents.browser.folderPath", {
                      path:
                        detailDocument.folderPath ??
                        t("documents.browser.root"),
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line,#dedcd1)] bg-white px-2 py-0.5 text-xs font-bold text-[var(--muted,#62685f)]">
                    <Icon name="clock" className="h-3 w-3 shrink-0" />
                    {detailDocument.versions.length > 0
                      ? t("documents.browser.versionsCount", {
                          count: detailDocument.versions.length,
                        })
                      : t("documents.browser.noPreviousVersions")}
                  </span>
                </div>
              </div>
            </div>
            <Link
              href={returnTo ?? pageLink(page)}
              className={`${QUIET_BUTTON} shrink-0 whitespace-nowrap`}
            >
              <Icon
                name={returnTo ? "arrowRight" : "close"}
                className={`h-3.5 w-3.5 shrink-0 ${
                  returnTo ? "rotate-180" : ""
                }`}
              />
              {returnTo
                ? returnTo.startsWith("/sok")
                  ? t("documents.browser.backToSearch")
                  : t("documents.browser.backToContext")
                : t("documents.browser.close")}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={detailDocument.filePath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-4 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85"
            >
              <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
              {t("documents.browser.openPdf")}
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
            <details className="group rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                  {t("documents.versions.drawer", {
                    count: detailDocument.versions.length,
                  })}
                </span>
                <Icon
                  name="chevronDown"
                  className="h-3.5 w-3.5 shrink-0 transition group-open:rotate-180"
                />
              </summary>
              <div className="max-h-64 space-y-1.5 overflow-y-auto border-t border-[var(--line,#dedcd1)] p-2">
                {detailDocument.versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-bold text-[var(--ink,#101310)]">
                        <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                        {version.fileName}
                      </p>
                      <p className={`mt-0.5 font-mono ${MUTED}`}>
                        {new Date(version.createdAt).toLocaleString(locale)} ·{" "}
                        {(version.fileSize / 1024).toFixed(0)} KB
                        {version.createdBy ? ` · ${version.createdBy}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={version.filePath}
                        download={version.fileName}
                        className="inline-flex items-center gap-1 font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:no-underline"
                      >
                        <Icon
                          name="arrowRight"
                          className="h-3.5 w-3.5 shrink-0 rotate-90"
                        />
                        {t("documents.versions.download")}
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
                            className="font-bold text-[var(--muted,#62685f)] underline decoration-[var(--line,#dedcd1)] decoration-2 underline-offset-4 transition hover:text-[var(--ink,#101310)]"
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

      <div className="flex flex-col gap-5">
        {/* UNDERMAPPER */}
        {subFolders.length > 0 && !libraryScope && (
          <div className={folderId ? undefined : "order-2 lg:order-1"}>
            <h2 className={`mb-2 flex items-center gap-1.5 ${EYEBROW}`}>
              <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
              {folderId
                ? t("documents.browser.subfolders")
                : t("documents.browser.rootFolders")}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {subFolders.map((folder) => (
                <div
                  key={folder.id}
                  className={`${CARD} group relative min-w-0 transition hover:border-[var(--ink,#101310)]`}
                >
                  <Link
                    href={folderLink(folder.id)}
                    prefetch={false}
                    className="flex min-h-full flex-col gap-2 p-3 pr-9"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)] transition group-hover:bg-[var(--signal,#d8ff3e)]">
                      <Icon name="folder" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-[var(--ink,#101310)]">
                        {folder.name}
                      </span>
                      <span
                        className={`mt-0.5 block text-xs font-semibold ${MUTED}`}
                        title={t("documents.browser.folderCountHint")}
                      >
                        {t("documents.browser.folderCount", {
                          count: folderDocumentCounts[folder.id] ?? 0,
                        })}
                      </span>
                    </span>
                  </Link>
                  <div className="absolute right-1 top-1">
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className={`flex items-center gap-1.5 ${EYEBROW}`}>
              <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
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
              <label className="inline-flex items-center gap-2 text-xs font-bold text-[var(--ink,#101310)]">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  disabled={bulkBusy}
                  className="h-4 w-4 accent-[var(--ink,#101310)]"
                />
                {t("documents.bulkActions.selectAll")}
              </label>
            )}
          </div>

          {documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-8 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
                <Icon name="file" className="h-4 w-4" />
              </span>
              <p className="mt-2 text-sm font-bold text-[var(--ink,#101310)]">
                {emptyTitle}
              </p>
              <p className={`mt-1 text-xs ${MUTED}`}>{emptyHint}</p>
            </div>
          ) : (
            <div className={`${CARD} overflow-hidden`}>
              <div className="hidden items-center gap-2 border-b border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]/60 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)] md:flex">
                {canSelect && <span className="w-4 shrink-0" />}
                <span className="min-w-0 flex-1">
                  {t("documents.browser.tableDocument")}
                </span>
                {showFolderPath && (
                  <span className="w-36 shrink-0">
                    {t("documents.browser.tableFolder")}
                  </span>
                )}
                <span className="w-52 shrink-0">
                  {t("documents.browser.tableFile")}
                </span>
                <span className="ml-auto shrink-0 text-right">
                  {t("documents.browser.tableActions")}
                </span>
              </div>
              <div className="divide-y divide-[var(--line,#dedcd1)]">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={`flex flex-col gap-2 px-3 py-2.5 transition hover:bg-[var(--paper,#f2efe6)]/50 md:flex-row md:items-start ${
                      selected.has(doc.id) ? SELECTED_ROW : ""
                    }`}
                  >
                    {canSelect && (
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelected(doc.id)}
                        disabled={bulkBusy}
                        aria-label={t("documents.bulkActions.selectDocument", {
                          title: doc.title,
                        })}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ink,#101310)]"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[var(--ink,#101310)]">
                        {doc.title}
                      </p>
                      {doc.description && (
                        <p className={`mt-0.5 line-clamp-2 text-xs ${MUTED}`}>
                          {doc.description}
                        </p>
                      )}
                      {doc.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {doc.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold"
                              suppressHydrationWarning
                              style={{
                                backgroundColor: tag.color || "#3b82f6",
                                color: readableTextColor(
                                  tag.color || "#3b82f6",
                                ),
                              }}
                            >
                              <Icon name="flag" className="h-2.5 w-2.5 shrink-0" />
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {showFolderPath && (
                      <div className="min-w-0 md:w-36 md:shrink-0">
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
                          <Icon name="folder" className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {doc.folderPath ?? t("documents.browser.root")}
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="min-w-0 md:w-52 md:shrink-0">
                      <p
                        className="truncate font-mono text-xs text-[var(--ink,#101310)]"
                        title={doc.fileName}
                      >
                        {doc.fileName}
                      </p>
                      <p className={`truncate text-xs ${MUTED}`}>
                        {(doc.fileSize / 1024).toFixed(0)} KB
                        {doc.uploadedBy
                          ? ` · ${t("documents.browser.uploadedBy", {
                              name: doc.uploadedBy,
                            })}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 md:ml-auto md:shrink-0 md:justify-end">
                      {showDeleted ? (
                        <form action={restoreDocumentAction}>
                          <DocumentContextFields context={formContext} />
                          <input type="hidden" name="id" value={doc.id} />
                          <button
                            type="submit"
                            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--ink,#101310)] px-2.5 py-1 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
                          >
                            <Icon name="sync" className="h-3.5 w-3.5 shrink-0" />
                            {t("documents.browser.restore")}
                          </button>
                        </form>
                      ) : (
                        <>
                          <a
                            href={doc.filePath}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--ink,#101310)] px-2.5 py-1 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
                          >
                            <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                            {t("documents.browser.openPdf")}
                          </a>
                          {office && (
                            <Link
                              href={docLink(doc.id)}
                              prefetch={false}
                              className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2.5 py-1 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
                            >
                              <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                              {t("documents.browser.versions")}
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
                                className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:border-[#e7b5ae] hover:bg-[#fbe9e7]"
                              >
                                <Icon name="trash" className="h-3.5 w-3.5 shrink-0" />
                                {t("documents.browser.delete")}
                              </button>
                            </ConfirmSubmitForm>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
        <div className="sticky bottom-0 z-30 -mx-4 px-4 py-2 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
          <div className={`${CARD} border-t-4 border-t-[var(--signal,#d8ff3e)] px-3 py-2.5 shadow-[0_-8px_28px_-20px_rgba(16,19,16,0.5)] sm:px-4`}>
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-extrabold text-[var(--ink,#101310)]">
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ink,#101310)] px-1.5 text-xs font-black tabular-nums text-[var(--paper,#f2efe6)]">
                    {selected.size}
                  </span>
                  {t("documents.bulkActions.selected", {
                    count: selected.size,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set());
                    setBulkMoveTarget("");
                  }}
                  className="inline-flex min-h-9 items-center rounded-md px-2 text-xs font-bold text-[var(--muted,#62685f)] underline decoration-[var(--line,#dedcd1)] decoration-2 underline-offset-4 transition hover:text-[var(--ink,#101310)]"
                >
                  {t("documents.bulkActions.clear")}
                </button>

                {office && (
                  <div className="flex items-center gap-1">
                    <select
                      value={bulkMoveTarget}
                      onChange={(event) => setBulkMoveTarget(event.target.value)}
                      aria-label={t("documents.bulkActions.moveTo")}
                      className="min-h-9 rounded-md border border-[var(--line,#dedcd1)] bg-white px-2 text-xs font-medium text-[var(--ink,#101310)] outline-none focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
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
                      className={`${SIGNAL_BUTTON} min-h-9 px-3 py-1.5`}
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
                      className="min-h-9 rounded-md border border-[var(--line,#dedcd1)] bg-white px-2 text-xs font-medium text-[var(--ink,#101310)] outline-none focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
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
                      className={`${INK_BUTTON} min-h-9 px-3 py-1.5`}
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
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-[#e7b5ae] bg-transparent px-3 py-1.5 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fbe9e7] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5 shrink-0" />
                    {t("documents.bulkActions.delete")}
                  </button>
                )}

                {bulkBusy && (
                  <span className={`text-xs font-bold ${MUTED}`}>
                    {t("documents.bulkActions.busy")}
                  </span>
                )}
              </div>
            )}

            {bulkResult && (
              <div className={`${selected.size > 0 ? "mt-2 border-t border-[var(--line,#dedcd1)] pt-2" : ""} text-xs`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {"error" in bulkResult ? (
                      <p
                        role="alert"
                        className="flex items-start gap-1.5 font-bold text-[var(--risk-text,#b42318)]"
                      >
                        <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {bulkResult.error}
                      </p>
                    ) : (
                      <>
                        <p className="font-bold text-[var(--ink,#101310)]">
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
                                className={`flex items-start gap-1.5 ${
                                  item.status === "failed"
                                    ? "text-[var(--risk-text,#b42318)]"
                                    : "text-[var(--ink,#101310)]"
                                }`}
                              >
                                <Icon
                                  name={
                                    item.status === "failed" ? "alert" : "check"
                                  }
                                  className="mt-0.5 h-3 w-3 shrink-0"
                                />
                                <span>
                                  {item.title || item.id}:{" "}
                                  {item.status === "failed"
                                    ? t(errorKey(item.reason ?? "error"))
                                    : t("documents.bulkActions.itemOk")}
                                </span>
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
                        className="inline-flex min-h-8 items-center gap-1 rounded-md border border-[var(--ink,#101310)] px-2 py-1 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)] disabled:opacity-50"
                      >
                        <Icon
                          name="arrowRight"
                          className="h-3 w-3 shrink-0 rotate-180"
                        />
                        {t("documents.bulkActions.moveUndo")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setBulkResult(null);
                        setUndoMove(null);
                      }}
                      className="inline-flex min-h-8 items-center rounded-md px-1 text-xs font-bold text-[var(--muted,#62685f)] transition hover:text-[var(--ink,#101310)]"
                    >
                      {t("documents.bulkActions.dismiss")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
    >
      {children}
    </button>
  );
}
