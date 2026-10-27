/**
 * Lagring av nylige søk i localStorage.
 *
 * Bare selve søkestrengen lagres. Resultater, kundenavn og annen
 * person-/kundedata skal aldri skrives til nettleseren fra hurtigsøket.
 */

export const RECENT_SEARCH_STORAGE_KEY = "fsm:recent-searches";
export const MAX_RECENT_SEARCHES = 8;
export const MIN_RECENT_SEARCH_LENGTH = 2;
export const MAX_RECENT_SEARCH_LENGTH = 100;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Renser en søkestreng før den lagres. */
export function normalizeRecentSearch(query: string | null | undefined): string {
  return String(query ?? "").trim().replace(/\s+/g, " ");
}

function isValidRecentSearch(query: string): boolean {
  return (
    query.length >= MIN_RECENT_SEARCH_LENGTH &&
    query.length <= MAX_RECENT_SEARCH_LENGTH
  );
}

/**
 * Leser en lagret JSON-liste trygt. Ugyldig JSON, feil typer og duplikater
 * ignoreres, og listen begrenses til `MAX_RECENT_SEARCHES`.
 */
export function parseRecentSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const query = normalizeRecentSearch(entry);
    if (!isValidRecentSearch(query)) continue;

    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
    if (out.length >= MAX_RECENT_SEARCHES) break;
  }
  return out;
}

/**
 * Legger et nytt søk først. Samme søk (uten hensyn til store/små bokstaver)
 * flyttes til toppen i stedet for å dupliseres.
 */
export function addRecentSearch(
  recent: readonly string[],
  query: string | null | undefined,
): string[] {
  const normalized = normalizeRecentSearch(query);
  if (!isValidRecentSearch(normalized)) return [...recent].slice(0, MAX_RECENT_SEARCHES);

  const key = normalized.toLowerCase();
  const rest = recent.filter((entry) => entry.toLowerCase() !== key);
  return [normalized, ...rest].slice(0, MAX_RECENT_SEARCHES);
}

export function readRecentSearches(storage?: StorageLike | null): string[] {
  const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!target) return [];
  try {
    return parseRecentSearches(target.getItem(RECENT_SEARCH_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Skriver listen. Tom liste fjerner nøkkelen helt. */
export function writeRecentSearches(
  recent: readonly string[],
  storage?: StorageLike | null,
): void {
  const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!target) return;

  const clean = recent.slice(0, MAX_RECENT_SEARCHES);
  try {
    if (clean.length === 0) {
      target.removeItem(RECENT_SEARCH_STORAGE_KEY);
    } else {
      target.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(clean));
    }
  } catch {
    // Privat modus eller full lagring: historikken gjelder bare denne visningen.
  }
}
