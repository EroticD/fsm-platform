"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Skjemawrapper som viser en tilgjengelig bekreftelsesdialog før en
 * Server Action sendes. Erstatter `window.confirm`, som blokkerer nettleseren
 * og ikke kan styles eller brukes med tastatur på en god måte.
 */
export default function ConfirmSubmitForm({
  action,
  confirmMessage,
  confirmLabel,
  danger,
  className,
  confirmWhenField,
  confirmWhenValue,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  /** Sletting og andre destruktive handlinger må sende en tydelig etikett. */
  confirmLabel?: string;
  danger?: boolean;
  className?: string;
  /**
   * Vurder om skjemaet faktisk krever bekreftelse. Brukes for handlinger der
   * bare noen valg er destruktive, f.eks. statusendring til «Kansellert».
   *
   * Feltene er serialiserbare fordi denne komponenten er en klientkomponent;
   * serverkomponenter kan ikke sende funksjoner som props.
   */
  confirmWhenField?: string;
  confirmWhenValue?: string;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const confirmed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleCancel = useCallback(() => setOpen(false), []);
  const handleConfirm = useCallback(() => {
    confirmed.current = true;
    setOpen(false);
    formRef.current?.requestSubmit();
  }, []);

  return (
    <>
      <form
        ref={formRef}
        action={action}
        className={className}
        onSubmit={(event) => {
          if (confirmed.current) {
            confirmed.current = false;
            return;
          }
          if (
            confirmWhenField &&
            confirmWhenValue &&
            new FormData(event.currentTarget).get(confirmWhenField) !==
              confirmWhenValue
          ) {
            return;
          }
          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </form>
      <ConfirmDialog
        open={open}
        title={t("components.confirm.title")}
        description={confirmMessage}
        confirmLabel={confirmLabel}
        danger={danger}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    </>
  );
}
