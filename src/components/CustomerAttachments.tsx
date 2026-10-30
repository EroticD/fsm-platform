"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiErrorMessage } from "@/lib/api-error-message";
import {
  addCustomerAttachment,
  removeCustomerAttachment,
} from "@/lib/attachment-actions";
import ConfirmDialog from "@/components/ConfirmDialog";
import Icon from "@/components/icons";
import { useToast } from "@/components/ToastProvider";

export type CustomerAttachment = {
  id: string;
  fileName: string;
  dataUrl: string;
};

const IMAGE_URL = /\.(jpe?g|png|webp|gif)$/i;

function isImage(url: string) {
  return IMAGE_URL.test(url);
}

/**
 * Vedlegg på kundekortet: avtaler, dokumentasjon, bilder og annet som hører til
 * kunden – ikke til et enkelt oppdrag. Selve filen lastes opp via /api/upload,
 * og server action-en lagrer bare navn og URL.
 */
export default function CustomerAttachments({
  customerId,
  attachments,
  canUpload,
  canDelete,
}: {
  customerId: string;
  attachments: CustomerAttachment[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("common");
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CustomerAttachment | null>(null);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) return;

    setError("");
    setBusy(true);
    setProgress({ done: 0, total: files.length });

    const failed: string[] = [];

    for (const [index, file] of files.entries()) {
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("customerId", customerId);

        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.fileUrl) {
          throw new Error(
            apiErrorMessage(json, t, t("customers.attachments.uploadFailed")),
          );
        }

        const attachmentData = new FormData();
        attachmentData.set("customerId", customerId);
        attachmentData.set("fileUrl", json.fileUrl);
        attachmentData.set("fileName", json.fileName || file.name);

        const result = await addCustomerAttachment(attachmentData);
        if (!result.ok) {
          throw new Error(
            apiErrorMessage(result, t, t("customers.attachments.saveFailed")),
          );
        }
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
          ? t("customers.attachments.uploadFailedOne", { name: failed[0] })
          : t("customers.attachments.uploadFailedMany", {
              count: failed.length,
              names: failed.join(", "),
            }),
      );
    }

    if (failed.length === 0) {
      toast(t("components.toast.uploaded"), "success");
    }

    router.refresh();
  };

  const handleRemove = (attachment: CustomerAttachment) => {
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

    const result = await removeCustomerAttachment(data);
    if (!result.ok) {
      setError(
        apiErrorMessage(result, t, t("customers.attachments.deleteFailed")),
      );
    }

    setBusy(false);
    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
        <h2 className="flex items-center gap-2 font-black text-[var(--ink,#101310)]">
          <Icon name="folder" className="h-5 w-5 shrink-0" strokeWidth={2} />
          {t("customers.attachments.title")}
        </h2>
        {attachments.length > 0 && (
          <span className="text-xs font-bold text-[var(--muted,#62685f)]">
            {t("customers.attachments.fileCount", { count: attachments.length })}
          </span>
        )}
      </div>

      <p className="mb-3 text-xs text-[var(--muted,#62685f)]">
        {t("customers.attachments.description")}
      </p>

      {attachments.length === 0 ? (
        <p className="mb-3 text-xs italic text-[var(--muted,#62685f)]">{t("customers.attachments.empty")}</p>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex flex-col overflow-hidden rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]"
            >
              {isImage(attachment.dataUrl) ? (
                <a
                  href={attachment.dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-[var(--surface,#fffdf8)]"
                >
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
                    aria-label={t("components.customerAttachments.deleteAria", {
                      name: attachment.fileName,
                    })}
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
          <input
            type="file"
            capture="environment"
            accept="image/*,application/pdf,.pdf"
            multiple
            onChange={handleChange}
            disabled={busy}
            className="w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-2.5 text-sm text-[var(--ink,#101310)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--ink,#101310)] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[var(--paper,#f2efe6)] focus:border-[var(--ink,#101310)] disabled:opacity-60"
          />
          <p className="text-xs text-[var(--muted,#62685f)]">
            {t("customers.attachments.uploadLimit")}
          </p>
        </div>
      )}

      {busy && (
        <p className="mt-2 text-xs font-bold text-[var(--ink,#101310)] animate-pulse">
          {t("customers.attachments.uploading", {
            progress: progress
              ? t("customers.attachments.uploadingProgress", {
                  done: progress.done + 1,
                  total: progress.total,
                })
              : "",
          })}
        </p>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[var(--risk-text,#b42318)]">
          <Icon name="alert" className="h-4 w-4 shrink-0" strokeWidth={2} />
          {error}
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("customers.attachments.deleteTitle")}
        description={
          pendingDelete
            ? t("customers.attachments.deleteConfirm", {
                name: pendingDelete.fileName,
              })
            : undefined
        }
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmRemove}
        busy={busy}
      />
    </div>
  );
}
