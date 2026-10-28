"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  CONFIRM_DIALOG_DEFAULTS,
  resolveConfirmDialogConfig,
} from "@/lib/confirm-dialog";

/**
 * Tilgjengelig bekreftelsesdialog.
 *
 * Erstatter `window.confirm`, som ikke kan styles, ikke følger appens språk og
 * ikke har fokusfelle. Dialogen har `role="dialog"`, `aria-modal`, Escape for
 * avbryt, fokusfelle med Tab/Shift+Tab og returnerer fokus til utløseren.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = CONFIRM_DIALOG_DEFAULTS.danger,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("common");
  const resolved = resolveConfirmDialogConfig(
    { confirmLabel, cancelLabel, danger },
    {
      confirm: t(CONFIRM_DIALOG_DEFAULTS.confirmLabelKey),
      cancel: t(CONFIRM_DIALOG_DEFAULTS.cancelLabelKey),
    },
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));

      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? "confirm-dialog-description" : undefined}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-gray-900">
          {title}
        </h2>
        {description && (
          <p id="confirm-dialog-description" className="mt-2 text-sm text-gray-600">
            {description}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {resolved.cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
              resolved.danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {busy ? "…" : resolved.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
