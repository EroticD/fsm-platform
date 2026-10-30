"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import TagSelector from "@/components/TagSelector";
import Icon from "@/components/icons";
import DocumentContextFields from "./DocumentContextFields";
import type { DocumentFormContext } from "./action-types";

type Folder = { id: string; name: string };
type Tag = { id: string; name: string; color: string };
type DocVersion = {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  createdAt: string | Date;
  createdBy: string | null;
};

type Doc = {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  fileSize: number;
  folderId: string | null;
  tags: { id: string; name: string }[];
  versions?: DocVersion[];
};

export default function EditDocumentForm({
  doc,
  allFolders,
  allTags,
  updateDocument,
  restoreVersion,
  context,
}: {
  doc: Doc;
  allFolders: Folder[];
  allTags: Tag[];
  updateDocument: (formData: FormData) => Promise<void>;
  restoreVersion: (formData: FormData) => Promise<void>;
  context: DocumentFormContext;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const fieldClass =
    "min-h-10 w-full rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]";
  const labelClass =
    "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFileUrl, setNewFileUrl] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState<string>("");
  const [newFileSize, setNewFileSize] = useState<number>(0);
  const [replacing, setReplacing] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError(t("documents.edit.pdfOnly"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", "document");
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("documents.edit.uploadFailed"));
      setNewFileUrl(data.fileUrl);
      setNewFileName(data.fileName);
      setNewFileSize(data.fileSize);
      setReplacing(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("documents.edit.uploadFailed"),
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    if (newFileUrl) {
      formData.set("fileUrl", newFileUrl);
      formData.set("fileName", newFileName);
      formData.set("fileSize", String(newFileSize));
    }
    await updateDocument(formData);
    setOpen(false);
    setNewFileUrl(null);
    setReplacing(false);
    setError(null);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--ink,#101310)] bg-transparent px-2.5 py-1 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
      >
        <Icon name={open ? "close" : "edit"} className="h-3.5 w-3.5 shrink-0" />
        {open ? t("documents.edit.close") : t("documents.edit.open")}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
        >
          <DocumentContextFields context={context} />
          <input type="hidden" name="id" value={doc.id} />
          <div>
            <label htmlFor={`edit-document-title-${doc.id}`} className={labelClass}>
              {t("documents.edit.title")}
            </label>
            <input
              id={`edit-document-title-${doc.id}`}
              type="text"
              name="title"
              defaultValue={doc.title}
              required
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor={`edit-document-description-${doc.id}`} className={labelClass}>
              {t("documents.edit.description")}
            </label>
            <textarea
              id={`edit-document-description-${doc.id}`}
              name="description"
              rows={2}
              defaultValue={doc.description || ""}
              className={`${fieldClass} py-2`}
            />
          </div>
          <div>
            <label htmlFor={`edit-document-folder-${doc.id}`} className={labelClass}>
              {t("documents.edit.folder")}
            </label>
            <select
              id={`edit-document-folder-${doc.id}`}
              name="folderId"
              defaultValue={doc.folderId || ""}
              className={fieldClass}
            >
              <option value="">{t("documents.edit.rootFolder")}</option>
              {allFolders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{t("documents.edit.tags")}</label>
            <TagSelector allTags={allTags} selectedTagNames={doc.tags.map((tag) => tag.name)} />
          </div>
          <div>
            <label htmlFor="edit-document-pdf-input" className={labelClass}>
              {t("documents.edit.replaceFile")}
            </label>
            <input
              id="edit-document-pdf-input"
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className={fieldClass}
            />
            {uploading && (
              <p className="mt-1 text-xs font-bold text-[var(--muted,#62685f)]">
                {t("documents.edit.uploadingNew")}
              </p>
            )}
            {replacing && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)]">
                <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
                {t("documents.edit.newFileReady", {
                  name: newFileName,
                  size: (newFileSize / 1024).toFixed(0),
                })}
              </p>
            )}
            {!replacing && (
              <p className="mt-1 font-mono text-xs text-[var(--muted,#62685f)]">
                {t("documents.edit.currentFile", {
                  name: doc.fileName,
                  size: (doc.fileSize / 1024).toFixed(0),
                })}
              </p>
            )}
          </div>
          {error && (
            <p className="text-xs font-bold text-[var(--risk-text,#b42318)]">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-4 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85"
          >
            <Icon name="check" className="h-4 w-4" />
            {t("documents.edit.save")}
          </button>
        </form>

        {doc.versions && doc.versions.length > 0 && (
          <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-white p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)]">
              <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
              {t("documents.edit.previousVersions", { count: doc.versions.length })}
            </p>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {doc.versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[var(--ink,#101310)]">{v.fileName}</p>
                    <p className="font-mono text-[var(--muted,#62685f)]">
                      {new Date(v.createdAt).toLocaleString(locale)}
                      {v.createdBy ? ` · ${v.createdBy}` : ""}
                      {` · ${(v.fileSize / 1024).toFixed(0)} KB`}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <a
                      href={v.filePath}
                      download={v.fileName}
                      className="whitespace-nowrap font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:no-underline"
                    >
                      {t("documents.edit.downloadVersion")}
                    </a>
                    <form action={restoreVersion}>
                      <DocumentContextFields context={context} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <button
                        type="submit"
                        className="whitespace-nowrap font-bold text-[var(--muted,#62685f)] underline decoration-[var(--line,#dedcd1)] decoration-2 underline-offset-4 transition hover:text-[var(--ink,#101310)]"
                      >
                        {t("documents.edit.restore")}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}