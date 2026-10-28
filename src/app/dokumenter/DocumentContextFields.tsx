"use client";

import type { DocumentFormContext } from "./action-types";

/**
 * Skjuler plasseringen i skjemaet. Server-handlingene bruker feltene til å
 * sende brukeren tilbake til samme mappe, søk, tag og side ved valideringsfeil.
 */
export default function DocumentContextFields({
  context,
}: {
  context: DocumentFormContext;
}) {
  return (
    <>
      {context.folderId && (
        <input type="hidden" name="folder" value={context.folderId} />
      )}
      {context.searchQuery && (
        <input type="hidden" name="q" value={context.searchQuery} />
      )}
      {context.tagFilter && (
        <input type="hidden" name="tag" value={context.tagFilter} />
      )}
      {context.onlyFolder && <input type="hidden" name="scope" value="folder" />}
      {context.page > 1 && (
        <input type="hidden" name="page" value={String(context.page)} />
      )}
    </>
  );
}

/** Samme felter for skjemaer som bygges manuelt i klientkoden. */
export function appendDocumentContext(
  formData: FormData,
  context: DocumentFormContext,
): void {
  if (context.folderId) formData.append("folder", context.folderId);
  if (context.searchQuery) formData.append("q", context.searchQuery);
  if (context.tagFilter) formData.append("tag", context.tagFilter);
  if (context.onlyFolder) formData.append("scope", "folder");
  if (context.page > 1) formData.append("page", String(context.page));
}
