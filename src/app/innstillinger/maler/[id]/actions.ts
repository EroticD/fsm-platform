"use server";

import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { isOffice } from "@/lib/session";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { cleanTemplateFieldsJson } from "@/lib/template-fields";

export async function saveTemplate(formData: FormData) {
  const session = await getServerSession();
  const email = (session as any)?.user?.email as string | undefined;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!isOffice(user?.role)) return;
  
  const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
  const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
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
        fieldsJson: fieldsJson,
      },
    });
    await prisma.auditLog.create({
      data: {
        entityType: "Template",
        entityId: id,
        action: `Endret sjekkliste: ${oldTemplate?.title || title} → ${title}`,
        userName: user?.name || "Ukjent"
      }
    });
  } catch (error) {
    console.error("Feil ved lagring av mal:", error);
  }

  redirect("/innstillinger?tab=maler");
}
