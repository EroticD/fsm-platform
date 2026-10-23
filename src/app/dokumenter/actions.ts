"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  bulkCreateDocuments as bulkCreateDocumentsService,
  createDocument as createDocumentService,
  createFolder as createFolderService,
  deleteDocument as deleteDocumentService,
  deleteFolder as deleteFolderService,
  reindexDocuments as reindexDocumentsService,
  restoreDocumentVersion,
  updateDocument as updateDocumentService,
} from "@/server/documents";

const DOCUMENTS_PATH = "/dokumenter";

function invalidDocument() {
  redirect(`${DOCUMENTS_PATH}?error=ugyldig-data`);
}

export async function createFolder(parentId: string | null, formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createFolderService(actor, {
    name: formData.get("name"),
    parentId,
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument();
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function deleteFolder(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteFolderService(actor, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument();
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function restoreVersion(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await restoreDocumentVersion(actor, {
    versionId: formData.get("versionId"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument();
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function deleteDocument(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteDocumentService(actor, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    if (result.reason === "invalid") invalidDocument();
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function updateDocument(formData: FormData) {
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
    if (result.reason === "invalid") invalidDocument();
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function createDocument(formData: FormData) {
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
    if (result.reason === "invalid") invalidDocument();
    return;
  }

  revalidatePath(DOCUMENTS_PATH);
}

export async function bulkCreateDocuments(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const rawFolderId = formData.get("folderId");
  const folderId =
    typeof rawFolderId === "string" && rawFolderId.length > 0
      ? rawFolderId
      : null;

  const result = await bulkCreateDocumentsService(actor, {
    itemsJson: formData.get("items"),
    folderId,
  });
  if (!result.ok) return;

  revalidatePath(DOCUMENTS_PATH);
}

export async function reindexDocuments() {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await reindexDocumentsService(actor);
  if (!result.ok) return;

  revalidatePath(DOCUMENTS_PATH);
}
