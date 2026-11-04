import { describe, expect, it } from "vitest";
import { pdfViewerErrorKey, pdfViewerUrls } from "./pdf-viewer";

describe("pdfViewerUrls", () => {
  it("legger på inline og download uten å miste rapport-id-en", () => {
    const urls = pdfViewerUrls("/api/rapporter/wo1/pdf?rapport=r1");

    expect(urls.inline).toBe(
      "/api/rapporter/wo1/pdf?rapport=r1&inline=1",
    );
    expect(urls.download).toBe(
      "/api/rapporter/wo1/pdf?rapport=r1&download=1",
    );
  });

  it("starter query-strengen når stien ikke har parametere", () => {
    const urls = pdfViewerUrls("/api/rapporter/revisjoner/rev1/pdf");

    expect(urls.inline).toBe(
      "/api/rapporter/revisjoner/rev1/pdf?inline=1",
    );
    expect(urls.download).toBe(
      "/api/rapporter/revisjoner/rev1/pdf?download=1",
    );
  });
});

describe("pdfViewerErrorKey", () => {
  it.each([
    [403, "orders.pdfViewer.errors.forbidden"],
    [404, "orders.pdfViewer.errors.notFound"],
    [422, "orders.pdfViewer.errors.activeContent"],
    [429, "orders.pdfViewer.errors.rateLimited"],
    [500, "orders.pdfViewer.errors.unavailable"],
    [null, "orders.pdfViewer.errors.unavailable"],
  ])("oversetter status %s til en lokalisert feilnøkkel", (status, key) => {
    expect(pdfViewerErrorKey(status)).toBe(key);
  });
});
