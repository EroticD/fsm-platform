const DOCUMENTS_PATH = "/dokumenter";

export type DocumentLinkState = {
  folderId?: string | null;
  searchQuery?: string | null;
  tagFilter?: string | null;
  /** Når satt, skal søk og tag-filter bare gjelde den valgte mappen. */
  onlyFolder?: boolean;
  /** Når satt inne i en mappe, skal søket gjelde hele biblioteket. */
  libraryScope?: boolean;
};

function documentsHref(params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${DOCUMENTS_PATH}?${qs}` : DOCUMENTS_PATH;
}

function addScope(
  params: URLSearchParams,
  state: Pick<DocumentLinkState, "folderId" | "onlyFolder" | "libraryScope">,
) {
  if (!state.folderId) {
    if (state.onlyFolder) params.set("scope", "folder");
    return;
  }
  if (state.libraryScope) params.set("scope", "library");
  else if (state.onlyFolder) params.set("scope", "folder");
}

/** Nullstiller tekstsøk og tag-filter, men beholder mappe-konteksten. */
export function resetHref(
  folderId: string | null,
  onlyFolder = false,
  libraryScope = false,
) {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  addScope(params, { folderId, onlyFolder, libraryScope });
  return documentsHref(params);
}

/** Slår en tag av eller på, og beholder mappe, søk og søkeomfang. */
export function toggleTagHref(tagName: string, state: DocumentLinkState) {
  const { folderId, searchQuery, tagFilter, onlyFolder, libraryScope } = state;
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (searchQuery) params.set("q", searchQuery);
  addScope(params, { folderId, onlyFolder, libraryScope });
  if (tagName && tagFilter !== tagName) params.set("tag", tagName);
  return documentsHref(params);
}

/**
 * Godtar bare interne stier som «tilbake»-mål fra søket. En ekstern URL,
 * protokoll-relativ lenke eller kontrolltegn avvises.
 */
export function safeDocumentReturnTo(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 1000) return null;
  if (raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}
