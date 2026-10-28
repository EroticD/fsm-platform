"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  bulkCreateDocuments as bulkCreateDocumentsService,
  bulkDeleteDocuments as bulkDeleteDocumentsService,
  bulkMoveDocuments as bulkMoveDocumentsService,
  bulkTagDocuments as bulkTagDocumentsService,
  createDocument as createDocumentService,
  createFolder as createFolderService,
  deleteDocument as deleteDocumentService,
  deleteFolder as deleteFolderService,
  discardDocumentUploads as discardDocumentUploadsService,
  moveFolder as moveFolderService,
  reindexDocuments as reindexDocumentsService,
  renameFolder as renameFolderService,
  restoreDocument as restoreDocumentService,
  restoreDocumentVersion,
  updateDocument as updateDocumentService,
} from "@/server/documents";
import type {
  DocumentActionResult,
  DocumentBulkActionResult,
  DocumentBulkMutationActionResult,
  DocumentDiscardUploadsResult,
  DocumentFormContext,
} from "./action-types";

const DOCUMENTS_PATH = "/dokumenter";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Leser plasseringen fra skjemaet. Manglende felt gir en nøytral kontekst. */
function contextFromForm(formData: FormData): DocumentFormContext {
  const pageValue = Number.parseInt(formText(formData, "page"), 10);
  return {
    folderId: formText(formData, "folder") || null,
    searchQuery: formText(formData, "q"),
    tagFilter: formText(formData, "tag"),
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    onlyFolder: formText(formData, "scope") === "folder",
  };
}

/** Bygger en URL som beholder mappe, søk, tag, side og søkeomfang. */
function documentsHref(
  context: DocumentFormContext,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (context.folderId) params.set("folder", context.folderId);
  if (context.searchQuery) params.set("q", context.searchQuery);
  if (context.tagFilter) params.set("tag", context.tagFilter);
  if (context.onlyFolder) params.set("scope", "folder");
  if (context.page > 1) params.set("page", String(context.page));
  for (const [key, value] of Object.entries(extra ?? {})) {
    params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${DOCUMENTS_PATH}?${qs}` : DOCUMENTS_PATH;
}

function invalidDocument(formData: FormData): never {
  redirect(documentsHref(contextFromForm(formData), { error: "ugyldig-data" }));
}

export async function createFolder(
  formData: FormData,
): Promise<DocumentActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const parentId = formText(formData, "parentId") || null;
  const result = await createFolderService(actor, {
    name: formData.get("name"),
    parentId,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true };
}

export async function renameFolder(
  formData: FormData,
): Promise<DocumentActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const result = await renameFolderService(actor, {
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true };
}

export async function moveFolder(
  formData: FormData,
): Promise<DocumentActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const result = await moveFolderService(actor, {
    id: formData.get("id"),
    parentId: formData.get("parentId"),
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true };
}

export async function deleteFolder(
  formData: FormData,
): Promise<DocumentActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const result = await deleteFolderService(actor, {
    id: formData.get("id"),
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true };
}

export async function restoreVersion(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await restoreDocumentVersion(actor, {
    versionId: formData.get("versionId"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument(formData);
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteDocumentService(actor, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument(formData);
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function restoreDocument(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await restoreDocumentService(actor, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument(formData);
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function updateDocument(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await updateDocumentService(actor, {
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description"),
    folderId: formData.get("folderId"),
    fileUrl: formData.get("fileUrl"),
    fileName: formData.get("fileName"),
    fileSize: formData.get("fileSize"),
    tagNames: formData.getAll("tags"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument(formData);
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function createDocument(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createDocumentService(actor, {
    title: formData.get("title"),
    description: formData.get("description"),
    fileUrl: formData.get("fileUrl"),
    fileName: formData.get("fileName"),
    fileSize: formData.get("fileSize"),
    folderId: formData.get("folderId"),
    tagNames: formData.getAll("tags"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument(formData);
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function bulkCreateDocuments(
  formData: FormData,
): Promise<DocumentBulkActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const rawFolderId = formData.get("folderId");
  const folderId =
    typeof rawFolderId === "string" && rawFolderId.length > 0
      ? rawFolderId
      : null;

  const result = await bulkCreateDocumentsService(actor, {
    itemsJson: formData.get("items"),
    folderId,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true, ...result.data };
}

export async function bulkMoveDocuments(
  formData: FormData,
): Promise<DocumentBulkMutationActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const folderId = formText(formData, "folderId") || null;
  const result = await bulkMoveDocumentsService(actor, {
    ids: formData.getAll("ids"),
    folderId,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true, ...result.data };
}

export async function bulkDeleteDocuments(
  formData: FormData,
): Promise<DocumentBulkMutationActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const result = await bulkDeleteDocumentsService(actor, {
    ids: formData.getAll("ids"),
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true, ...result.data };
}

export async function bulkTagDocuments(
  formData: FormData,
): Promise<DocumentBulkMutationActionResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  const result = await bulkTagDocumentsService(actor, {
    ids: formData.getAll("ids"),
    tagNames: formData.getAll("tags"),
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  revalidatePath(DOCUMENTS_PATH);
  return { ok: true, ...result.data };
}

export async function discardDocumentUploads(
  formData: FormData,
): Promise<DocumentDiscardUploadsResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, reason: "forbidden" };

  let fileUrls: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(formText(formData, "urls"));
    if (Array.isArray(parsed)) fileUrls = parsed;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const result = await discardDocumentUploadsService(actor, { fileUrls });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, deleted: result.data.deleted };
}

export async function reindexDocuments(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await reindexDocumentsService(actor);
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument(formData);
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}
