"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import TagSelector from "@/components/TagSelector";
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
        className="text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-xl border border-blue-200 transition whitespace-nowrap"
      >
        {open ? t("documents.edit.close") : t("documents.edit.open")}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
        <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <DocumentContextFields context={context} />
          <input type="hidden" name="id" value={doc.id} />
          <div>
            <label htmlFor={`edit-document-title-${doc.id}`} className="block text-xs font-bold text-gray-700 mb-1">{t("documents.edit.title")}</label>
            <input
              id={`edit-document-title-${doc.id}`}
              type="text"
              name="title"
              defaultValue={doc.title}
              required
              className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
            />
          </div>
          <div>
            <label htmlFor={`edit-document-description-${doc.id}`} className="block text-xs font-bold text-gray-700 mb-1">{t("documents.edit.description")}</label>
            <textarea
              id={`edit-document-description-${doc.id}`}
              name="description"
              rows={2}
              defaultValue={doc.description || ""}
              className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
            />
          </div>
          <div>
            <label htmlFor={`edit-document-folder-${doc.id}`} className="block text-xs font-bold text-gray-700 mb-1">{t("documents.edit.folder")}</label>
            <select
              id={`edit-document-folder-${doc.id}`}
              name="folderId"
              defaultValue={doc.folderId || ""}
              className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
            >
              <option value="">{t("documents.edit.rootFolder")}</option>
              {allFolders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">{t("documents.edit.tags")}</label>
            <TagSelector allTags={allTags} selectedTagNames={doc.tags.map((tag) => tag.name)} />
          </div>
          <div>
            <label htmlFor="edit-document-pdf-input" className="block text-xs font-bold text-gray-700 mb-1">{t("documents.edit.replaceFile")}</label>
            <input
              id="edit-document-pdf-input"
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
            />
            {uploading && <p className="text-xs text-blue-600 mt-1">{t("documents.edit.uploadingNew")}</p>}
            {replacing && (
              <p className="text-xs text-green-600 mt-1">
                {t("documents.edit.newFileReady", {
                  name: newFileName,
                  size: (newFileSize / 1024).toFixed(0),
                })}
              </p>
            )}
            {!replacing && (
              <p className="text-xs text-gray-500 mt-1">
                {t("documents.edit.currentFile", {
                  name: doc.fileName,
                  size: (doc.fileSize / 1024).toFixed(0),
                })}
              </p>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-700 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition"
          >
            {t("documents.edit.save")}
          </button>
        </form>

        {doc.versions && doc.versions.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-bold text-gray-700 mb-2">{t("documents.edit.previousVersions", { count: doc.versions.length })}</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {doc.versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <p className="text-gray-800 font-medium truncate">{v.fileName}</p>
                    <p className="text-gray-500">
                      {new Date(v.createdAt).toLocaleString(locale)}
                      {v.createdBy ? ` • ${v.createdBy}` : ""}
                      {` • ${(v.fileSize / 1024).toFixed(0)} KB`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={v.filePath}
                      download={v.fileName}
                      className="text-blue-700 font-bold hover:underline whitespace-nowrap"
                    >
                      {t("documents.edit.downloadVersion")}
                    </a>
                    <form action={restoreVersion}>
                      <DocumentContextFields context={context} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <button
                        type="submit"
                        className="text-amber-700 font-bold hover:underline whitespace-nowrap"
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