"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { addAttachment, removeAttachment } from "@/lib/attachment-actions";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";

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
  canUpload,
  canDelete,
}: {
  workOrderId: string;
  attachments: WorkOrderAttachment[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("common");
  const { toast } = useToast();
  const uploadId = useId();
  const uploadHintId = `${uploadId}-hint`;
  const uploadErrorId = `${uploadId}-error`;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<WorkOrderAttachment | null>(null);

  // Serveren returnerer stabile feilkoder; vis menneskelig tekst uten å endre
  // layouten. Ukjente koder vises som før.
  const describeError = (code: string | undefined, fallback: string) => {
    if (code === "legal-hold") return t("orders.attachments.legalHold");
    if (code === "workorder-locked") return t("orders.attachments.locked");
    return code || fallback;
  };

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
        body.append("workOrderId", workOrderId);

        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.fileUrl) {
          throw new Error(json.error || t("orders.attachments.uploadError"));
        }

        const attachmentData = new FormData();
        attachmentData.set("workOrderId", workOrderId);
        attachmentData.set("fileUrl", json.fileUrl);
        attachmentData.set("fileName", json.fileName || file.name);

        const result = await addAttachment(attachmentData);
        if (!result.ok) throw new Error(result.error || t("orders.attachments.saveError"));
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
          ? t("orders.attachments.uploadFailedOne", { name: failed[0] })
          : t("orders.attachments.uploadFailedMany", { count: failed.length, names: failed.join(", ") }),
      );
    }

    if (failed.length === 0) {
      toast(t("components.toast.uploaded"), "success");
    }

    router.refresh();
  };

  const handleRemove = (attachment: WorkOrderAttachment) => {
    setPendingDelete(attachment);
  };

  const confirmRemove = async () => {
    const attachment = pendingDelete;
    if (!attachment) return;
    setPendingDelete(null);

    setError("");
    setBusy(true);

    const data = new FormData();
    data.set("attachmentId", attachment.id);

    const result = await removeAttachment(data);
    if (!result.ok) {
      setError(
        describeError(result.error, t("orders.attachments.deleteError")),
      );
    } else {
      toast(t("components.toast.deleted"), "success");
    }

    setBusy(false);
    router.refresh();
  };

  return (
    <div className="office-card p-4 [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
        <h2 className="flex items-center gap-2 font-black text-[var(--ink,#101310)]">
          <Icon name="folder" className="h-5 w-5 shrink-0" strokeWidth={2} />
          {t("orders.attachments.title")}
        </h2>
        {attachments.length > 0 && (
          <span className="text-xs font-bold text-[var(--muted,#62685f)]">{t("orders.attachments.fileCount", { count: attachments.length })}</span>
        )}
      </div>

      <p className="mb-3 text-xs text-[var(--muted,#62685f)]">
        {t("orders.attachments.description")}
      </p>

      {attachments.length === 0 ? (
        <p className="mb-3 text-xs italic text-[var(--muted,#62685f)]">{t("orders.attachments.empty")}</p>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex flex-col overflow-hidden rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]">
              {isImage(attachment.dataUrl) ? (
                <a href={attachment.dataUrl} target="_blank" rel="noreferrer" className="block bg-[var(--surface,#fffdf8)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.fileName}
                    className="h-24 w-full object-cover"
                  />
                </a>
              ) : (
                <a
                  href={attachment.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-24 flex-col items-center justify-center gap-1 bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                >
                  <Icon name="file" className="h-7 w-7" />
                  <span className="text-xs font-black uppercase tracking-[0.08em]">PDF</span>
                </a>
              )}

              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <a
                  href={attachment.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={attachment.fileName}
                  className="inline-flex min-h-11 min-w-0 items-center truncate text-xs font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                >
                  {attachment.fileName}
                </a>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleRemove(attachment)}
                    disabled={busy}
                    aria-label={`${t("orders.attachments.deleteTitle")}: ${attachment.fileName}`}
                    title={t("orders.attachments.deleteTitle")}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)] transition hover:border-[var(--risk-text,#b42318)] hover:bg-[#fbe9e7] disabled:opacity-50"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canUpload && (
        <div className="space-y-2">
          <label htmlFor={uploadId} className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)]">
            {t("orders.attachments.uploadLabel")}
          </label>
          <input
            id={uploadId}
            type="file"
            capture="environment"
            accept="image/*,application/pdf,.pdf"
            multiple
            aria-describedby={`${uploadHintId}${error ? ` ${uploadErrorId}` : ""}`}
            aria-invalid={error ? true : undefined}
            onChange={handleChange}
            disabled={busy}
            className="w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2.5 text-sm text-[var(--ink,#101310)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink,#101310)] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[var(--paper,#f2efe6)] focus:border-[var(--ink,#101310)] disabled:opacity-60"
          />
          <p id={uploadHintId} className="text-xs text-[var(--muted,#62685f)]">
            {t("orders.attachments.uploadHint")}
          </p>
        </div>
      )}

      {busy && (
        <p className="mt-2 animate-pulse text-xs font-bold text-[var(--ink,#101310)]">
          {progress
            ? t("orders.attachments.uploading", { done: progress.done + 1, total: progress.total })
            : t("orders.attachments.uploadingShort")}
        </p>
      )}

      {error && <p id={uploadErrorId} role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[var(--risk-text,#b42318)]"><Icon name="alert" className="h-3.5 w-3.5 shrink-0" /> {error}</p>}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("orders.attachments.deleteTitle")}
        description={pendingDelete ? t("orders.attachments.deleteConfirm", { name: pendingDelete.fileName }) : undefined}
        confirmLabel={t("delete")}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmRemove}
        busy={busy}
      />
    </div>
  );
}
