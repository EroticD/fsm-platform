"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Synlig feilmelding som leses opp av skjermlesere og får fokus når den vises.
 *
 * Skjemaene våre redirecter tilbake med `?error=` etter en feil. Da er det lett
 * at brukeren bare ser skjemaet på nytt uten å få med seg hva som gikk galt.
 * Banneren har `role="alert"` og flytter fokus til seg selv, slik at både
 * skjermlesere og tastaturbrukere oppdager feilen.
 */
export default function ErrorBanner({
  message,
  id,
  className = "",
  autoFocus = true,
}: {
  message?: string | null;
  id?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const generatedId = useId();
  const bannerId = id ?? generatedId;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message || !autoFocus) return;
    ref.current?.focus();
  }, [message, autoFocus]);

  if (!message) return null;

  return (
    <div
      ref={ref}
      id={bannerId}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      tabIndex={-1}
      className={`rounded-2xl border-2 border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] px-5 py-4 text-sm font-bold text-[var(--risk-text,#b42318)] outline-none [--focus-ring:var(--risk-text,#b42318)] focus:ring-2 focus:ring-[var(--risk,#f04427)] ${className}`}
    >
      {message}
    </div>
  );
}
