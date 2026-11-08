"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { pdfViewerErrorKey } from "@/lib/pdf-viewer";

type PdfViewerError = {
  status: number | null;
  retryAfterSeconds: number | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; error: PdfViewerError };

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--ink,#101310)]";

export function PdfViewerErrorPanel({
  status,
  retryAfterSeconds,
  downloadHref,
  openHref,
  onRetry,
}: {
  status: number | null;
  retryAfterSeconds?: number | null;
  downloadHref?: string;
  openHref?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations("common");
  const messageKey = pdfViewerErrorKey(status);
  const canDownload = status !== 403 && status !== 404;
  const showRateLimitHint = status === 429;
  const showSanitizeHint = status === 422;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-0 flex-1 items-center justify-center p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-5 text-center shadow-[0_18px_50px_-38px_rgba(16,19,16,0.6)]">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[#e7b5ae] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]">
          <Icon name="alert" className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-bold text-[var(--ink,#101310)]">
          {t(messageKey)}
        </p>
        {showRateLimitHint &&
          (retryAfterSeconds ? (
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("orders.pdfViewer.errors.rateLimitedHint", {
                seconds: retryAfterSeconds,
              })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("orders.pdfViewer.errors.rateLimitedUnknown")}
            </p>
          ))}
        {showSanitizeHint && (
          <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
            {t("orders.pdfViewer.errors.activeContentHint")}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <button type="button" onClick={onRetry} className={SIGNAL_BUTTON}>
              <Icon name="sync" className="h-4 w-4 shrink-0" />
              {t("orders.pdfViewer.retry")}
            </button>
          )}
          {canDownload && downloadHref && (
            <a href={downloadHref} download className={BUTTON}>
              <Icon name="arrowRight" className="h-4 w-4 shrink-0 rotate-90" />
              {t("orders.pdfViewer.download")}
            </a>
          )}
          {canDownload && openHref && (
            <a
              href={openHref}
              target="_blank"
              rel="noopener noreferrer"
              className={BUTTON}
            >
              <Icon name="file" className="h-4 w-4 shrink-0" />
              {t("orders.pdfViewer.openInNewTab")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Viser en PDF i appen. Filen hentes med sesjonscookie som en blob, slik at
 * komponenten kan vise tydelige feil for 403/404/422/429 i stedet for å la
 * nettleseren vise råtteksten fra API-ruten. Selve PDF-en er allerede sanert
 * av ruten før den returneres med `Content-Disposition: inline`.
 */
export default function PdfViewer({
  src,
  title,
  downloadHref,
  openHref = src,
  className = "",
}: {
  src: string;
  title: string;
  downloadHref: string;
  openHref?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function load() {
      try {
        const response = await fetch(src, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/pdf" },
        });

        if (!response.ok || !alive) {
          if (!alive) return;
          const retryAfter = Number(response.headers.get("Retry-After"));
          setState({
            kind: "error",
            error: {
              status: response.status,
              retryAfterSeconds:
                Number.isFinite(retryAfter) && retryAfter > 0
                  ? Math.ceil(retryAfter)
                  : null,
            },
          });
          return;
        }

        const contentType = response.headers.get("content-type") ?? "";
        const blob = await response.blob();
        if (!alive) return;

        if (!contentType.toLowerCase().includes("application/pdf") || !blob.size) {
          setState({
            kind: "error",
            error: { status: null, retryAfterSeconds: null },
          });
          return;
        }

        const url = URL.createObjectURL(blob);
        if (!alive) {
          URL.revokeObjectURL(url);
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setState({ kind: "ready", url });
      } catch (error) {
        if ((error as Error).name === "AbortError" || !alive) return;
        setState({
          kind: "error",
          error: { status: null, retryAfterSeconds: null },
        });
      }
    }

    void load();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [src, attempt]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  if (state.kind === "error") {
    return (
      <PdfViewerErrorPanel
        status={state.error.status}
        retryAfterSeconds={state.error.retryAfterSeconds}
        downloadHref={downloadHref}
        openHref={openHref}
        onRetry={retry}
      />
    );
  }

  if (state.kind === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex min-h-0 flex-1 items-center justify-center p-4 ${className}`}
      >
        <div className="flex items-center gap-2 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 py-2 text-sm font-bold text-[var(--muted,#62685f)]">
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--line,#dedcd1)] border-t-[var(--ink,#101310)]"
          />
          {t("orders.pdfViewer.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-1.5 ${className}`}>
      <p className="rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-1.5 text-2xs text-[var(--muted,#62685f)]">
        {t("orders.pdfViewer.previewHint")}
      </p>
      <iframe
        src={state.url}
        title={t("orders.pdfViewer.iframeTitle", { title })}
        className="h-full w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-surface shadow-[0_10px_30px_-24px_rgba(16,19,16,0.5)]"
      />
    </div>
  );
}
