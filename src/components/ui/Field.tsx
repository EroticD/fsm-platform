"use client";

import {
  createContext,
  useContext,
  useId,
  type ReactNode,
} from "react";

type FieldContextValue = {
  id: string;
  describedBy?: string;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Gir skjemakontrollen id, beskrivelse og ugyldig-status fra nærmeste Field. */
export function useFieldControl(): FieldContextValue | null {
  return useContext(FieldContext);
}

/**
 * Et merket skjemafelt med valgfri hjelpetekst og feilmelding. Kontrollen
 * (Input/Select/Textarea) kobles automatisk til label og beskrivelse via
 * useId, uten at hver side må gjenta id-ene.
 */
export default function Field({
  id,
  label,
  hint,
  error,
  className = "",
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className}>
      <label
        htmlFor={controlId}
        className="block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
      >
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-[var(--muted,#62685f)]">
          {hint}
        </p>
      )}
      <div className="mt-1.5">
        <FieldContext.Provider
          value={{ id: controlId, describedBy, invalid: Boolean(error) }}
        >
          {children}
        </FieldContext.Provider>
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-xs font-bold text-[#a92a12]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
