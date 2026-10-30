"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  CONFIRM_DIALOG_DEFAULTS,
  resolveConfirmDialogConfig,
} from "@/lib/confirm-dialog";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let scrollLockDepth = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";

/** Låser body-scrollen, og teller hvor mange dialoger som er åpne samtidig. */
function lockBodyScroll() {
  if (typeof document === "undefined") return () => undefined;

  const body = document.body;
  if (scrollLockDepth === 0) {
    previousBodyOverflow = body.style.overflow;
    previousBodyPaddingRight = body.style.paddingRight;

    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      const currentPadding =
        Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
  }
  scrollLockDepth += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockDepth = Math.max(0, scrollLockDepth - 1);
    if (scrollLockDepth === 0) {
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
    }
  };
}

function getFocusable(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

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
  children,
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
  /** Ekstra valg som vises i dialogen, over knappene. */
  children?: ReactNode;
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
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Foreldre sender ofte en ny inline-callback ved hver render. Vi holder den
  // i en ref slik at fokus- og scroll-effekten bare kjører når `open` endres.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const unlockBodyScroll = lockBodyScroll();

    const focusInitial =
      cancelRef.current && !cancelRef.current.disabled
        ? cancelRef.current
        : dialog;
    focusInitial?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = getFocusable(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (active === dialogRef.current || !dialogRef.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Hold fokus inne i dialogen også når noe utenfor prøver å ta fokus
    // programmatisk. Backdroppen blokkerer mus/touch, dette dekker resten.
    const handleFocusIn = (event: FocusEvent) => {
      const currentDialog = dialogRef.current;
      if (!currentDialog) return;
      if (event.target instanceof Node && currentDialog.contains(event.target)) {
        return;
      }
      const [first] = getFocusable(currentDialog);
      (first ?? currentDialog).focus({ preventScroll: true });
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      unlockBodyScroll();
      if (
        previousActiveElement?.isConnected &&
        typeof previousActiveElement.focus === "function"
      ) {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // Begge knappene er deaktivert mens handlingen pågår. Da finnes det ingen
  // fokuserbare elementer igjen, så vi flytter fokus til selve dialogen.
  useEffect(() => {
    if (!open || !busy || !dialogRef.current) return;
    if (!dialogRef.current.contains(document.activeElement)) {
      dialogRef.current.focus({ preventScroll: true });
    }
  }, [open, busy]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-[var(--ink,#101310)]/50 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="w-full max-w-md rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 shadow-[0_18px_48px_-20px_rgba(16,19,16,0.45)] outline-none"
      >
        <h2 id={titleId} className="text-lg font-extrabold text-[var(--ink,#101310)]">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-2 text-sm text-[var(--muted,#62685f)]">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-4 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)] disabled:opacity-50"
          >
            {resolved.cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className={`min-h-11 rounded-[10px] border border-[var(--ink,#101310)] px-4 py-2 text-xs font-bold text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:shadow-[1px_1px_0_var(--ink,#101310)] disabled:opacity-50 ${
              resolved.danger
                ? "bg-[var(--risk,#f04427)]"
                : "bg-[var(--signal,#d8ff3e)]"
            }`}
          >
            {busy ? t("components.confirm.busy") : resolved.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
