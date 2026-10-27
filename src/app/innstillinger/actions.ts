"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createDocumentTag,
  createTag,
  createTemplate,
  deleteDocumentTag,
  deleteTag,
  deleteTemplate,
  saveBranding,
  updateDocumentTag,
  updateTag,
} from "@/server/settings";

function revalidateSettings() {
  revalidatePath("/innstillinger");
}

export async function saveBrandingAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await saveBranding(actor, {
    companyName: formData.get("companyName"),
    primaryColor: formData.get("primaryColor"),
    logoUrl: formData.get("logoUrl"),
  });
  if (!result.ok) {
    if (result.reason === "invalid_logo") {
      redirect("/innstillinger?tab=merkevare&error=logo");
    }
    return;
  }

  revalidateSettings();
}

export async function createTemplateAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createTemplate(actor, {
    title: formData.get("title"),
    reportName: formData.get("reportName"),
    requiresUnits: formData.getAll("requiresUnits"),
  });
  if (!result.ok) return;

  revalidateSettings();
}

export async function deleteTemplateAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteTemplate(actor, { id: formData.get("id") });
  if (!result.ok) return;

  revalidateSettings();
}

export async function createTagAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createTag(actor, {
    name: formData.get("name"),
    color: formData.get("color"),
  });
  if (!result.ok) return;

  revalidateSettings();
}

export async function updateTagAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await updateTag(actor, {
    id: formData.get("id"),
    name: formData.get("name"),
    color: formData.get("color"),
  });
  if (!result.ok) return;

  revalidateSettings();
}

export async function deleteTagAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteTag(actor, { id: formData.get("id") });
  if (!result.ok) return;

  revalidateSettings();
}

export async function createDocumentTagAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createDocumentTag(actor, {
    name: formData.get("name"),
    color: formData.get("color"),
  });
  if (!result.ok) return;

  revalidateSettings();
}

export async function updateDocumentTagAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await updateDocumentTag(actor, {
    id: formData.get("id"),
    name: formData.get("name"),
    color: formData.get("color"),
  });
  if (!result.ok) return;

  revalidateSettings();
}

export async function deleteDocumentTagAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteDocumentTag(actor, { id: formData.get("id") });
  if (!result.ok) return;

  revalidateSettings();
}
