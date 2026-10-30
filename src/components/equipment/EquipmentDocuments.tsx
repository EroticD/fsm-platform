"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

export type EquipmentDocument = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  storedName: string;
  createdAt: Date | string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Dokumenter for en enhet. Selve filen lastes opp til /api/upload med
 * `equipmentId`, som setter eiertypen EQUIPMENT og arver kundens avdeling.
 */
export default function EquipmentDocuments({
  equipmentId,
  documents,
  canUpload,
}: {
  equipmentId: string;
  documents: EquipmentDocument[];
  canUpload: boolean;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setBusy(true);
    setError("");
    const failed: string[] = [];

    for (const file of files) {
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("equipmentId", equipmentId);
        const response = await fetch("/api/upload", {
          method: "POST",
          body,
        });
        if (!response.ok) throw new Error("upload failed");
      } catch {
        failed.push(file.name);
      }
    }

    setBusy(false);
    if (failed.length > 0) {
      setError(t("assets.documents.uploadError"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <p className="text-xs italic text-[var(--muted,#62685f)]">
          {t("assets.documents.empty")}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-2"
            >
              <Icon name="file" className="h-4 w-4 shrink-0" />
              <a
                href={`/uploads/${document.storedName}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-xs font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
              >
                {document.originalName}
              </a>
              <span className="shrink-0 text-2xs text-[var(--muted,#62685f)]">
                {formatSize(document.size)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div>
          <label
            htmlFor={inputId}
            className="text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]"
          >
            {t("assets.documents.uploadLabel")}
          </label>
          <input
            id={inputId}
            type="file"
            multiple
            accept="image/*,application/pdf,.pdf"
            disabled={busy}
            onChange={handleChange}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="mt-1 block min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink,#101310)] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[var(--paper,#f2efe6)]"
          />
          <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
            {t("assets.documents.hint")}
          </p>
          {busy && (
            <p className="mt-1 text-xs font-bold text-[var(--ink,#101310)]">
              {t("assets.documents.uploading")}
            </p>
          )}
          {error && (
            <p
              id={errorId}
              role="alert"
              className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--risk-text,#b42318)]"
            >
              <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
