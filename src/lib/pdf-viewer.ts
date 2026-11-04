/**
 * Små, testbare hjelpere for PDF-viseren.
 *
 * Selve tilgangs- og saneringskontrollen ligger i API-ruten. Her bygger vi bare
 * trygge URL-er og oversetter HTTP-status til en lokalisert feilmelding.
 */

function withParam(pdfPath: string, key: string, value: string): string {
  const [path, query = ""] = pdfPath.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

/**
 * `inline` brukes av det innebygde PDF-vinduet, mens `download` alltid gir et
 * vedlegg. Begge går gjennom samme tilgangs- og saneringskontroll i ruten.
 */
export function pdfViewerUrls(pdfPath: string) {
  return {
    inline: withParam(pdfPath, "inline", "1"),
    download: withParam(pdfPath, "download", "1"),
  };
}

/**
 * Oversetter statuskoden fra PDF-ruten til en i18n-nøkkel. Ukjente statuser
 * (for eksempel nettverksfeil) får en generisk «kunne ikke laste»-melding.
 */
export function pdfViewerErrorKey(status: number | null): string {
  switch (status) {
    case 403:
      return "orders.pdfViewer.errors.forbidden";
    case 404:
      return "orders.pdfViewer.errors.notFound";
    case 422:
      return "orders.pdfViewer.errors.activeContent";
    case 429:
      return "orders.pdfViewer.errors.rateLimited";
    default:
      return "orders.pdfViewer.errors.unavailable";
  }
}
