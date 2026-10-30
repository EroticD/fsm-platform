import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import Icon from "@/components/icons";
import { getTranslations } from "next-intl/server";
import PageHeader from "@/components/PageHeader";
import TemplateBuilder from "./TemplateBuilder";
import { saveTemplate } from "./actions";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { HMS_FORM_GROUPS } from "@/lib/hms";

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
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHeader
          title={t("settings.templateEditor.title")}
          subtitle={t("settings.templateEditor.subtitle")}
          icon={<Icon name="pen" className="h-5 w-5" />}
          actions={
            <Link
              href="/innstillinger?tab=maler"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("settings.templateEditor.cancel")}
            </Link>
          }
        />

        {/* DEN VISUELLE BYGGEREN */}
        <TemplateBuilder 
          initialTitle={template.title} 
          initialReportName={template.reportName ?? ""}
          initialDescription={template.description ?? ""}
          initialCategory={template.category}
          initialHmsType={template.hmsType ?? ""}
          initialRequiresUnits={template.requiresUnits}
          hmsTypes={HMS_FORM_GROUPS.map((group) => ({
            value: group.type,
            label: t(`settings.templates.hmsTypes.${group.type}`),
          }))}
          initialFieldsJson={template.fieldsJson || "[]"} 
          saveAction={saveTemplate}
          templateId={template.id}
        />

      </div>
    </div>
  );
}
