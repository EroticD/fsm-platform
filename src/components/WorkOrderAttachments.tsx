"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addAttachment, removeAttachment } from "@/lib/attachment-actions";

export type WorkOrderAttachment = {
  id: string;
  fileName: string;
  dataUrl: string;
};

const IMAGE_URL = /\.(jpe?g|png|webp|gif)$/i;

function isImage(url: string) {
  return IMAGE_URL.test(url);
}

/**
 * Vedlegg på et oppdrag: bilder og PDF-er for dokumentasjon eller
 * ordrebekreftelse.
 *
 * Filene lastes opp til /api/upload først, og deretter knyttes URL-en til
 * oppdraget med en server action. Da slipper server action-en å ta imot store
 * filer, og samme opplastingsvalidering som resten av appen gjenbrukes.
 */
export default function WorkOrderAttachments({
  workOrderId,
  attachments,
  canManage,
}: {
  workOrderId: string;
  attachments: WorkOrderAttachment[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Tøm inputen med en gang, slik at samme fil kan velges på nytt senere.
    event.target.value = "";

    if (files.length === 0) return;

    setError("");
    setBusy(true);
    setProgress({ done: 0, total: files.length });

    const failed: string[] = [];

    // Last opp én og én: mobilbilder og PDF-er kan være store, og flere
    // samtidige opplastinger gjør trege nett unødvendig tunge.
    for (const [index, file] of files.entries()) {
      try {
        const body = new FormData();
        body.append("file", file);

        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.fileUrl) {
          throw new Error(json.error || "Opplasting feilet");
        }

        const attachmentData = new FormData();
        attachmentData.set("workOrderId", workOrderId);
        attachmentData.set("fileUrl", json.fileUrl);
        attachmentData.set("fileName", json.fileName || file.name);

        const result = await addAttachment(attachmentData);
        if (!result.ok) throw new Error(result.error || "Kunne ikke lagre vedlegget");
      } catch {
        failed.push(file.name);
      }
      setProgress({ done: index + 1, total: files.length });
    }

    setBusy(false);
    setProgress(null);

    if (failed.length > 0) {
      setError(
        failed.length === 1
          ? `Kunne ikke laste opp ${failed[0]}`
          : `Kunne ikke laste opp ${failed.length} filer: ${failed.join(", ")}`,
      );
    }

    router.refresh();
  };

  const handleRemove = async (attachment: WorkOrderAttachment) => {
    if (!window.confirm(`Slette vedlegget «${attachment.fileName}»?`)) return;

    setError("");
    setBusy(true);

    const data = new FormData();
    data.set("attachmentId", attachment.id);

    const result = await removeAttachment(data);
    if (!result.ok) {
      setError(result.error || "Kunne ikke slette vedlegget");
    }

    setBusy(false);
    router.refresh();
  };

  return (
    <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
      <div className="flex items-baseline justify-between gap-2 mb-3 border-b pb-2">
        <h2 className="font-black text-gray-900">📎 Vedlegg</h2>
        {attachments.length > 0 && (
          <span className="text-xs font-bold text-gray-500">{attachments.length} fil{attachments.length === 1 ? "" : "er"}</span>
        )}
      </div>

      <p className="text-xs text-gray-500 mb-3">
        Bilder og PDF-er, f.eks. ordrebekreftelse, bilder fra befaring eller annen dokumentasjon.
      </p>

      {attachments.length === 0 ? (
        <p className="text-xs text-gray-500 italic mb-3">Ingen vedlegg ennå.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="border-2 border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex flex-col">
              {isImage(attachment.dataUrl) ? (
                <a href={attachment.dataUrl} target="_blank" rel="noreferrer" className="block bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.fileName}
                    className="w-full h-24 object-cover"
                  />
                </a>
              ) : (
                <a
                  href={attachment.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="h-24 flex flex-col items-center justify-center gap-1 bg-white hover:bg-blue-50 transition"
                >
                  <span className="text-3xl">📄</span>
                  <span className="text-[10px] font-black text-blue-700 uppercase">PDF</span>
                </a>
              )}

              <div className="px-2 py-1.5 flex items-center justify-between gap-1">
                <a
                  href={attachment.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={attachment.fileName}
                  className="text-[10px] font-bold text-gray-700 hover:underline truncate"
                >
                  {attachment.fileName}
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleRemove(attachment)}
                    disabled={busy}
                    className="text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-2 py-0.5 rounded border border-red-200 transition whitespace-nowrap"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="space-y-2">
          <input
            type="file"
            accept="image/*,application/pdf,.pdf"
            multiple
            onChange={handleChange}
            disabled={busy}
            className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white outline-none focus:border-blue-700 disabled:opacity-60"
          />
          <p className="text-[11px] text-gray-500">
            Du kan velge flere filer samtidig. Maks 100 MB per fil.
          </p>
        </div>
      )}

      {busy && (
        <p className="text-[11px] font-bold text-blue-700 animate-pulse mt-2">
          Laster opp {progress ? `${progress.done + 1} av ${progress.total}` : ""} …
        </p>
      )}

      {error && <p className="text-[11px] font-bold text-red-600 mt-2">❌ {error}</p>}
    </div>
  );
}
