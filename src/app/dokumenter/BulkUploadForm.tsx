"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { appendDocumentContext } from "./DocumentContextFields";
import type {
  DocumentBulkActionResult,
  DocumentDiscardUploadsResult,
  DocumentFormContext,
} from "./action-types";

type UploadedItem = {
  title: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  relativePath: string;
};

type RowStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "created"
  | "skipped"
  | "failed";

type ImportRow = {
  key: string;
  name: string;
  relativePath: string;
  size: number;
  file: File | null;
  isPdf: boolean;
  status: RowStatus;
  reason?: string;
  message?: string;
  fileUrl?: string;
  title?: string;
};

const REASON_KEYS: Record<string, string> = {
  duplicate: "documents.bulk.reasonDuplicate",
  not_pdf: "documents.bulk.reasonNotPdf",
  not_owned: "documents.bulk.reasonNotOwned",
  folder_failed: "documents.bulk.reasonFolderFailed",
  invalid: "documents.bulk.reasonInvalid",
  error: "documents.bulk.reasonError",
  upload: "documents.bulk.reasonUpload",
  server: "documents.bulk.reasonServer",
};

const ACTION_ERROR_KEYS: Record<string, string> = {
  forbidden: "documents.errors.forbidden",
  invalid: "documents.errors.invalid",
  not_found: "documents.errors.notFound",
  error: "documents.errors.generic",
};

const FIELD =
  "min-h-10 w-full rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
