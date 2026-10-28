const DOCUMENTS_PATH = "/dokumenter";

export type DocumentLinkState = {
  folderId?: string | null;
  searchQuery?: string | null;
  tagFilter?: string | null;
};

function documentsHref(params: URLSearchParams) {
  const qs = params.toString();
  return qs ? `${DOCUMENTS_PATH}?${qs}` : DOCUMENTS_PATH;
}

/** Nullstiller tekstsøk og tag-filter, men beholder mappe-konteksten. */
export function resetHref(folderId: string | null) {
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  return documentsHref(params);
}

/** Slår en tag av eller på, og beholder mappe og tekstsøk. */
export function toggleTagHref(tagName: string, state: DocumentLinkState) {
  const { folderId, searchQuery, tagFilter } = state;
  const params = new URLSearchParams();
  if (folderId) params.set("folder", folderId);
  if (searchQuery) params.set("q", searchQuery);
  if (tagName && tagFilter !== tagName) params.set("tag", tagName);
  return documentsHref(params);
}
