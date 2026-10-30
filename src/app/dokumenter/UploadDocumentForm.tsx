"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import TagSelector from "@/components/TagSelector";
import Icon from "@/components/icons";
import DocumentContextFields from "./DocumentContextFields";
import type { DocumentFormContext } from "./action-types";

export default function UploadDocumentForm({
  folderId,
  allTags,
  createDocument,
  context,
}: {
  folderId: string | null;
  allTags: { id: string; name: string; color: string }[];
  createDocument: (formData: FormData) => Promise<void>;
  context: DocumentFormContext;
}) {
  const t = useTranslations("common");
  const fieldClass =
    "min-h-10 w-full rounded-lg border border-[var(--line,#dedcd1)] bg-white px-3 text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]";
  const labelClass =
    "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError(t("documents.upload.pdfOnly"));
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
      if (!res.ok) throw new Error(data.error || t("documents.upload.uploadFailed"));
      setFileUrl(data.fileUrl);
      setFileName(data.fileName);
      setFileSize(data.fileSize);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("documents.upload.uploadFailed"),
      );
      setFileUrl(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fileUrl) {
      setError(t("documents.upload.uploadFirst"));
      return;
    }
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("fileUrl", fileUrl);
    formData.set("fileName", fileName);
    formData.set("fileSize", String(fileSize));
    if (folderId) formData.set("folderId", folderId);
    await createDocument(formData);
    // Reset
    setFileUrl(null);
    setFileName("");
    setFileSize(0);
    form.reset();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <DocumentContextFields context={context} />
      <div>
        <label htmlFor="upload-pdf-input" className={labelClass}>
          {t("documents.upload.pdfFile")}
        </label>
        <input
          id="upload-pdf-input"
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className={fieldClass}
        />
        {uploading && (
          <p className="mt-1 text-xs font-bold text-[var(--muted,#62685f)]">
            {t("documents.upload.uploading")}
          </p>
        )}
        {fileUrl && (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)]">
            <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
            {t("documents.upload.uploaded", { name: fileName })}
          </p>
        )}
        {error && (
          <p className="mt-1 text-xs font-bold text-[var(--risk-text,#b42318)]">
            {error}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="upload-document-title" className={labelClass}>
          {t("documents.upload.title")}
        </label>
        <input
          id="upload-document-title"
          type="text"
          name="title"
          required
          placeholder={t("documents.upload.titlePlaceholder")}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="upload-document-description" className={labelClass}>
          {t("documents.upload.description")}
        </label>
        <textarea
          id="upload-document-description"
          name="description"
          rows={2}
          placeholder={t("documents.upload.descriptionPlaceholder")}
          className={`${fieldClass} py-2`}
        />
      </div>
      <div>
        <label className={labelClass}>{t("documents.upload.tags")}</label>
        <TagSelector allTags={allTags} />
      </div>
      <button
        type="submit"
        disabled={!fileUrl || uploading}
        className="signal-button min-h-10 w-full rounded-[10px] text-xs font-bold shadow-[2px_2px_0_var(--ink,#101310)] transition hover:shadow-[1px_1px_0_var(--ink,#101310)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon name="check" className="h-4 w-4" />
        {t("documents.upload.save")}
      </button>
    </form>
  );
}