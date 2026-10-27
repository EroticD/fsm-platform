"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { updateTemplate } from "@/server/settings";
import { parseTemplateCategoryFilter } from "@/lib/template-category";

export async function saveTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "templates.manage")) return;

  const category = parseTemplateCategoryFilter(formData.get("category"));
  const result = await updateTemplate(user, {
    id: formData.get("id"),
    title: formData.get("title"),
    reportName: formData.get("reportName"),
    description: formData.get("description"),
    category: formData.get("category"),
    hmsType: formData.get("hmsType"),
    requiresUnits: formData.getAll("requiresUnits"),
    fieldsJson: formData.get("fieldsJson"),
  });

  if (!result.ok) return;

  redirect(
    `/innstillinger?tab=maler${category ? `&category=${category}` : ""}`,
  );
}
