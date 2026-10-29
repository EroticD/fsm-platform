import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import ReportForm, { type CustomerUnit, type InitialReport } from "./ReportForm";
import { type TemplateField } from "./FieldInput";
import ErrorBanner from "@/components/ErrorBanner";
import { parseJsonObject, REPORT_STATUS_APPROVED, REPORT_STATUS_DEVIATION, REPORT_STATUS_UNASSESSED } from "@/lib/report-answers";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";

/**
 * Brødsmulesti for skjemaet. Den peker alltid til oppdraget – ikke til
 * `/skjema`, som er en mellomnivå-URL uten egen side.
 */
function FormBreadcrumb({
  workOrderId,
  workOrderTitle,
  templateTitle,
  workOrdersLabel,
  breadcrumbLabel,
}: {
  workOrderId: string;
  workOrderTitle: string;
  templateTitle: string;
  workOrdersLabel: string;
  breadcrumbLabel: string;
}) {
  return (
    <nav
      aria-label={breadcrumbLabel}
      className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-paper/60"
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Link
          href="/mine-oppdrag"
          className="rounded font-medium transition hover:text-paper hover:underline"
        >
          {workOrdersLabel}
        </Link>
        <span aria-hidden className="text-paper/30">/</span>
      </span>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        <Link
          href={`/mine-oppdrag/${workOrderId}`}
          className="max-w-[14rem] truncate rounded font-medium transition hover:text-paper hover:underline"
        >
          {workOrderTitle}
        </Link>
        <span aria-hidden className="text-paper/30">/</span>
      </span>
      <span
        aria-current="page"
        className="max-w-full truncate font-semibold text-paper"
      >
        {templateTitle}
      </span>
    </nav>
  );
}

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
      <div className="field-app min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <div className="field-sheet w-full max-w-lg p-6 text-left shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
          <h1 className="text-xl font-black text-ink mb-2">{t("orders.fieldFormPage.loadErrorTitle")}</h1>
          <p className="text-muted mb-6">{t("orders.fieldFormPage.loadErrorText")}</p>
          <Link href={`/mine-oppdrag/${workOrderId}`} className="inline-flex min-h-11 items-center rounded-xl bg-signal px-6 py-3 font-black text-ink">
            {t("orders.fieldFormPage.backToWorkOrder")}
          </Link>
        </div>
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
      <div className="field-app min-h-screen p-4 pb-32 sm:p-6 md:p-8">
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="field-hero p-5 shadow-[0_24px_70px_rgba(0,0,0,0.35)] sm:p-6">
            <FormBreadcrumb
              workOrderId={workOrderId}
              workOrderTitle={workOrder.title}
              templateTitle={template.title}
              workOrdersLabel={t("nav.myWorkOrders")}
              breadcrumbLabel={t("components.header.breadcrumb")}
            />
            <h1 className="text-2xl font-black text-paper">{template.title}</h1>
            <p className="text-sm text-paper/70 mt-1">
              {t("orders.fieldFormPage.workOrderFor", {
                title: workOrder.title,
                customer: workOrder.customer?.name || t("orders.fieldFormPage.noCustomer"),
              })}
            </p>
          </div>

          <ErrorBanner
            message={error === "locked" ? t("orders.reportForm.errorLocked") : undefined}
          />

          <div className="field-sheet p-6 space-y-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
            <h2 className="text-lg font-black text-warning">{t("orders.fieldFormPage.lockedTitle")}</h2>
            <p className="text-sm text-muted">
              {t("orders.fieldFormPage.lockedText")}
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link
                href={`/rapporter/${workOrderId}`}
                className="inline-flex min-h-11 items-center bg-signal text-ink px-5 py-2.5 rounded-xl text-sm font-black hover:brightness-95 transition shadow-sm"
              >
                {t("orders.fieldFormPage.openPdf")}
              </Link>
              <Link
                href={returnTo}
                className="inline-flex min-h-11 items-center bg-white border-2 border-line text-ink px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-white/50 transition shadow-sm"
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
          status:
            unit.status === REPORT_STATUS_DEVIATION
              ? REPORT_STATUS_DEVIATION
              : unit.status === REPORT_STATUS_APPROVED
                ? REPORT_STATUS_APPROVED
                // Ukjente/eldre verdier skal ikke bli en stille godkjenning.
                : REPORT_STATUS_UNASSESSED,
          comment: unit.comment ?? "",
          answers: parseJsonObject(unit.answersJson),
        })),
      }
    : undefined;

  return (
    <div className="field-app min-h-screen p-4 pb-40 sm:p-6 md:p-8 sm:pb-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="field-hero p-5 shadow-[0_24px_70px_rgba(0,0,0,0.35)] sm:p-6">
          <FormBreadcrumb
            workOrderId={workOrderId}
            workOrderTitle={workOrder.title}
            templateTitle={template.title}
            workOrdersLabel={t("nav.myWorkOrders")}
            breadcrumbLabel={t("components.header.breadcrumb")}
          />
          <h1 className="text-2xl font-black text-paper">{template.title}</h1>
          <p className="text-sm text-paper/70 mt-1">
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
          workOrderStatus={workOrder.status}
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
