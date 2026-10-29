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
 * `Content-Disposition` for filer som skal lastes ned, aldri vises inline.
 *
 * PDF-er kan inneholde aktivt innhold (JavaScript/lenker), og skal derfor ikke
 * få kjøre i nettleserens PDF-viser på appens domene. Filnavnet saniteres mot
 * anførselstegn, skråstreker og kontrolltegn, og det legges ved en RFC 5987-
 * variant for tegn utenfor ASCII.
 */
export function attachmentDisposition(fileName: string): string {
  const basename = (fileName.split(/[\\/]/).pop() || "fil").trim() || "fil";
  const fallback =
    basename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "fil";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(basename)}`;
}
