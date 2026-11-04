import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translate = (
      key: string,
      values?: Record<string, string | number>,
    ) => (values ? `${key} ${JSON.stringify(values)}` : key);
    return translate;
  },
}));

import PdfViewer, { PdfViewerErrorPanel } from "./PdfViewer";

const DOWNLOAD = "/api/rapporter/wo1/pdf?rapport=r1&download=1";
const INLINE = "/api/rapporter/wo1/pdf?rapport=r1&inline=1";

describe("PdfViewer", () => {
  it("viser en tilgjengelig lastetilstand før PDF-en er hentet", () => {
    const html = renderToStaticMarkup(
      createElement(PdfViewer, {
        src: INLINE,
        title: "Rapport",
        downloadHref: DOWNLOAD,
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("orders.pdfViewer.loading");
    expect(html).not.toContain("<iframe");
  });

  it("viser tydelig feil med nedlasting og ny fane ved 422", () => {
    const html = renderToStaticMarkup(
      createElement(PdfViewerErrorPanel, {
        status: 422,
        downloadHref: DOWNLOAD,
        openHref: INLINE,
        onRetry: vi.fn(),
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("orders.pdfViewer.errors.activeContent");
    expect(html).toContain("orders.pdfViewer.errors.activeContentHint");
    expect(html).toContain("rapport=r1&amp;download=1");
    expect(html).toContain("rapport=r1&amp;inline=1");
    expect(html).toContain("orders.pdfViewer.retry");
  });

  it("skjuler nedlasting når brukeren ikke har tilgang", () => {
    const html = renderToStaticMarkup(
      createElement(PdfViewerErrorPanel, {
        status: 403,
        downloadHref: DOWNLOAD,
        openHref: INLINE,
      }),
    );

    expect(html).toContain("orders.pdfViewer.errors.forbidden");
    expect(html).not.toContain("download=1");
    expect(html).not.toContain("inline=1");
  });

  it("viser ventetid ved 429", () => {
    const html = renderToStaticMarkup(
      createElement(PdfViewerErrorPanel, {
        status: 429,
        retryAfterSeconds: 12,
        downloadHref: DOWNLOAD,
      }),
    );

    expect(html).toContain("orders.pdfViewer.errors.rateLimited");
    expect(html).toContain("&quot;seconds&quot;:12");
  });
});
