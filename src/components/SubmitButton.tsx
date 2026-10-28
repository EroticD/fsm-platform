"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Felles innsendingsknapp som låser seg mens server-handlingen kjører.
 *
 * Uten dette kan en utålmodig bruker trykke to ganger og sende inn samme skjema
 * på nytt. Teksten byttes til en «lagrer …»-variant, og knappen deaktiveres.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
