/**
 * OCR-teksten til et dokument lagres i `pageTexts` som en JSON-array
 * `[{ page: number, text: string }]`. `contentText` er den samme teksten slått
 * sammen, og skrives ikke lenger av OCR-jobben – den bygges bare på nytt ved
 * eksport, fordi eldre importformat fortsatt forventer feltet.
 *
 * Funksjonene her tåler at `pageTexts` inneholder ugyldig JSON (f.eks. fra en
 * importert pakke): da faller vi tilbake til `contentText` i stedet for å kaste.
 */

/** Sidetekstene fra `pageTexts`, eller tom liste når feltet mangler/er ugyldig. */
export function pagesFromJson(pageTexts: string | null): string[] {
  if (!pageTexts) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(pageTexts);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "text" in entry) {
        const text = (entry as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .map((text) => text.trim())
    .filter((text) => text.length > 0);
}

/**
 * Hele dokumentteksten: sidene fra `pageTexts` slått sammen med tom linje
 * mellom, ellers `contentText`, ellers `null`.
 */
export function documentText(document: {
  pageTexts?: string | null;
  contentText?: string | null;
}): string | null {
  const pages = pagesFromJson(document.pageTexts ?? null);
  if (pages.length > 0) return pages.join("\n\n");

  const content = document.contentText?.trim();
  return content ? content : null;
}
