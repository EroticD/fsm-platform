"use client";

import { useState } from "react";
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Bare PDF-filer er tillatt.");
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
      if (!res.ok) throw new Error(data.error || "Opplasting feilet");
      setFileUrl(data.fileUrl);
      setFileName(data.fileName);
      setFileSize(data.fileSize);
    } catch (err: any) {
      setError(err.message || "Opplasting feilet");
      setFileUrl(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!fileUrl) {
      setError("Last opp en PDF først.");
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
        <label className="block text-sm font-bold text-gray-700 mb-1">PDF-fil</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
        />
        {uploading && <p className="text-xs text-blue-600 mt-1">Laster opp...</p>}
        {fileUrl && <p className="text-xs text-green-600 mt-1">✓ Opplastet: {fileName}</p>}
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">Tittel</label>
        <input
          type="text"
          name="title"
          required
          placeholder="F.eks. Brukermanual varmepumpe"
          className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">Beskrivelse (valgfritt)</label>
        <textarea
          name="description"
          rows={2}
          placeholder="Kort beskrivelse av innholdet..."
          className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">Tags</label>
        <TagSelector allTags={allTags} />
      </div>
      <button
        type="submit"
        disabled={!fileUrl || uploading}
        className="w-full bg-[var(--primary-color)] text-white py-2.5 rounded-xl font-bold hover:opacity-90 transition shadow-sm disabled:opacity-50"
      >
        💾 Lagre dokument
      </button>
    </form>
  );
}