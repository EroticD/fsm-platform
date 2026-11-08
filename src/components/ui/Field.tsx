"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

type FieldContextValue = {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
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
  required = false,
  className = "",
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  // Kontrollene eier sine egne props. Når barnet er ett enkelt element kan vi
  // speile `required` til `aria-required` uten å endre Input/Select/Textarea.
  const control =
    required && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-required"?: boolean }>, {
          "aria-required": true,
        })
      : children;

  return (
    <div className={className}>
      <label
        htmlFor={controlId}
        className="type-eyebrow block text-[var(--ink,#101310)]"
      >
        {label}
        {required && (
          <span
            aria-hidden="true"
            className="ml-0.5 text-[var(--risk-text,#b42318)]"
          >
            *
          </span>
        )}
      </label>
      {hint && (
        <p
          id={hintId}
          className="type-meta mt-1 text-[var(--muted,#62685f)]"
        >
          {hint}
        </p>
      )}
      <div className="mt-1.5">
        <FieldContext.Provider
          value={{
            id: controlId,
            describedBy,
            invalid: Boolean(error),
            required,
          }}
        >
          {control}
        </FieldContext.Provider>
      </div>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="type-meta mt-1 font-bold text-[var(--risk-text,#b42318)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
