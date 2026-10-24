import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import TemplateBuilder from "./TemplateBuilder";
import { saveTemplate } from "./actions";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

export default async function EditTemplatePage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "templates.manage")) redirect("/");

  const t = await getTranslations("common");
  const resolvedParams = await params;
  
  const template = await prisma.template.findUnique({
    where: { id: resolvedParams.id }
  });

  if (!template) redirect("/innstillinger?tab=maler");

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">📝 {t("settings.templateEditor.title")}</h1>
            <p className="text-gray-500 mt-1 text-sm">{t("settings.templateEditor.subtitle")}</p>
          </div>
          <Link href="/innstillinger?tab=maler" className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition shadow-sm">
            &larr; {t("settings.templateEditor.cancel")}
          </Link>
        </div>

        {/* DEN VISUELLE BYGGEREN */}
        <TemplateBuilder 
          initialTitle={template.title} 
          initialFieldsJson={template.fieldsJson || "[]"} 
          saveAction={saveTemplate}
          templateId={template.id}
        />

      </div>
    </div>
  );
}
