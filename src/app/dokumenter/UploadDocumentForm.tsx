"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import TagSelector from "@/components/TagSelector";

export default function UploadDocumentForm({
  folderId,
  allTags,
  createDocument,
}: {
  folderId: string | null;
  allTags: { id: string; name: string; color: string }[];
  createDocument: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("common");
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
    } catch (err: any) {
      setError(err.message || t("documents.upload.uploadFailed"));
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
      <div>
        <label htmlFor="upload-pdf-input" className="block text-sm font-bold text-gray-700 mb-1">{t("documents.upload.pdfFile")}</label>
        <input
          id="upload-pdf-input"
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
        />
        {uploading && <p className="text-xs text-blue-600 mt-1">{t("documents.upload.uploading")}</p>}
        {fileUrl && <p className="text-xs text-green-600 mt-1">✓ {t("documents.upload.uploaded", { name: fileName })}</p>}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      <div>
        <label htmlFor="upload-document-title" className="block text-sm font-bold text-gray-700 mb-1">{t("documents.upload.title")}</label>
        <input
          id="upload-document-title"
          type="text"
          name="title"
          required
          placeholder={t("documents.upload.titlePlaceholder")}
          className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
        />
      </div>
      <div>
        <label htmlFor="upload-document-description" className="block text-sm font-bold text-gray-700 mb-1">{t("documents.upload.description")}</label>
        <textarea
          id="upload-document-description"
          name="description"
          rows={2}
          placeholder={t("documents.upload.descriptionPlaceholder")}
          className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">{t("documents.upload.tags")}</label>
        <TagSelector allTags={allTags} />
      </div>
      <button
        type="submit"
        disabled={!fileUrl || uploading}
        className="w-full bg-[var(--primary-color)] text-white py-2.5 rounded-xl font-bold hover:opacity-90 transition shadow-sm disabled:opacity-50"
      >
        {t("documents.upload.save")}
      </button>
    </form>
  );
}