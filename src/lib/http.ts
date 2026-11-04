import { NextResponse } from "next/server";

/**
 * JSON-svar med person- eller kundedata skal aldri mellomlagres i nettleser,
 * proxy eller delt cache. `Vary: Cookie` gjør at en eventuell cache som likevel
 * står foran appen skiller mellom innloggede brukere.
 */
export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

export function noStoreJson<T>(body: T, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  headers.set("Vary", NO_STORE_HEADERS.Vary);
  return NextResponse.json(body, { ...init, headers });
}

/**
 * Bygger `Content-Disposition` med et trygt filnavn.
 *
 * Filnavnet saniteres mot anførselstegn, skråstreker og kontrolltegn, og det
 * legges ved en RFC 5987-variant for tegn utenfor ASCII. Selve typen
 * (`attachment`/`inline`) bestemmes av kalleren, slik at en PDF bare kan vises
 * inline etter at aktivt innhold er sanert.
 */
function contentDisposition(
  type: "attachment" | "inline",
  fileName: string,
): string {
  const basename = (fileName.split(/[\\/]/).pop() || "fil").trim() || "fil";
  const fallback =
    basename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "fil";
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(basename)}`;
}

/**
 * `Content-Disposition` for filer som skal lastes ned, aldri vises inline.
 *
 * PDF-er kan inneholde aktivt innhold (JavaScript/lenker), og skal derfor ikke
 * få kjøre i nettleserens PDF-viser på appens domene uten eksplisitt valg.
 */
export function attachmentDisposition(fileName: string): string {
  return contentDisposition("attachment", fileName);
}

/**
 * `Content-Disposition` for PDF-er som skal vises i appens eget PDF-vindu.
 *
 * Brukes bare etter at `sanitizePdfActiveContent` har godkjent filen. Standard
 * nedlastingslenke beholder `attachment` slik at en direkte URL fortsatt er et
 * trygt vedlegg.
 */
export function inlineDisposition(fileName: string): string {
  return contentDisposition("inline", fileName);
}
