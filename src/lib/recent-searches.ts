/**
 * Nylige søk deles med hurtigsøket via samme localStorage-nøkkel.
 *
 * Formatet er en liste med søkestrenger. Leseren godtar også eldre/alternative
 * objekter med `query` eller `q`, slik at en fremtidig hurtigsøk-implementasjon
 * kan lagre rikere data uten å ødelegge resultatsiden.
 */

export const RECENT_SEARCHES_KEY = "fsm:recent-searches";
export const RECENT_SEARCHES_LIMIT = 8;

function entryToQuery(entry: unknown): string {
  if (typeof entry === "string") return entry.trim().slice(0, 100);
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const value = record.query ?? record.q;
    return typeof value === "string" ? value.trim().slice(0, 100) : "";
  }
  return "";
}

/** Leser lagrede søk trygt. Ugyldig JSON gir en tom liste. */
export function parseRecentSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of parsed) {
      const query = entryToQuery(entry);
      if (!query) continue;
      const key = query.toLocaleLowerCase("nb");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(query);
    }
    return out;
  } catch {
    return [];
  }
}

/** Legger gjeldende søk først og fjerner duplikater (uten store/små forskjeller). */
export function mergeRecentSearch(
  items: string[],
  query: string,
  limit = RECENT_SEARCHES_LIMIT,
): string[] {
  const value = String(query ?? "").trim().slice(0, 100);
  if (!value) return items.slice(0, limit);

  const seen = new Set([value.toLocaleLowerCase("nb")]);
  const out = [value];

  for (const item of items) {
    const key = item.toLocaleLowerCase("nb");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}
