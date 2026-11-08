"use client";

import { useRef, useState } from "react";

/**
 * Laster kvittering gjennom den eksisterende `/api/upload`-ruten og legger
 * den returnerte filadressen i et skjult felt. Selve vedlegget valideres på
 * nytt av tjenestelaget når utlegget lagres.
 */
export default function ReceiptUploadField({
  workOrderId,
  existingUrl,
  label,
  uploadingLabel,
  errorLabel,
}: {
  workOrderId?: string;
  existingUrl?: string | null;
  label: string;
  uploadingLabel: string;
  errorLabel: string;
}) {
  const [url, setUrl] = useState(existingUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      if (workOrderId) body.set("workOrderId", workOrderId);
      const response = await fetch("/api/upload", {
        method: "POST",
        body,
      });
      const data = (await response.json().catch(() => ({}))) as {
        fileUrl?: string;
      };
      if (!response.ok || !data.fileUrl) {
        setError(errorLabel);
        return;
      }
      setUrl(data.fileUrl);
    } catch {
      setError(errorLabel);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold" htmlFor="receipt-file">
        {label}
      </label>
      <input
        ref={inputRef}
        id="receipt-file"
        type="file"
        accept="image/*,application/pdf"
        className="block w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <input type="hidden" name="receiptUrl" value={url} />
      {busy && <p className="text-xs font-bold">{uploadingLabel}</p>}
      {url && !busy && (
        <a
          className="text-xs font-bold underline underline-offset-2"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          {url}
        </a>
      )}
      {error && <p className="text-xs font-bold text-[var(--risk-text,#b42318)]">{error}</p>}
    </div>
  );
}
