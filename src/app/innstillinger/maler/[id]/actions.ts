"use server";

import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { cleanTemplateFieldsJson } from "@/lib/template-fields";
import { checkboxValue } from "@/server/settings";

export async function saveTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "templates.manage")) return;
  
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
  const reportName = cleanText(formData.get("reportName"), { maxLength: LIMITS.title }) || null;
  const requiresUnits = checkboxValue(formData.getAll("requiresUnits"), true);
  const fieldsJson = cleanTemplateFieldsJson(formData.get("fieldsJson"));

  if (!title || !id) return;

  try {
    const oldTemplate = await prisma.template.findUnique({
      where: { id },
    });
    await prisma.template.update({
      where: { id },
      data: {
        title,
        reportName,
        requiresUnits,
        fieldsJson: fieldsJson,
      },
    });
    const changes = [
      `Endret sjekkliste: ${oldTemplate?.title || title} → ${title}`,
    ];
    if ((oldTemplate?.reportName ?? null) !== reportName) {
      changes.push(
        `rapportnavn: ${oldTemplate?.reportName || "(tomt)"} → ${reportName || "(tomt)"}`,
      );
    }
    if ((oldTemplate?.requiresUnits ?? true) !== requiresUnits) {
      changes.push(`enheter: ${oldTemplate?.requiresUnits ?? true ? "ja" : "nei"} → ${requiresUnits ? "ja" : "nei"}`);
    }
    await prisma.auditLog.create({
      data: {
        entityType: "Template",
        entityId: id,
        action: changes.join(" · "),
        userName: user?.name || "Ukjent"
      }
    });
  } catch (error) {
    console.error("Feil ved lagring av mal:", error);
  }

  redirect("/innstillinger?tab=maler");
}
