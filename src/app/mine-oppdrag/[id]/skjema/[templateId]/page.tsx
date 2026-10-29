import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import ReportForm, { type CustomerUnit, type InitialReport } from "./ReportForm";
import { type TemplateField } from "./FieldInput";
import ErrorBanner from "@/components/ErrorBanner";
import { parseJsonObject } from "@/lib/report-answers";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";

export default async function TechnicianFillFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; templateId: string }>;
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "reports.write")) redirect("/");

  const { id: workOrderId, templateId } = await params;
  const { returnTo: returnToParam, error } = await searchParams;
  const t = await getTranslations("common");

  // Skjemaet kan åpnes både fra feltportalen og fra kontorets oppdragsside.
  // Bare de to oppdragssidene godtas som returmål.
  const returnTo = [`/oppdrag/${workOrderId}`, `/mine-oppdrag/${workOrderId}`].includes(
    returnToParam || ""
  )
    ? (returnToParam as string)
    : `/mine-oppdrag/${workOrderId}`;

  // Malen må være knyttet til oppdraget, og oppdraget må være innenfor
  // brukerens avdeling. Da kan ikke en fremmed mal åpnes via URL-en.
  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      ...workOrderScope(user),
      templates: { some: { id: templateId } },
    },
    include: {
      customer: {
        include: { products: { orderBy: { model: "asc" } } },
      },
      // Oppdragets kontaktperson er standard kundenavn i signaturfeltet.
      contact: { select: { name: true } },
      templates: { where: { id: templateId } },
    },
  });

  const template = workOrder?.templates[0] ?? null;

  // Kansellerte oppdrag er lukket og skal ikke kunne fylles ut i feltportalen.
  if (workOrder?.status === "CANCELLED" && user.role === "TECHNICIAN") {
    redirect("/mine-oppdrag");
  }

  if (!workOrder || !template) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{t("orders.fieldFormPage.loadErrorTitle")}</h1>
        <p className="text-gray-500 mb-6">{t("orders.fieldFormPage.loadErrorText")}</p>
        <Link href={`/mine-oppdrag/${workOrderId}`} className="bg-blue-700 text-white px-6 py-3 rounded-xl font-bold">
          {t("orders.fieldFormPage.backToWorkOrder")}
        </Link>
      </div>
    );
  }

  // Rapporten for denne sjekklisten, hvis den allerede er fylt ut.
  const existing = await prisma.report.findFirst({
    where: { workOrderId, templateId },
    include: { units: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  // Låst rapport: skjemaet er ikke tilgjengelig før en administrator låser opp.
  if (existing?.isLocked) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border-2 border-gray-200">
            <Link href={returnTo} className="text-sm text-blue-700 font-bold hover:underline mb-4 inline-block">
              {t("orders.fieldFormPage.backToWorkOrderShort")}
            </Link>
            <h1 className="text-2xl font-black text-gray-900">{template.title}</h1>
            <p className="text-sm text-gray-600 mt-1">
              {t("orders.fieldFormPage.workOrderFor", {
                title: workOrder.title,
                customer: workOrder.customer?.name || t("orders.fieldFormPage.noCustomer"),
              })}
            </p>
          </div>

          <ErrorBanner
            message={error === "locked" ? t("orders.reportForm.errorLocked") : undefined}
          />

          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-black text-amber-900">{t("orders.fieldFormPage.lockedTitle")}</h2>
            <p className="text-sm text-amber-900">
              {t("orders.fieldFormPage.lockedText")}
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link
                href={`/rapporter/${workOrderId}`}
                className="bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm"
              >
                {t("orders.fieldFormPage.openPdf")}
              </Link>
              <Link
                href={returnTo}
                className="bg-white border-2 border-gray-200 text-gray-700 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm"
              >
                {t("orders.fieldFormPage.backToWorkOrder")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Kladd som brukeren har fått autolagret, hvis noen.
  const draft = await prisma.reportDraft.findUnique({
    where: {
      workOrderId_templateId_userId: {
        workOrderId,
        templateId,
        userId: user.id,
      },
    },
  });

  let initialDraft: InitialReport | undefined;
  if (draft) {
    try {
      initialDraft = JSON.parse(draft.dataJson) as InitialReport;
    } catch (e) {
      console.error("Kunne ikke parse kladd", e);
    }
  }

  let fields: TemplateField[] = [];
  try {
    const parsed = JSON.parse(template.fieldsJson || "[]");
    if (Array.isArray(parsed)) fields = parsed;
  } catch (e) {
    console.error("Kunne ikke parse fieldsJson", e);
  }

  const customerUnits: CustomerUnit[] = (workOrder.customer?.products ?? []).map((product) => ({
    id: product.id,
    model: product.model,
    serialNumber: product.serialNumber,
    location: product.location,
  }));

  // Er rapporten låst opp av en administrator, åpnes skjemaet med de lagrede
  // verdiene slik at rettinger blir enklest mulig.
  const initialReport: InitialReport | undefined = existing
    ? {
        notes: existing.comments ?? "",
        technicianSignatureUrl: existing.technicianSignatureUrl,
        technicianName: existing.technicianName,
        customerSignatureUrl: existing.customerSignatureUrl,
        customerName: existing.customerName,
        units: existing.units.map((unit) => ({
          productId: unit.productId ?? "",
          label: unit.label,
          serialNumber: unit.serialNumber ?? "",
          location: unit.location ?? "",
          status: unit.status === "AVVIK" ? "AVVIK" : "GODKJENT",
          comment: unit.comment ?? "",
          answers: parseJsonObject(unit.answersJson),
        })),
      }
    : undefined;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <Link href={returnTo} className="text-sm text-blue-700 font-bold hover:underline mb-4 inline-block">
            {t("orders.fieldFormPage.backToWorkOrderShort")}
          </Link>
          <h1 className="text-2xl font-black text-gray-900">{template.title}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {t("orders.fieldFormPage.workOrderFor", {
              title: workOrder.title,
              customer: workOrder.customer?.name || t("orders.fieldFormPage.noCustomer"),
            })}
          </p>
        </div>

        <ReportForm
          workOrderId={workOrderId}
          userId={user.id}
          templateId={templateId}
          fields={fields}
          customerUnits={customerUnits}
          defaultUnitId={workOrder.productId}
          requiresUnits={template.requiresUnits}
          technicianName={user.name || undefined}
          defaultCustomerName={workOrder.contact?.name ?? undefined}
          initialReport={initialReport}
          initialDraft={initialDraft}
          draftUpdatedAt={draft?.updatedAt.toISOString()}
          returnTo={returnTo}
          submitError={error}
        />
      </div>
    </div>
  );
}
