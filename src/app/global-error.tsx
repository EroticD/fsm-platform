"use client";

import "./globals.css";
import RouteError, {
  type RouteErrorLabels,
} from "@/components/RouteError";
import errorsNb from "../../messages/fragments/errors.nb.json";

const labels: RouteErrorLabels = {
  title: errorsNb.errors.global.title,
  description: errorsNb.errors.global.description,
  reference: errorsNb.errors.reference,
  referenceMissing: errorsNb.errors.referenceMissing,
  copyId: errorsNb.errors.copyId,
  copied: errorsNb.errors.copied,
  copyFailed: errorsNb.errors.copyFailed,
  retry: errorsNb.errors.retry,
  back: errorsNb.errors.back,
  support: errorsNb.errors.support,
};

/**
 * Siste skanse når rot-layouten feiler. Den kan ikke bruke layoutens
 * merkevare, providers eller next-intl, så teksten er bevisst nøytral og
 * norsk, med egne <html>/<body>-tagger.
 */
export default function GlobalError({
  error,
  reset,
  retry,
}: {
  error: unknown;
  reset?: () => void;
  retry?: () => void;
}) {
  const handleRetry = () => {
    if (retry) retry();
    else if (reset) reset();
    else window.location.reload();
  };

  return (
    <html lang="nb" className="h-full antialiased">
      <body className="office-app min-h-full [--focus-ring:var(--ink,#101310)]">
        <title>{errorsNb.errors.global.title}</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
        <main>
          <RouteError
            error={error}
            labels={labels}
            onRetry={handleRetry}
            scope="global"
          />
        </main>
      </body>
    </html>
  );
}
