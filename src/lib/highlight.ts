/**
 * Deler tekst i markørende og ikke-markørende biter for trygg utheving.
 *
 * Resultatet rendres som React-elementer (aldri `dangerouslySetInnerHTML`), så
 * søketreff kan utheves uten å tolke HTML fra database eller URL.
 */

export type HighlightSegment = {
  text: string;
  match: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function splitHighlight(text: string, query: string): HighlightSegment[] {
  if (!text) return [];

  const tokens = [
    ...new Set(
      String(query ?? "")
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);

  if (tokens.length === 0) return [{ text, match: false }];

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  const segments: HighlightSegment[] = [];

  // split() med capture-gruppe legger treffene på oddetallsindekser.
  parts.forEach((part, index) => {
    if (!part) return;
    segments.push({ text: part, match: index % 2 === 1 });
  });

  return segments.length > 0 ? segments : [{ text, match: false }];
}
