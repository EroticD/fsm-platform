/**
 * Deler opp en tekst i tekstbiter som skal vises vanlig eller uthevet.
 *
 * Hjelperen er ren og returnerer bare data, slik at UI-laget kan rendre
 * bitene som vanlig React-tekst. Den bruker samme bretting som søket
 * (lowercase, æ/ø/å og aksenter), men beholder originalteksten og dermed
 * riktig store/små bokstaver i resultatet.
 */

export type HighlightSegment = {
  /** Tekstbiten slik den skal vises. */
  text: string;
  /** Om biten matcher et søkeord. */
  match: boolean;
};

/** Brette en tekst og husk hvilken originalindeks hvert tegn kommer fra. */
function foldWithMap(text: string): { value: string; map: number[] } {
  let value = "";
  const map: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const folded = text[i]
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "o")
      .replace(/å/g, "a")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    for (const char of folded) {
      value += char;
      map.push(i);
    }
  }

  return { value, map };
}

/** Deler søket i normaliserte ord på samme måte som fritekstsøket. */
export function searchTokens(query: string | null | undefined): string[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/gu)
    .filter(Boolean);
}

/**
 * Finner sammenhengende områder i `text` som matcher ett eller flere ord i
 * `query`. Overlappende og tilstøtende treff slås sammen, slik at «årlig»
 * ikke blir flere `<mark>`-elementer etter hverandre.
 */
export function highlightSearchText(
  text: string,
  query: string | null | undefined,
): HighlightSegment[] {
  if (!text) return [];

  const tokens = searchTokens(query);
  if (tokens.length === 0) return [{ text, match: false }];

  const { value, map } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];

  for (const token of tokens) {
    let from = 0;
    while (from <= value.length - token.length) {
      const start = value.indexOf(token, from);
      if (start === -1) break;

      const end = start + token.length;
      const originalStart = map[start];
      const originalEnd = map[end - 1] + 1;
      ranges.push([originalStart, originalEnd]);
      from = start + 1;
    }
  }

  if (ranges.length === 0) return [{ text, match: false }];

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }

  return segments;
}