const QUIET_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button min-h-10 rounded-[10px] text-xs font-bold shadow-[2px_2px_0_var(--ink,#101310)] transition hover:shadow-[1px_1px_0_var(--ink,#101310)] disabled:cursor-not-allowed disabled:opacity-50";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function pdfTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export default function BulkUploadForm({
  context,
  bulkCreateDocuments,
  discardUploads,
}: {
  context: DocumentFormContext;
  bulkCreateDocuments: (
    formData: FormData,
  ) => Promise<DocumentBulkActionResult>;
  discardUploads: (
    formData: FormData,
  ) => Promise<DocumentDiscardUploadsResult>;
}) {
  const t = useTranslations("common");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "creating">(
    "idle",
  );
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const abortRequested = useRef(false);
  const orphanUrls = useRef<Set<string>>(new Set());
  const creatingRef = useRef(false);
  const unmountedRef = useRef(false);
  const discardRef = useRef(discardUploads);
  useEffect(() => {
    discardRef.current = discardUploads;
  }, [discardUploads]);

  // Ved unmount (f.eks. navigasjon) forsøker vi å rydde opplastinger som aldri
  // ble knyttet til et dokument. Serveren sletter bare filer brukeren eier.
  useEffect(() => {
    // Samme Set-instans muteres gjennom hele komponentens levetid.
    unmountedRef.current = false;
    const urlsRef = orphanUrls.current;
    return () => {
      unmountedRef.current = true;
      abortRequested.current = true;
      // Mens serveren oppretter dokumenter må vi ikke slette filene den er i
      // ferd med å knytte til seg. Oppryddingen skjer etter at kallet er ferdig.
      if (creatingRef.current) return;
      const urls = [...urlsRef];
      if (urls.length === 0) return;
      const formData = new FormData();
      formData.append("urls", JSON.stringify(urls));
      void discardRef.current(formData).catch(() => undefined);
    };
  }, []);

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        if (row.status === "created") acc.created++;
        else if (row.status === "skipped") acc.skipped++;
        else if (row.status === "failed") acc.failed++;
        return acc;
      },
      { created: 0, skipped: 0, failed: 0 },
    );
  }, [rows]);

  const failedRows = rows.filter(
    (row) => row.status === "failed" && row.isPdf,
  );
  const hasResult = rows.some((row) =>
    ["created", "skipped", "failed"].includes(row.status),
  );

  const folders = useMemo(() => {
    const result = new Set<string>();
    for (const row of rows) {
      const parts = row.relativePath.split("/");
      for (let i = 1; i < parts.length; i++) {
        result.add(parts.slice(0, i).join("/"));
      }
    }
    return [...result].sort();
  }, [rows]);

  function updateRow(key: string, patch: Partial<ImportRow>) {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  async function discardOrphans(urls: string[]) {
    if (urls.length === 0) return;
    const formData = new FormData();
    formData.append("urls", JSON.stringify([...new Set(urls)]));
    try {
      const result = await discardUploads(formData);
      if (result.ok) {
        for (const url of urls) orphanUrls.current.delete(url);
      }
    } catch {
      // Opprydding er best-effort; filene kan ryddes ved et nytt forsøk.
    }
  }

  function resetRows(nextRows: ImportRow[]) {
    const previousOrphans = [...orphanUrls.current];
    if (previousOrphans.length > 0) void discardOrphans(previousOrphans);
    setRows(nextRows);
    setError(null);
    setNotice(null);
    setProgress("");
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files;
    if (!selected) return;
    let pdfCount = 0;
    for (let i = 0; i < selected.length; i++) {
      if (selected[i].name.toLowerCase().endsWith(".pdf")) pdfCount++;
    }
    if (pdfCount > 1000) {
      setError(t("documents.bulk.tooMany", { max: 1000 }));
      return;
    }
    const items: ImportRow[] = [];
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      const relativePath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      items.push({
        key: `${i}:${relativePath}`,
        name: file.name,
        relativePath: normalizePath(relativePath),
        size: file.size,
        file: isPdf ? file : null,
        isPdf,
        status: isPdf ? "pending" : "skipped",
        reason: isPdf ? undefined : "not_pdf",
      });
    }
    resetRows(items);
  }

  async function runImport(targetRows: ImportRow[]) {
    if (targetRows.length === 0) return;
    setBusy(true);
    setPhase("uploading");
    setError(null);
    setNotice(null);
    abortRequested.current = false;

    const uploaded: UploadedItem[] = [];
    const uploadedRowKeys = new Set<string>();
    let aborted = false;

    try {
      let index = 0;
      for (const row of targetRows) {
        if (!row.isPdf) continue;
        if (abortRequested.current) {
          aborted = true;
          break;
        }
        index++;
        let fileUrl = row.fileUrl;
        let fileName = row.name;
        let fileSize = row.size;
        const title = row.title ?? pdfTitle(row.name);

        if (!fileUrl) {
          if (!row.file) {
            updateRow(row.key, {
              status: "failed",
              reason: "error",
              message: t("documents.bulk.reasonMissingFile"),
            });
            continue;
          }
          updateRow(row.key, {
            status: "uploading",
            reason: undefined,
            message: undefined,
          });
          setProgress(
            t("documents.bulk.progressUploading", {
              current: index,
              total: targetRows.filter((item) => item.isPdf).length,
              name: row.name,
            }),
          );
          try {
            // Les filen på nytt for å unngå boundary-problemer med
            // webkitdirectory-filer.
            const buffer = await row.file.arrayBuffer();
            const cleanFile = new File([buffer], row.name, {
              type: "application/pdf",
            });
            const formData = new FormData();
            formData.append("file", cleanFile, cleanFile.name);
            formData.append("purpose", "document");
            const res = await fetch("/api/upload", {
              method: "POST",
              body: formData,
            });
            const data = await res.json();
            if (!res.ok) {
              throw new Error(
                data.error ||
                  t("documents.bulk.fileUploadFailed", { name: row.name }),
              );
            }
            fileUrl = data.fileUrl;
            fileName = data.fileName || row.name;
            fileSize = data.fileSize ?? row.size;
            orphanUrls.current.add(fileUrl!);
          } catch (err) {
            if (abortRequested.current) {
              aborted = true;
              break;
            }
            updateRow(row.key, {
              status: "failed",
              reason: "upload",
              message: err instanceof Error ? err.message : undefined,
            });
            continue;
          }
        } else {
          orphanUrls.current.add(fileUrl);
        }

        uploaded.push({
          title,
          fileUrl: fileUrl!,
          fileName,
          fileSize,
          relativePath: row.relativePath,
        });
        uploadedRowKeys.add(row.key);
        updateRow(row.key, {
          status: "uploaded",
          fileUrl,
          title,
        });
      }

      if (abortRequested.current) {
        aborted = true;
      }

      if (aborted) {
        await discardOrphans([...orphanUrls.current]);
        setRows((prev) =>
          prev.map((row) =>
            row.status === "created" || row.status === "skipped"
              ? row
              : {
                  ...row,
                  status: row.isPdf ? "pending" : "skipped",
                  fileUrl: undefined,
                  reason: row.isPdf ? undefined : "not_pdf",
                  message: undefined,
                },
          ),
        );
        setNotice(t("documents.bulk.aborted"));
        return;
      }

      if (uploaded.length === 0) {
        return;
      }

      setPhase("creating");
      creatingRef.current = true;
      setProgress(t("documents.bulk.progressCreating"));
      const formData = new FormData();
      formData.append("items", JSON.stringify(uploaded));
      if (context.folderId) formData.append("folderId", context.folderId);
      appendDocumentContext(formData, context);

      let result: DocumentBulkActionResult;
      try {
        result = await bulkCreateDocuments(formData);
      } catch {
        setRows((prev) =>
          prev.map((row) =>
            uploadedRowKeys.has(row.key)
              ? { ...row, status: "failed", reason: "server" }
              : row,
          ),
        );
        setError(t("documents.bulk.serverFailed"));
        return;
      }

      if (!result.ok) {
        setRows((prev) =>
          prev.map((row) =>
            uploadedRowKeys.has(row.key)
              ? { ...row, status: "failed", reason: "server" }
              : row,
          ),
        );
        setError(
          t(ACTION_ERROR_KEYS[result.reason] ?? "documents.bulk.serverFailed"),
        );
        return;
      }

      const byPath = new Map(
        result.results.map((item) => [normalizePath(item.relativePath), item]),
      );
      setRows((prev) =>
        prev.map((row) => {
          if (!uploadedRowKeys.has(row.key)) return row;
          const item = byPath.get(row.relativePath);
          if (!item) {
            return { ...row, status: "failed", reason: "server" };
          }
          if (item.status === "created") {
            orphanUrls.current.delete(row.fileUrl ?? "");
            return {
              ...row,
              status: "created",
              file: null,
              reason: undefined,
              message: undefined,
            };
          }
          if (item.status === "skipped") {
            // Serveren rydder duplikatopplastingen. Vi beholder URL-en i
            // oppryddingssettet, slik at et nytt forsøk kan fjerne den hvis
            // serveroppryddingen skulle feile.
            return {
              ...row,
              status: "skipped",
              file: null,
              reason: item.reason,
              message: undefined,
            };
          }
          return {
            ...row,
            status: "failed",
            reason: item.reason ?? "error",
          };
        }),
      );
      setNotice(
        t("documents.bulk.resultCounts", {
          created: result.created,
          skipped: result.skipped,
          failed: result.failed,
        }),
      );
    } finally {
      creatingRef.current = false;
      setBusy(false);
      setPhase("idle");
      setProgress("");
      if (unmountedRef.current && orphanUrls.current.size > 0) {
        const formData = new FormData();
        formData.append(
          "urls",
          JSON.stringify([...orphanUrls.current]),
        );
        void discardRef.current(formData).catch(() => undefined);
      }
    }
  }

  async function handleSubmit() {
    if (rows.length === 0) {
      setError(t("documents.bulk.chooseFirst"));
      return;
    }
    const work = rows.filter(
      (row) => row.isPdf && row.status !== "created" && row.status !== "skipped",
    );
    if (work.length === 0) {
      setError(t("documents.bulk.chooseFirst"));
      return;
    }
    await runImport(work);
  }

  function handleRetry() {
    void runImport(failedRows);
  }

  async function handleAbort() {
    abortRequested.current = true;
    if (!busy) {
      const urls = [...orphanUrls.current];
      await discardOrphans(urls);
      setRows((prev) =>
        prev.map((row) =>
          row.status === "uploaded" || row.status === "failed"
            ? {
                ...row,
                status: row.isPdf ? "pending" : "skipped",
                fileUrl: undefined,
                reason: row.isPdf ? undefined : "not_pdf",
                message: undefined,
              }
            : row,
        ),
      );
      setNotice(t("documents.bulk.aborted"));
      setError(null);
    }
  }

  async function handleClear() {
    abortRequested.current = true;
    const urls = [...orphanUrls.current];
    await discardOrphans(urls);
    setRows([]);
    setError(null);
    setNotice(null);
    setProgress("");
  }

  const canSubmit =
    !busy && rows.some((row) => row.file || row.fileUrl) &&
    rows.some(
      (row) =>
        row.isPdf && row.status !== "created" && row.status !== "skipped",
    );

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="bulk-folder-input"
          className={LABEL}
        >
          {t("documents.bulk.chooseFolder")}
        </label>
        <input
          id="bulk-folder-input"
          type="file"
          // @ts-expect-error -- ikke-standardattributt som nettleserne støtter
          webkitdirectory=""
          directory=""
          multiple
          disabled={busy}
          onChange={handleFolderSelect}
          className={FIELD}
        />
        <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
          {t("documents.bulk.chooseFolderHint")}
        </p>
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-sm">
          <p className="mb-2 flex items-center gap-1.5 font-bold text-[var(--ink,#101310)]">
            <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
            {t("documents.bulk.summary", {
              files: rows.filter((row) => row.isPdf).length,
              folders: folders.length,
            })}
          </p>
          <div className="max-h-48 space-y-0.5 overflow-y-auto text-xs text-[var(--muted,#62685f)]">
            {folders.map((folder) => (
              <div key={folder} className="flex items-center gap-1.5">
                <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                {folder}/
              </div>
            ))}
            {rows.map((row) => (
              <div
                key={row.key}
                className={`pl-4 ${
                  row.status === "failed"
                    ? "text-[var(--risk-text,#b42318)]"
                    : row.status === "skipped"
                      ? "text-[#7a4f0c]"
                      : "text-[var(--muted,#62685f)]"
                }`}
              >
                <Icon
                  name={
                    row.status === "created"
                      ? "check"
                      : row.status === "skipped"
                        ? "alert"
                        : row.status === "failed"
                          ? "alert"
                          : "file"
                  }
                  className="inline-block h-3.5 w-3.5 align-[-0.125em]"
                />{" "}
                {row.relativePath}
                {row.status === "failed" && row.reason
                  ? ` – ${t(REASON_KEYS[row.reason] ?? "documents.bulk.reasonError")}`
                  : ""}
                {row.status === "failed" && row.message
                  ? ` (${row.message})`
                  : ""}
                {row.status === "skipped" && row.reason
                  ? ` – ${t(REASON_KEYS[row.reason] ?? "documents.bulk.reasonError")}`
                  : ""}
              </div>
            ))}
          </div>
          {hasResult && (
            <p className="mt-2 text-xs font-bold text-[var(--ink,#101310)]">
              {t("documents.bulk.resultCounts", counts)}
            </p>
          )}
        </div>
      )}

      {progress && !error && (
        <p role="status" className="text-xs font-bold text-[var(--muted,#62685f)]">
          {progress}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="text-xs font-bold text-[var(--ink,#101310)]">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs font-bold text-[var(--risk-text,#b42318)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`${SIGNAL_BUTTON} min-w-[10rem] flex-1`}
        >
          <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
          {busy
            ? t("documents.bulk.uploading")
            : t("documents.bulk.uploadButton", {
                count: rows.filter(
                  (row) =>
                    row.isPdf &&
                    row.status !== "created" &&
                    row.status !== "skipped",
                ).length,
              })}
        </button>

        {busy && phase === "uploading" && (
          <button
            type="button"
            onClick={handleAbort}
            className={QUIET_BUTTON}
          >
            {t("documents.bulk.abort")}
          </button>
        )}

        {!busy && failedRows.length > 0 && (
          <button
            type="button"
            onClick={handleRetry}
            className={QUIET_BUTTON}
          >
            <Icon name="sync" className="h-3.5 w-3.5 shrink-0" />
            {t("documents.bulk.retryFailed", { count: failedRows.length })}
          </button>
        )}

        {!busy && rows.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className={QUIET_BUTTON}
          >
            {t("documents.bulk.clear")}
          </button>
        )}
      </div>
    </div>
  );
}
