"use client";

import { useRef, useState, type ReactNode } from "react";
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
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const confirmed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

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
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          confirmed.current = true;
          setOpen(false);
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}
