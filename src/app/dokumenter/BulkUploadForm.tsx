"use client";

import { useState } from "react";

type FileItem = {
  file: File;
  relativePath: string;
};

type UploadedItem = {
  title: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  relativePath: string;
};

export default function BulkUploadForm({
  folderId,
  allTags,
  existingFiles = [],
  bulkCreateDocuments,
}: {
  folderId: string | null;
  allTags: { id: string; name: string; color: string }[];
  existingFiles?: { fileName: string; fileSize: number }[];
  bulkCreateDocuments: (formData: FormData) => Promise<void>;
}) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files;
    if (!selected) return;
    const items: FileItem[] = [];
    let skipCount = 0;
    for (let i = 0; i < selected.length; i++) {
      const f = selected[i];
      if (!f.name.toLowerCase().endsWith(".pdf")) continue;
      // Hopp over filer som allerede eksisterer med samme størrelse
      const dup = existingFiles.find((ex) => ex.fileName === f.name && ex.fileSize === f.size);
      if (dup) {
        skipCount++;
        continue;
      }
      const rel = (f as any).webkitRelativePath || f.name;
      items.push({ file: f, relativePath: rel });
    }
    setFiles(items);
    setSkipped(skipCount);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Velg en mappe med PDF-filer først.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploaded: UploadedItem[] = [];
      let i = 0;
      for (const item of files) {
        i++;
        setProgress(`Laster opp ${i}/${files.length}: ${item.file.name}`);
        // Les filen som ArrayBuffer og lag ny File for å unngå problemer
        // med webkitdirectory-filer (boundary-feil).
        const buffer = await item.file.arrayBuffer();
        const cleanFile = new File([buffer], item.file.name, { type: item.file.type || "application/pdf" });
        const formData = new FormData();
        formData.append("file", cleanFile, cleanFile.name);
        formData.append("purpose", "document");
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          console.error("Upload failed:", res.status, data);
        }
        if (!res.ok) throw new Error(data.error || `Feil ved opplasting av ${item.file.name}`);
        const ext = item.file.name.substring(item.file.name.lastIndexOf("."));
        uploaded.push({
          title: item.file.name.replace(/\.[^.]+$/, ""),
          fileUrl: data.fileUrl,
          fileName: data.fileName,
          fileSize: data.fileSize,
          relativePath: item.relativePath,
        });
      }

      setProgress("Oppretter dokumenter i database...");
      const fd = new FormData();
      fd.append("items", JSON.stringify(uploaded));
      if (folderId) fd.append("folderId", folderId);
      await bulkCreateDocuments(fd);

      setProgress(`✓ Ferdig! ${uploaded.length} dokumenter lastet opp.`);
      setFiles([]);
    } catch (err: any) {
      setError(err.message || "Opplasting feilet");
    } finally {
      setUploading(false);
    }
  }

  // Preview folder structure
  const folders = new Set<string>();
  for (const item of files) {
    const parts = item.relativePath.split(/[/\\]/);
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1">Velg mappe</label>
        <input
          type="file"
          // @ts-expect-error -- ikke-standardattributt som nettleserne støtter
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleFolderSelect}
          className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
        />
        <p className="text-xs text-gray-500 mt-1">
          Velg en mappe. Alle PDF-filer i mappen og undermapper importeres.
        </p>
      </div>

      {skipped > 0 && (
        <p className="text-xs text-amber-600">
          ⚠️ {skipped} fil(er) hoppet over fordi de allerede eksisterer med samme størrelse.
        </p>
      )}
      {files.length > 0 && (
        <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-sm">
          <p className="font-bold text-gray-700 mb-2">
            {files.length} PDF-filer å laste opp, {folders.size} undermapper
          </p>
          <div className="max-h-40 overflow-y-auto text-xs text-gray-600 space-y-0.5">
            {Array.from(folders).sort().map((f) => (
              <div key={f}>📁 {f}/</div>
            ))}
            {files.map((item, i) => (
              <div key={i} className="pl-4">📄 {item.relativePath}</div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {progress && !error && <p className="text-xs text-blue-600">{progress}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={files.length === 0 || uploading}
        className="w-full bg-[var(--primary-color)] text-white py-2.5 rounded-xl font-bold hover:opacity-90 transition shadow-sm disabled:opacity-50"
      >
        {uploading ? "Laster opp..." : `📥 Last opp ${files.length} filer`}
      </button>
    </div>
  );
}