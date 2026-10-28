const DOCUMENTS_PATH = "/dokumenter";

export type DocumentLinkState = {
  folderId?: string | null;
  searchQuery?: string | null;
  tagFilter?: string | null;
  /** Når satt, skal søk og tag-filter bare gjelde den valgte mappen. */
  onlyFolder?: boolean;
};

function documentsHref(params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${DOCUMENTS_PATH}?${qs}` : DOCUMENTS_PATH;
}

function addScope(params: URLSearchParams, onlyFolder?: boolean) {
  if (onlyFolder) params.set("scope", "folder");
}

/** Nullstiller tekstsøk og tag-filter, men beholder mappe-konteksten. */
export function resetHref(folderId: string | null, onlyFolder = false) {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  addScope(params, onlyFolder);
  return documentsHref(params);
}

/** Slår en tag av eller på, og beholder mappe, søk og søkeomfang. */
export function toggleTagHref(tagName: string, state: DocumentLinkState) {
  const { folderId, searchQuery, tagFilter, onlyFolder } = state;
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (searchQuery) params.set("q", searchQuery);
  addScope(params, onlyFolder);
  if (tagName && tagFilter !== tagName) params.set("tag", tagName);
  return documentsHref(params);
}
