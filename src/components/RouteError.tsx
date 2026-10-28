"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export type RouteErrorLabels = {
  title: string;
  description: string;
  reference: string;
  referenceMissing: string;
  copyId: string;
  copied: string;
  copyFailed: string;
  retry: string;
  back: string;
  support: string;
};

/**
 * Valgfri supportlenke. Settes som `NEXT_PUBLIC_SUPPORT_URL` (https, http,
 * mailto eller en intern /sti). Uten verdien skjules lenken helt, slik at
 * feilsiden aldri peker til et sted som ikke finnes.
 */
export function getSupportHref(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPPORT_URL?.trim();
  if (!value) return null;
  return /^(https?:\/\/|mailto:|\/(?!\/))/i.test(value) ? value : null;
}

function digestOf(error: unknown): string {
  if (error && typeof error === "object" && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.trim()) return digest.trim();
  }
  return "";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for nettlesere uten Clipboard API (for eksempel http på LAN).
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(area);
  if (!copied) throw new Error("Kopiering støttes ikke");
}

/**
 * Presentasjonskomponent for feilsider. Tar imot ferdige etiketter slik at
 * både vanlige rute-feil (med next-intl) og global-error (uten
 * layout/providers) kan bruke samme utseende og oppførsel.
 */
export default function RouteError({
  error,
  labels,
  onRetry,
  backHref = "/",
  supportHref = getSupportHref(),
  scope = "side",
  className = "",
}: {
  error: unknown;
  labels: RouteErrorLabels;
  onRetry: () => void;
  backHref?: string;
  supportHref?: string | null;
  scope?: string;
  className?: string;
}) {
  const digest = digestOf(error);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => {
    // Vis aldri tekniske feilmeldinger til brukeren. Logg dem i stedet, slik
    // at de kan feilsøkes uten å lekke detaljer i grensesnittet.
    console.error(`Ubehandlet sidefeil (${scope}):`, error);
  }, [error, scope]);

  const handleCopy = async () => {
    if (!digest) return;
    try {
      await copyText(digest);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div
      className={`flex min-h-[60vh] items-center justify-center p-4 sm:p-8 ${className}`}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-2xl text-white"
          aria-hidden="true"
        >
          ⚠️
        </div>
        <h1 className="text-2xl font-black text-gray-900">{labels.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{labels.description}</p>

        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3 text-left">
          <p className="text-[11px] font-black uppercase tracking-wider text-gray-500">
            {labels.reference}
          </p>
          {digest ? (
            <code className="mt-1 block break-all font-mono text-xs text-gray-800">
              {digest}
            </code>
          ) : (
            <p className="mt-1 text-xs text-gray-600">
              {labels.referenceMissing}
            </p>
          )}
          <button
            type="button"
            onClick={handleCopy}
            disabled={!digest}
            className="mt-2 min-h-9 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copyState === "copied" ? labels.copied : labels.copyId}
          </button>
          {copyState !== "idle" && (
            <span className="sr-only" role="status" aria-live="polite">
              {copyState === "copied" ? labels.copied : labels.copyFailed}
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            {labels.retry}
          </button>
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            {labels.back}
          </Link>
        </div>

        {supportHref && (
          <a
            href={supportHref}
            className="mt-4 inline-flex min-h-11 items-center justify-center text-sm font-bold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {labels.support}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Felles feilgrense for ruter. Henter etiketter fra `common.errors` og bruker
 * Nexts `retry` når den finnes, ellers `reset` (eldre API) eller full reload.
 */
export function LocalizedRouteError({
  error,
  reset,
  retry,
  scope,
  backHref,
  className,
}: {
  error: unknown;
  reset?: () => void;
  retry?: () => void;
  scope?: string;
  backHref?: string;
  className?: string;
}) {
  const t = useTranslations("common.errors");

  const handleRetry = () => {
    if (retry) retry();
    else if (reset) reset();
    else window.location.reload();
  };

  return (
    <RouteError
      error={error}
      onRetry={handleRetry}
      backHref={backHref}
      scope={scope}
      className={className}
      labels={{
        title: t("title"),
        description: t("description"),
        reference: t("reference"),
        referenceMissing: t("referenceMissing"),
        copyId: t("copyId"),
        copied: t("copied"),
        copyFailed: t("copyFailed"),
        retry: t("retry"),
        back: t("back"),
        support: t("support"),
      }}
    />
  );
}
