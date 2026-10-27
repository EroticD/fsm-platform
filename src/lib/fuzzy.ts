/**
 * Fuzzy-søk inspirert av fzf (CLI-verktøyet). Håndterer kapitalisering,
 * spacing, delvise treff og subsekvens-matching.
 */

/**
 * Normaliserer et søkeord eller en tekst for delstrengtreff.
 *
 * - lower case
 * - æ/ø/å brettes til ae/o/a (samme mapping som PostgreSQLs `unaccent`)
 * - aksenter fjernes (NFD + kombineringstegn)
 * - alt som ikke er Unicode-bokstaver eller tall blir ett mellomrom
 * - mellomrom trimmes og kollapses
 *
 * Den samme normaliseringen brukes ved spørringsgrensen, i JS-rangeringen og
 * (via `normalizeSearchExpression` i search-sql.ts) i databasen. Da matcher
 * «arlig-service» både «Årlig service» og «årlig service».
 */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normaliserer for substring/token-sammenligning: fjerner også mellomrom. */
export function normalize(text: string | null | undefined): string {
  return normalizeSearchText(text).replace(/\s+/g, "");
}

/** Normaliserer men BEVARER mellomrom, slik at vi kan gi bonus for ordgrenser. */
function normalizeKeepSpaces(text: string | null | undefined): string {
  return normalizeSearchText(text);
}

/** Splitter i ord. */
export function tokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-zæøå0-9]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * fzf-lignende subsekvens-scoring. Returnerer 0 hvis ikke alle tegn i query
 * finnes i rekkefølge i teksten. Ellers en score der høyere er bedre.
 */
function fzfScore(query: string, text: string): number {
  const q = normalizeKeepSpaces(query);
  const c = normalizeKeepSpaces(text);
  if (!q || !c) return 0;

  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  let firstMatch = -1;

  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      if (firstMatch === -1) firstMatch = ci;
      // Bonus for påfølgende tegn
      if (ci === lastMatch + 1) score += 15;
      // Bonus for ordgrense (start eller etter mellomrom)
      if (ci === 0 || c[ci - 1] === " ") score += 10;
      score += 1;
      lastMatch = ci;
      qi++;
    }
  }

  if (qi < q.length) return 0; // ikke alle tegn funnet

  // Bonus for kort tekst (mindre er bedre)
  score += Math.max(0, 20 - (c.length - q.length));
  // Bonus for match ved start
  if (firstMatch === 0) score += 10;

  return score;
}

/**
 * Fuzzy-match over flere felter. Returnerer 0-1 score.
 * Rekkefølge: eksakt substring > token-treff > subsekvens (fzf) > delvis.
 */
export function fuzzyScore(query: string, ...fields: (string | null | undefined)[]): number {
  const nq = normalizeSearchText(query);
  if (!nq) return 0;
  const text = fields.map((f) => normalizeSearchText(f)).join(" ");
  if (!text) return 0;

  // 1. Eksakt substring i normalisert tekst (1.0)
  if (text.includes(nq)) return 1;

  // 2. Token-basert: alle query-ord må finnes som substring (0.9)
  const qTokens = tokens(query).map(normalizeSearchText).filter(Boolean);
  if (qTokens.length > 0) {
    let matched = 0;
    for (const qt of qTokens) {
      if (text.includes(qt)) matched++;
    }
    const ratio = matched / qTokens.length;
    if (ratio === 1) return 0.9;
    if (ratio >= 0.5) return ratio * 0.7;
  }

  // 3. fzf subsekvens-scoring over hvert felt
  let bestFzf = 0;
  for (const field of fields) {
    if (!field) continue;
    const s = fzfScore(query, field);
    if (s > bestFzf) bestFzf = s;
  }
  if (bestFzf > 0) {
    // Skaler til 0.3-0.8
    const scaled = Math.min(0.8, 0.3 + bestFzf / 100);
    return scaled;
  }

  return 0;
}

/**
 * Filtrer og sorter en liste med fuzzyScore over terskel.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getFields: (item: T) => (string | null | undefined)[],
  threshold = 0.3
): { item: T; score: number }[] {
  const nq = normalize(query);
  if (!nq) return items.map((item) => ({ item, score: 1 }));
  const scored = items.map((item) => ({
    item,
    score: fuzzyScore(query, ...getFields(item)),
  }));
  return scored.filter((s) => s.score >= threshold).sort((a, b) => b.score - a.score);
}