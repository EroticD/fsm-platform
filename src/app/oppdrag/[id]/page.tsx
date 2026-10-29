import { Fragment } from "react";
import { redirect } from "next/navigation";
import { WorkStatus } from "@prisma/client";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import TagSelector from "@/components/TagSelector";
import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import MarkdownView from "@/components/MarkdownView";
import WorkOrderAttachments from "@/components/WorkOrderAttachments";
import ReportSubmissionCleanup from "@/components/ReportSubmissionCleanup";
import SubmitButton from "@/components/SubmitButton";
import { needsComment, parseImageUrls, readLineComment } from "@/lib/report-answers";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffForDepartment, workOrderScope } from "@/lib/access";
import { statusSelectOptions } from "@/lib/work-order-status";
import {
  addContactToCustomer,
  assignTechnician,
  cloneWorkOrder,
  deleteWorkOrder,
  setContact,
  setReportLegalHold,
  setReportLock,
  setTags,
  setTemplate,
  setWorkOrderLegalHold,
  unassignTechnician,
  updateStatus,
} from "./actions";
import StatusBadge from "@/components/StatusBadge";
import { formatDateLocalized } from "@/lib/dates";
import {
  reportAcknowledgement,
  reportDisplayName,
  reportUnitSummary,
} from "@/lib/report-display";
import {
  HMS_TYPE_MESSAGE_KEYS,
  isHmsTemplate,
  splitTemplatesByCategory,
} from "@/lib/template-categories";
import { verifiedSubmittedTemplateId } from "@/lib/report-submission";

type ReportField = {
  id: string;
  type?: string;
  label?: string;
  options?: string[];
  commentOptions?: string[];
};

type ReportUnitView = {
  id: string;
  label: string;
  serialNumber: string | null;
  location: string | null;
  status: string;
  answersJson: string;
  comment: string | null;
};

async function ReportContent({ report, template }: { report: any; template: any }) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  let reportStatus = "UKJENT";
  let parsedAnswers: Record<string, unknown> = {};

  if (report?.dataJson) {
    try {
      const parsed = JSON.parse(report.dataJson);
      reportStatus = parsed.status || "UKJENT";
      parsedAnswers = parsed.answers || {};
    } catch {}
  }

  let fields: ReportField[] = [];
  // Bruk øyeblikksbildet fra da rapporten ble signert, med den levende malen
  // som fallback for eldre rapporter.
  const fieldsSource = report?.templateSnapshotJson ?? template?.fieldsJson;
  if (fieldsSource) {
    try {
      const parsed = JSON.parse(fieldsSource);
      if (Array.isArray(parsed)) fields = parsed;
    } catch {}
  }

  const units: ReportUnitView[] = report?.units ?? [];
  const summary = reportUnitSummary(report ?? {});
  const acknowledgement = reportAcknowledgement(report ?? {});
  // Rapporter uten enheter lagrer svarene på én anonym rad. Den raden skal
  // vises som vanlige sjekkpunkter, ikke som et enhetskort.
  const anonymousUnit = !summary.usesUnits ? units[0] : undefined;
  let anonymousAnswers: Record<string, unknown> = parsedAnswers;
  if (anonymousUnit) {
    try {
      const parsed = JSON.parse(anonymousUnit.answersJson || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        anonymousAnswers = parsed as Record<string, unknown>;
      }
    } catch {}
  }

  // Viser svaret på ett sjekkpunkt. Brukes både for enheter og for eldre rapporter.
  const renderAnswer = (field: ReportField, answer: unknown) => {
    if (field.type === "CHECKBOX") {
      return (
        <span className={answer ? "text-green-700 font-black" : "text-gray-500 font-bold"}>
          {answer ? t("orders.detail.report.yesDone") : t("orders.detail.report.noUnchecked")}
        </span>
      );
    }
    if (field.type === "STATUS") {
      return answer ? (
        <span className={needsComment(field, answer) ? "text-red-800 font-black" : "text-green-800 font-black"}>
          {String(answer)}
        </span>
      ) : (
        <span className="text-gray-600">{t("orders.detail.report.notAssessed")}</span>
      );
    }
    if (field.type === "SIGNATURE") {
      return (
        <span className="text-blue-800 font-black bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block">
          ✍️ {answer ? t("orders.detail.report.signedBy", { name: String(answer) }) : t("orders.detail.report.notSigned")}
        </span>
      );
    }
    if (field.type === "IMAGE") {
      const urls = parseImageUrls(answer);
      if (urls.length === 0) return <span className="text-gray-600">{t("orders.detail.report.notAttached")}</span>;
      return (
        <span className="flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={t("orders.detail.report.attachmentAlt", { number: index + 1 })}
                className="h-20 w-20 object-cover rounded-lg border-2 border-gray-200 bg-white hover:border-blue-400 transition"
              />
            </a>
          ))}
        </span>
      );
    }
    return (
      <span className="text-gray-900 font-medium italic">
        {answer !== undefined && answer !== "" ? `"${String(answer)}"` : <span className="text-gray-600">{t("orders.detail.report.notAnswered")}</span>}
      </span>
    );
  };

  /** Én linje i rapporten: sjekkpunktet, svaret og eventuell kommentar til linjen. */
  const fieldRow = (field: ReportField, answers: Record<string, unknown>, key: string) => {
    const comment = readLineComment(answers, field.id);
    const alert = needsComment(field, answers[field.id]);
    const answer = answers[field.id];
    // Fritekstsvar kan inneholde Markdown, og vises derfor som eget avsnitt.
    const longText =
      field.type === "TEXTAREA" || field.type === "TEXT" || !field.type || field.type === undefined;

    return (
      <div key={key} className="text-sm">
        <div className={alert ? "text-red-800 font-bold" : undefined}>
          <span className="font-bold text-gray-900">{field.label}: </span>
          {!longText && renderAnswer(field, answer)}
        </div>
        {longText && (
          <div className="mt-1 pl-2 border-l-2 border-gray-200 text-gray-800">
            {typeof answer === "string" && answer.trim() ? (
              <MarkdownView value={answer} />
            ) : (
              <span className="text-gray-600 font-medium">{t("orders.detail.report.notAnswered")}</span>
            )}
          </div>
        )}
        {comment && (
          <div className="flex gap-1.5 text-[13px] text-amber-900 bg-amber-50 border-l-4 border-amber-300 pl-2 py-1 mt-1 rounded-r">
            <span aria-hidden>💬</span>
            <div className="flex-1">
              <MarkdownView value={comment} size="xs" />
            </div>
          </div>
        )}
      </div>
    );
  };

  const signatureBlock = (label: string, url?: string | null, name?: string | null) => {
    if (!url && !name) return null;
    return (
      <div className="bg-gray-50 p-3 rounded-xl border-2 border-gray-200">
        <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-1">{label}</p>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-20 bg-white border border-gray-200 rounded" />
        )}
        <p className="text-sm font-bold text-gray-900 mt-1">{name || t("orders.detail.report.noName")}</p>
      </div>
    );
  };

  const technicianSignature = signatureBlock(t("orders.detail.report.technicianSignature"), report?.technicianSignatureUrl, report?.technicianName);
  const customerSignature = signatureBlock(t("orders.detail.report.customerSignature"), report?.customerSignatureUrl, report?.customerName);

  return (
    <div className="bg-white p-4 rounded-lg border-2 border-gray-200 shadow-sm text-sm space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {report?.reportNumber && (
          <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-black tracking-wide text-gray-700">
            {t("orders.detail.report.reportNumber", {
              number: report.reportNumber,
            })}
          </span>
        )}
        {summary.usesUnits && (
          <>
            <span className="text-gray-500 font-black uppercase text-xs tracking-wider">{t("orders.detail.report.mainResult")}</span>
            <span className={`font-bold px-3 py-1 rounded-full text-xs ${reportStatus === "GODKJENT" ? "bg-green-100 text-green-800 border border-green-200" : "bg-red-100 text-red-800 border border-red-200"}`}>
              {reportStatus === "GODKJENT" ? t("orders.detail.report.approved") : t("orders.detail.report.deviation")}
            </span>
          </>
        )}
        {report?.legalHold && (
          <span className="rounded-full border border-red-300 bg-red-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-red-900">
            🔒 {t("orders.detail.legalHoldBadge")}
          </span>
        )}
        {acknowledgement.acknowledged && (
          <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-bold text-green-800">
            ✓ {t("orders.detail.report.customerAcknowledged", { date: formatDateLocalized(acknowledgement.at, locale) })}
          </span>
        )}
      </div>

      {acknowledgement.acknowledged && acknowledgement.comment && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          <p className="text-xs font-black uppercase tracking-wider text-green-700">
            {t("orders.detail.report.customerAcknowledgementComment")}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{acknowledgement.comment}</p>
          {acknowledgement.by && (
            <p className="mt-1 text-[11px] text-green-700">{acknowledgement.by}</p>
          )}
        </div>
      )}

      {/* ENHETER */}
      {summary.usesUnits && units.length > 0 && (
        <div className="border-t-2 border-gray-200 pt-3 mt-3 space-y-3">
          <p className="text-xs font-black text-gray-600 uppercase tracking-wider">
            {t("orders.detail.report.unitsChecked", { count: units.length })}
          </p>

          {units.map((unit, index: number) => {
            let answers: Record<string, unknown> = {};
            try {
              answers = JSON.parse(unit.answersJson || "{}");
            } catch {}

            return (
              <div key={unit.id} className="border-2 border-gray-200 rounded-xl overflow-hidden">
                <div className="flex flex-wrap justify-between items-center gap-2 bg-gray-50 px-3 py-2 border-b-2 border-gray-200">
                  <div>
                    <p className="font-black text-gray-900 text-sm">{index + 1}. {unit.label}</p>
                    <p className="text-[11px] text-gray-500">
                      {unit.serialNumber ? t("orders.detail.report.serialNumber", { number: unit.serialNumber }) : t("orders.detail.report.noSerialNumber")}
                      {unit.location ? ` • ${unit.location}` : ""}
                    </p>
                  </div>
                  <span className={`font-bold px-3 py-1 rounded-full text-[11px] border ${unit.status === "AVVIK" ? "bg-red-100 text-red-800 border-red-200" : "bg-green-100 text-green-800 border-green-200"}`}>
                    {unit.status === "AVVIK" ? t("orders.detail.report.deviationShort") : t("orders.detail.report.approvedShort")}
                  </span>
                </div>

                {fields.length > 0 && (
                  <div className="p-3 space-y-2 bg-white">
                    {fields.map((field) => fieldRow(field, answers, field.id))}
                  </div>
                )}

                {unit.comment && (
                  <div className="text-sm text-gray-900 bg-gray-50 px-3 py-2 border-t-2 border-gray-200 italic">
                    <MarkdownView value={unit.comment} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* SJEKKPUNKTER (rapporter uten enheter, eller eldre rapporter) */}
      {!summary.usesUnits && fields.length > 0 && (
        <div className="border-t-2 border-gray-200 pt-3 mt-3 space-y-2">
          <p className="text-xs font-black text-gray-600 uppercase tracking-wider">{t("orders.detail.report.answersTitle")}</p>
          <div className="bg-gray-50 p-3 rounded-xl space-y-2 border-2 border-gray-200">
            {fields.map((field) => fieldRow(field, anonymousAnswers, field.id))}
          </div>
          {anonymousUnit?.comment && (
            <div className="bg-gray-50 px-3 py-2 rounded-xl border-2 border-gray-200 text-sm italic">
              <MarkdownView value={anonymousUnit.comment} />
            </div>
          )}
        </div>
      )}

      {summary.usesUnits && units.length === 0 && fields.length > 0 && (
        <div className="border-t-2 border-gray-200 pt-3 mt-3 space-y-2">
          <p className="text-xs font-black text-gray-600 uppercase tracking-wider">{t("orders.detail.report.answersTitle")}</p>
          <div className="bg-gray-50 p-3 rounded-xl space-y-2 border-2 border-gray-200">
            {fields.map((field) => fieldRow(field, parsedAnswers, field.id))}
          </div>
        </div>
      )}

      {/* SIGNATURER */}
      {(technicianSignature || customerSignature) && (
        <div className="border-t-2 border-gray-200 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {technicianSignature}
          {customerSignature}
        </div>
      )}

      {report?.comments && (
        <div className="border-t-2 border-gray-200 pt-3">
          <span className="text-gray-500 font-black uppercase text-xs tracking-wider block mb-1">{t("orders.detail.report.generalNotes")}</span>
          <div className="text-gray-900 bg-gray-50 p-3 rounded-lg border-2 border-gray-200 italic">
            <MarkdownView value={report.comments} />
          </div>
        </div>
      )}
    </div>
  );
}

export default async function AdminWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; reportSubmitted?: string }>;
}) {
  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;
  const { error, reportSubmitted } = await searchParams;
  const t = await getTranslations("common");
  const locale = await getLocale();

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  // Avdelingssperren gjelder også direkte lenker: en montør kan ikke åpne et
  // oppdrag som hører til en annen avdeling.
  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    include: {
      department: true,
      customer: { include: { contacts: true } },
      contact: true,
      technicians: true,
      templates: true,
      tags: true,
      reports: {
        where: { deletedAt: null },
        include: { units: { orderBy: { sortOrder: "asc" } } },
        orderBy: { createdAt: "desc" },
      },
      workComments: { orderBy: { createdAt: "desc" } },
      attachments: { orderBy: { id: "desc" } },
      product: true
    }
  });

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      entityType: "WorkOrder",
      entityId: workOrderId,
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  if (!workOrder) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("orders.detail.notFoundTitle")}</h1>
        <Link href="/" className="text-blue-700 font-bold hover:underline">{t("orders.detail.goToDashboard")}</Link>
      </div>
    );
  }

  // Kansellerte oppdrag er avsluttet og skal ikke vises til montørene.
  // Kontoret kan fortsatt åpne dem for oppfølging og historikk.
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    redirect("/oppdrag");
  }

  // Bare en faktisk låst rapport for denne malen gir kvittering og rydding.
  const reportSubmittedVerified = verifiedSubmittedTemplateId(
    reportSubmitted,
    workOrder.reports,
  );

  const isAdmin = user.role === "ADMIN";
  const isClosed =
    workOrder.status === "COMPLETED" || workOrder.status === "CANCELLED";
  const canUpdate = hasPermission(user, "workorders.update");
  // Kansellering krever workorders.edit, også når administrator gjenåpner et
  // lukket oppdrag til en annen lukket status.
  const canCancel = hasPermission(user, "workorders.edit");
  // Selve oppdraget låses først når det er fullført. En låst rapport skal
  // ikke hindre redigering av et oppdrag som fortsatt er under arbeid.
  const canEdit = canCancel && !isClosed;
  const canModify = canUpdate && !isClosed;
  const canAssign = hasPermission(user, "workorders.assign") && !isClosed;
  const canDeleteWorkOrder = hasPermission(user, "workorders.delete") && !isClosed;
  const canCreate = hasPermission(user, "workorders.create");
  const canWriteReports = hasPermission(user, "reports.write");
  const canViewReports = hasPermission(user, "reports.view");
  const canManageCustomers = hasPermission(user, "customers.manage");

  const statusLabels: Record<WorkStatus, string> = {
    OPEN: t("orders.detail.statusOpen"),
    PENDING: t("orders.detail.statusPending"),
    PLANNED: t("orders.detail.statusPlanned"),
    IN_PROGRESS: t("orders.detail.statusInProgress"),
    WAITING: t("orders.detail.statusWaiting"),
    COMPLETED: t("orders.detail.statusCompleted"),
    CANCELLED: t("orders.detail.statusCancelled"),
  };
  // Alle åpne statuser kan velges fritt, i tillegg til fullført/kansellert.
  // En låst rapport påvirker ikke valgene – den låser bare rapporten.
  // PENDING er systemets startstatus og tilbys ikke som manuelt valg.
  const allowedStatusOptions = statusSelectOptions(workOrder.status, isAdmin);
  // Kansellering er en egen, avsluttende handling med egen bekreftelse.
  const canCancelNow =
    canUpdate &&
    canCancel &&
    workOrder.status !== "CANCELLED" &&
    allowedStatusOptions.includes("CANCELLED");
  const statusOptions = allowedStatusOptions.filter(
    (status) => status !== "CANCELLED",
  );

  const allTemplates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const availableTemplates = allTemplates.filter(template => !workOrder.templates.some(wt => wt.id === template.id));
  const {
    service: serviceTemplates,
    hms: hmsTemplates,
  } = splitTemplatesByCategory(workOrder.templates);
  // Service-sjekklistene vises først, deretter HMS-dokumentasjonen, slik at
  // eksisterende serviceflyt er uendret og HMS får en tydelig seksjon.
  const orderedTemplates = [...serviceTemplates, ...hmsTemplates];
  // En rapport skal vises selv om malen er fjernet fra oppdraget. Rapporter
  // som matcher en mal vises i malblokken; resten havner i «Rapport uten mal».
  // Rapporten mappes på mal-id slik at samme rapport aldri kan vises to steder.
  const linkedTemplateIds = new Set(
    workOrder.templates.map((template) => template.id),
  );
  const reportByTemplateId = new Map<
    string,
    (typeof workOrder.reports)[number]
  >();
  const orphanReports: typeof workOrder.reports = [];
  for (const report of workOrder.reports) {
    if (report.templateId && linkedTemplateIds.has(report.templateId)) {
      reportByTemplateId.set(report.templateId, report);
    } else {
      orphanReports.push(report);
    }
  }
  const {
    service: availableServiceTemplates,
    hms: availableHmsTemplates,
  } = splitTemplatesByCategory(availableTemplates);
  const allTags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  const staffUsers = await prisma.user.findMany({
    where: staffForDepartment(workOrder.departmentId),
    orderBy: { name: 'asc' },
    take: 100,
  });
  const availableTechnicians = staffUsers.filter(u => !workOrder.technicians.some((tech) => tech.id === u.id));

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* HEADER MED REDIGERINGS-KNAPP */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-xl md:text-3xl font-black text-gray-900">{workOrder.title}</h1>
              <StatusBadge status={workOrder.status} />
              {workOrder.legalHold && (
                <span
                  className="bg-red-100 border-2 border-red-300 text-red-900 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide"
                  title={t("orders.detail.legalHoldHint")}
                >
                  🔒 {t("orders.detail.legalHoldBadge")}
                </span>
              )}
              {!workOrder.legalHold &&
                workOrder.reports.some((report) => report.legalHold) && (
                  <span
                    className="bg-red-50 border-2 border-red-300 text-red-900 px-3 py-1 rounded-full text-xs font-bold"
                    title={t("orders.detail.legalHoldReportHint")}
                  >
                    🔒 {t("orders.detail.legalHoldReportBadge")}
                  </span>
                )}
            </div>
            {/* Tags */}
            {canEdit ? (
              <form action={setTags} className="mb-3 space-y-2">
                <input type="hidden" name="workOrderId" value={workOrder.id} />
                <TagSelector
                  allTags={allTags}
                  selectedTagNames={workOrder.tags.map((tag: any) => tag.name)}
                />
                <button type="submit" className="bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-800 transition shadow-sm">
                  {t("orders.detail.saveTags")}
                </button>
              </form>
            ) : (
              workOrder.tags && workOrder.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {workOrder.tags.map((tag: any) => (
                    <span
                      key={tag.id}
                      className="text-white px-3 py-1 rounded-full text-xs font-bold shadow-sm"
                      suppressHydrationWarning
                      style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
                    >
                      🏷️ {tag.name}
                    </span>
                  ))}
                </div>
              )
            )}
            <p className="text-gray-600 font-medium">🏢{" "}
              {workOrder.customer ? (
                <Link href={`/kunder/${workOrder.customerId}`} className="hover:underline font-bold text-blue-700">{workOrder.customer.name}</Link>
              ) : (
                <span className="font-bold text-gray-800">{t("orders.detail.internalOrder")}</span>
              )}
            </p>
            <p className="text-xs text-gray-500 font-bold mt-1">{t("orders.detail.department", { name: workOrder.department.name })}</p>
            {workOrder.orderNumber && (
              <p className="text-xs text-gray-600 font-bold mt-1">
                {t("orders.detail.orderNumber")}: {workOrder.orderNumber}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && (
              <Link
                href={`/oppdrag/${workOrder.id}/rediger`}
                className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm flex items-center gap-2"
              >
                {t("orders.detail.editWorkOrder")}
              </Link>
            )}
            {canCreate && isClosed && (
              <form action={cloneWorkOrder}>
                <input type="hidden" name="workOrderId" value={workOrder.id} />
                <button
                  type="submit"
                  className="bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm"
                >
                  {t("orders.detail.cloneWorkOrder")}
                </button>
              </form>
            )}
            {isAdmin && (
              <form action={setWorkOrderLegalHold}>
                <input type="hidden" name="workOrderId" value={workOrder.id} />
                <input
                  type="hidden"
                  name="hold"
                  value={workOrder.legalHold ? "false" : "true"}
                />
                {workOrder.legalHold && (
                  <input
                    type="text"
                    name="reason"
                    required
                    maxLength={1000}
                    placeholder={t("orders.detail.legalHoldReleaseReason")}
                    aria-label={t("orders.detail.legalHoldReleaseReason")}
                    title={t("orders.detail.legalHoldReleaseReasonHint")}
                    className="min-w-[12rem] rounded-xl border-2 border-red-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 outline-none focus:border-red-500"
                  />
                )}
                <button
                  type="submit"
                  title={t("orders.detail.legalHoldHint")}
                  className={
                    workOrder.legalHold
                      ? "bg-red-100 border-2 border-red-300 text-red-900 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-red-200 transition shadow-sm"
                      : "bg-white border-2 border-amber-300 text-amber-900 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-amber-50 transition shadow-sm"
                  }
                >
                  {workOrder.legalHold
                    ? t("orders.detail.legalHoldDisable")
                    : t("orders.detail.legalHoldEnable")}
                </button>
              </form>
            )}
            {canDeleteWorkOrder && (
              <ConfirmSubmitForm
                action={deleteWorkOrder}
                confirmMessage={t("orders.detail.deleteConfirm", { title: workOrder.title })}
                confirmLabel={t("delete")}
                danger
              >
                <input type="hidden" name="workOrderId" value={workOrder.id} />
                <button
                  type="submit"
                  className="bg-white border-2 border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-red-50 transition shadow-sm"
                >
                  {t("orders.detail.deleteWorkOrder")}
                </button>
              </ConfirmSubmitForm>
            )}
            <Link href="/" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm">
              {t("orders.detail.back")}
            </Link>
          </div>
        </div>

        {error === "locked" && (
          <div className="bg-amber-50 border-2 border-amber-200 text-amber-900 rounded-2xl px-5 py-4 text-sm font-bold">
            {t("orders.errors.locked")}
          </div>
        )}

        {error === "ugyldig-status" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            {t("orders.errors.invalidStatus")}
          </div>
        )}

        {error === "legal-hold" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            {t("orders.errors.legalHold")}
          </div>
        )}

        {error && !["locked", "ugyldig-status", "legal-hold"].includes(error) && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            {t("orders.errors.generic")}
          </div>
        )}

        {reportSubmittedVerified && (
          <ReportSubmissionCleanup
            userId={user.id}
            workOrderId={workOrder.id}
            templateId={reportSubmittedVerified}
            verified
          />
        )}

        <div className="space-y-6">

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
                <h2 className="text-xs font-black text-gray-500 uppercase tracking-wider mb-2">{t("orders.detail.descriptionTitle")}</h2>
                {workOrder.description ? (
                  <MarkdownView value={workOrder.description} className="text-gray-900 font-medium" />
                ) : (
                  <p className="text-sm text-gray-900 font-medium">{t("orders.detail.noDescription")}</p>
                )}
              </div>

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                  <h2 className="font-black text-lg text-gray-900">{t("orders.detail.checklistsTitle")}</h2>
                </div>

                {!isClosed && workOrder.reports.some((report) => report.isLocked) && (
                  <p className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-900">
                    {t("orders.detail.checklistLockedOnly")}
                  </p>
                )}

                {workOrder.templates.length === 0 && workOrder.reports.length === 0 && (
                  <p className="text-sm text-gray-500 italic mb-4">{t("orders.detail.noChecklists")}</p>
                )}

                {workOrder.templates.length > 0 && (
                  <div className="space-y-4 mb-6">
                    {orderedTemplates.map((template, templateIndex) => {
                      const report = reportByTemplateId.get(template.id);
                      // Skjemaet kan fylles ut både fra feltportalen og herfra.
                      const fillHref = `/mine-oppdrag/${workOrder.id}/skjema/${template.id}?returnTo=${encodeURIComponent(`/oppdrag/${workOrder.id}`)}`;
                      const startsHmsSection =
                        templateIndex === serviceTemplates.length &&
                        hmsTemplates.length > 0;

                      return (
                        <Fragment key={template.id}>
                        {startsHmsSection && (
                          <div className="flex items-center gap-2 pt-2">
                            <span className="text-xs font-black text-indigo-900 uppercase tracking-wider">
                              🛡️ {t("orders.templateGroups.hms")}
                            </span>
                            <span className="h-px flex-1 bg-indigo-200" />
                          </div>
                        )}
                        <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
                          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                            <span className="font-black text-gray-900 text-base flex items-center gap-2 flex-wrap">
                              {template.title}
                              {isHmsTemplate(template) && (
                                <span
                                  className="bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-wide"
                                  title={t("orders.templateGroups.hms")}
                                >
                                  🛡️ {template.hmsType
                                    ? t(HMS_TYPE_MESSAGE_KEYS[template.hmsType])
                                    : t("orders.templateGroups.hmsBadge")}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {report ? (
                                <>
                                  <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1 rounded-full border border-green-200">{t("orders.detail.filled")}</span>
                                  {report.isLocked ? (
                                    <span className="bg-gray-800 text-white text-xs font-bold px-3 py-1 rounded-full">{t("orders.detail.locked")}</span>
                                  ) : (
                                    <span className="bg-amber-100 text-amber-900 text-xs font-bold px-3 py-1 rounded-full border border-amber-300">{t("orders.detail.unlocked")}</span>
                                  )}
                                  {canViewReports && (
                                    <>
                                      <Link
                                        href={`/rapporter/${workOrder.id}?rapport=${report.id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
                                      >
                                        {t("orders.detail.openPdf")}
                                      </Link>
                                      <Link
                                        href={`/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}`}
                                        className="bg-white border-2 border-gray-300 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-full hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
                                      >
                                        🕘 {t("orders.detail.revisions", { count: report.revision })}
                                      </Link>
                                    </>
                                  )}
                                  {canWriteReports && canModify && !report.isLocked && (
                                    <Link
                                      href={fillHref}
                                      className="bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-amber-600 transition shadow-sm whitespace-nowrap"
                                    >
                                      {t("orders.detail.fillAgain")}
                                    </Link>
                                  )}
                                  {isAdmin && (
                                    <form action={setReportLock} className="flex items-center gap-2 flex-wrap">
                                      <input type="hidden" name="workOrderId" value={workOrder.id} />
                                      <input type="hidden" name="reportId" value={report.id} />
                                      <input type="hidden" name="lock" value={report.isLocked ? "0" : "1"} />
                                      {report.isLocked && (
                                        <input
                                          type="text"
                                          name="reason"
                                          required
                                          maxLength={1000}
                                          aria-label={t("orders.detail.unlockReason")}
                                          placeholder={t("orders.detail.unlockReasonPlaceholder")}
                                          title={t("orders.detail.unlockReasonRequired")}
                                          className="border-2 border-amber-300 bg-white text-gray-900 text-xs font-medium px-3 py-1.5 rounded-full outline-none focus:border-amber-500 min-w-[12rem]"
                                        />
                                      )}
                                      <button
                                        type="submit"
                                        className={`text-xs font-bold px-3 py-1.5 rounded-full transition shadow-sm whitespace-nowrap ${
                                          report.isLocked
                                            ? "bg-white border-2 border-amber-300 text-amber-900 hover:bg-amber-50"
                                            : "bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-100"
                                        }`}
                                      >
                                        {report.isLocked ? t("orders.detail.unlockForEdit") : t("orders.detail.lockAgain")}
                                      </button>
                                    </form>
                                  )}
                                  {isAdmin && (
                                    <form action={setReportLegalHold} className="flex items-center gap-2 flex-wrap">
                                      <input type="hidden" name="workOrderId" value={workOrder.id} />
                                      <input type="hidden" name="reportId" value={report.id} />
                                      <input type="hidden" name="hold" value={report.legalHold ? "false" : "true"} />
                                      {report.legalHold && (
                                        <input
                                          type="text"
                                          name="reason"
                                          required
                                          maxLength={1000}
                                          aria-label={t("orders.detail.legalHoldReleaseReason")}
                                          placeholder={t("orders.detail.legalHoldReleaseReason")}
                                          title={t("orders.detail.legalHoldReleaseReasonHint")}
                                          className="border-2 border-red-300 bg-white text-gray-900 text-xs font-medium px-3 py-1.5 rounded-full outline-none focus:border-red-500 min-w-[12rem]"
                                        />
                                      )}
                                      <button
                                        type="submit"
                                        className={`text-xs font-bold px-3 py-1.5 rounded-full transition shadow-sm whitespace-nowrap ${
                                          report.legalHold
                                            ? "bg-red-100 border-2 border-red-300 text-red-900 hover:bg-red-200"
                                            : "bg-white border-2 border-amber-300 text-amber-900 hover:bg-amber-50"
                                        }`}
                                      >
                                        {report.legalHold
                                          ? t("orders.detail.reportLegalHoldDisable")
                                          : t("orders.detail.reportLegalHoldEnable")}
                                      </button>
                                    </form>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-3 py-1 rounded-full border border-yellow-200">{t("orders.detail.waitingFill")}</span>
                                  {canWriteReports && canModify && (
                                    <Link
                                      href={fillHref}
                                      className="bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-amber-600 transition shadow-sm whitespace-nowrap"
                                    >
                                      {t("orders.detail.fillForm")}
                                    </Link>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {report && !report.isLocked && (
                            <div className="bg-amber-50 border-2 border-amber-200 text-amber-900 text-xs font-bold rounded-xl px-3 py-2 mb-3">
                              {t("orders.detail.unlockedWarning")}
                            </div>
                          )}

                          {report ? (
                            canViewReports ? (
                              <ReportContent report={report} template={template} />
                            ) : (
                              <p className="text-xs text-gray-500 italic">
                                {t("orders.detail.reportNoAccess")}
                              </p>
                            )
                          ) : (
                            <p className="text-xs text-gray-500 italic">{t("orders.detail.waitingForm")}</p>
                          )}
                        </div>
                        </Fragment>
                      );
                    })}
                  </div>
                )}

                {orphanReports.length > 0 && (
                  <div className="space-y-4 mb-6">
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-xs font-black text-amber-900 uppercase tracking-wider">
                        {t("orders.detail.orphanReport")}
                      </span>
                      <span className="h-px flex-1 bg-amber-200" />
                    </div>
                    {orphanReports.map((report) => {
                      const summary = reportUnitSummary(report);
                      return (
                        <div
                          key={report.id}
                          className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4"
                        >
                          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                            <span className="font-black text-gray-900 text-base flex items-center gap-2 flex-wrap">
                              {reportDisplayName(
                                report,
                                t("orders.reportsPage.defaultTitle"),
                              )}
                              <span className="bg-amber-100 text-amber-900 border border-amber-200 text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                                {t("orders.detail.orphanReport")}
                              </span>
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {report.isLocked ? (
                                <span className="bg-gray-800 text-white text-xs font-bold px-3 py-1 rounded-full">
                                  {t("orders.detail.locked")}
                                </span>
                              ) : (
                                <span className="bg-amber-100 text-amber-900 text-xs font-bold px-3 py-1 rounded-full border border-amber-300">
                                  {t("orders.detail.unlocked")}
                                </span>
                              )}
                              {canViewReports && (
                                <>
                                  <Link
                                    href={`/rapporter/${workOrder.id}?rapport=${report.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
                                  >
                                    {t("orders.detail.openPdf")}
                                  </Link>
                                  <Link
                                    href={`/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}`}
                                    className="bg-white border-2 border-gray-300 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-full hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
                                  >
                                    🕘 {t("orders.detail.revisions", { count: report.revision })}
                                  </Link>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
                            {report.reportNumber && (
                              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 font-black tracking-wide text-gray-700">
                                {t("orders.detail.report.reportNumber", {
                                  number: report.reportNumber,
                                })}
                              </span>
                            )}
                            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 font-bold text-gray-700">
                              📅 {formatDateLocalized(
                                report.completedAt,
                                locale,
                                undefined,
                                t("orders.reportsPage.noDate"),
                              )}
                            </span>
                            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 font-bold text-gray-700">
                              {summary.usesUnits
                                ? t("orders.reportsPage.units", {
                                    count: summary.unitCount,
                                  })
                                : t("orders.reportsPage.noUnits")}
                            </span>
                          </div>

                          {canViewReports ? (
                            <ReportContent report={report} template={null} />
                          ) : (
                            <p className="text-xs text-gray-500 italic">
                              {t("orders.detail.reportNoAccess")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                  
                  {canEdit && availableTemplates.length > 0 && (
                    <div className="border-t-2 border-gray-200 pt-4">
                      <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-2">{t("orders.detail.requireChecklists")}</p>
                      <form action={setTemplate} className="flex gap-2 flex-wrap">
                        <input type="hidden" name="workOrderId" value={workOrder.id} />
                        <select
                          name="templateId"
                          required
                          defaultValue=""
                          className="border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white flex-1 outline-none shadow-sm min-w-[200px]"
                        >
                          <option value="" disabled>{t("orders.detail.selectTemplate")}</option>
                          {availableServiceTemplates.length > 0 && (
                            <optgroup label={t("orders.templateGroups.service")}>
                              {availableServiceTemplates.map((template) => (
                                <option key={template.id} value={template.id}>{template.title}</option>
                              ))}
                            </optgroup>
                          )}
                          {availableHmsTemplates.length > 0 && (
                            <optgroup label={`🛡️ ${t("orders.templateGroups.hms")}`}>
                              {availableHmsTemplates.map((template) => (
                                <option key={template.id} value={template.id}>{template.title}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <button type="submit" className="bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap">
                          {t("orders.detail.addTemplate")}
                        </button>
                      </form>
                    </div>
                  )}
                </div>

              {/* Kommentarer */}
              <CommentSection
                entityType="workOrder"
                entityId={workOrderId}
                existingComments={workOrder.workComments?.map(c => ({
                  id: c.id,
                  content: c.content,
                  authorName: c.authorName,
                  createdAt: c.createdAt.toISOString(),
                })) || []}
                currentUserName={user?.name || null}
                canWrite={canUpdate}
              />

            </div>

            <div className="space-y-6">

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
                <h2 className="font-black text-gray-900 mb-3 border-b pb-2">{t("orders.detail.changeStatus")}</h2>
                {isClosed && (
                  <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                    {t("orders.detail.closedLocked")}
                  </p>
                )}
                {canUpdate && (!isClosed || isAdmin) ? (
                  <>
                    {/*
                      Uten en egen klientkomponent kan vi ikke lese select-verdien
                      i React. CSS-en bytter derfor mellom en deaktivert knapp
                      (gjeldende status valgt) og den aktive knappen (ny status
                      valgt). Dagens status er dessuten disabled og kan ikke
                      velges på nytt.
                    */}
                    <style>{`
                      .status-form .status-submit-ready { display: none; }
                      .status-form:has(select[name="status"] option:checked:not([value="${workOrder.status}"])) .status-submit-disabled { display: none; }
                      .status-form:has(select[name="status"] option:checked:not([value="${workOrder.status}"])) .status-submit-ready { display: inline-block; }
                    `}</style>
                    <ConfirmSubmitForm
                      action={updateStatus}
                      confirmMessage={t("orders.detail.completeConfirm")}
                      confirmWhenField="status"
                      confirmWhenValue="COMPLETED"
                      className="status-form flex flex-col gap-3"
                    >
                      <input type="hidden" name="workOrderId" value={workOrder.id} />
                      <select
                        name="status"
                        defaultValue={workOrder.status}
                        className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none shadow-sm"
                      >
                        <option value={workOrder.status} disabled>
                          {statusLabels[workOrder.status]} ({t("orders.detail.currentStatus")})
                        </option>
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {statusLabels[status]}
                          </option>
                        ))}
                      </select>
                      {isAdmin && isClosed && (
                        <label className="text-xs font-bold text-gray-600">
                          {t("orders.detail.reopenReason")}
                          <textarea
                            name="reason"
                            rows={2}
                            maxLength={1000}
                            required={isClosed}
                            placeholder={t("orders.detail.reopenReasonPlaceholder")}
                            className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-600"
                          />
                        </label>
                      )}
                      <SubmitButton
                        disabled
                        pendingLabel={t("orders.detail.updatingStatus")}
                        className="status-submit-disabled w-full bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap"
                      >
                        {t("orders.detail.updateStatus")}
                      </SubmitButton>
                      <SubmitButton
                        disabled={statusOptions.length === 0}
                        pendingLabel={t("orders.detail.updatingStatus")}
                        className="status-submit-ready w-full bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap"
                      >
                        {t("orders.detail.updateStatus")}
                      </SubmitButton>
                    </ConfirmSubmitForm>
                    {canCancelNow && (
                      <ConfirmSubmitForm
                        action={updateStatus}
                        confirmMessage={t("orders.detail.cancelConfirm")}
                        confirmWhenField="status"
                        confirmWhenValue="CANCELLED"
                        danger
                        className="mt-3 flex flex-col gap-2"
                      >
                        <input type="hidden" name="workOrderId" value={workOrder.id} />
                        <input type="hidden" name="status" value="CANCELLED" />
                        {isAdmin && isClosed && (
                          <label className="text-xs font-bold text-gray-600">
                            {t("orders.detail.cancelReason")}
                            <textarea
                              name="reason"
                              rows={2}
                              maxLength={1000}
                              required
                              placeholder={t("orders.detail.cancelReasonPlaceholder")}
                              className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-600"
                            />
                          </label>
                        )}
                        <SubmitButton
                          pendingLabel={t("orders.detail.updatingStatus")}
                          className="w-full border-2 border-red-200 bg-white text-red-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-red-50 transition shadow-sm whitespace-nowrap"
                        >
                          {t("orders.detail.cancelWorkOrder")}
                        </SubmitButton>
                      </ConfirmSubmitForm>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500 italic">
                    {t("orders.detail.noStatusPermission")}
                  </p>
                )}
              </div>

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 text-sm">
                <h2 className="font-black text-gray-900 mb-3 border-b pb-2">{t("orders.detail.locationTitle")}</h2>
                <div className="space-y-2 text-gray-800 mb-4">
                  <p><strong>{t("orders.detail.company")}</strong> {workOrder.customer?.name || t("orders.detail.internalOrder")}</p>
                  <p><strong>{t("orders.detail.address")}</strong>
                    <GoogleMapsLink
                      address={workOrder.address ?? workOrder.customer?.address}
                      postalCode={workOrder.postalCode ?? workOrder.customer?.postalCode}
                      city={workOrder.city ?? workOrder.customer?.city}
                    />
                  </p>
                </div>

                {workOrder.contact ? (
                  <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border-2 border-gray-200">
                    <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-1">{t("orders.detail.contact")}</p>
                    <p className="font-black text-gray-900">{workOrder.contact.name}</p>
                    <p className="text-gray-600">📞 <a href={`tel:${workOrder.contact.phone}`} className="text-blue-700 font-bold hover:underline">{workOrder.contact.phone || "-"}</a></p>
                    <p className="text-gray-600">✉️ <a href={`mailto:${workOrder.contact.email}`} className="text-blue-700 font-bold hover:underline">{workOrder.contact.email || "-"}</a></p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic">{t("orders.detail.noContact")}</p>
                )}

                {workOrder.creatorName && (
                  <p className="text-xs text-gray-500 mt-2">
                    <strong>{t("orders.detail.createdBy")}</strong> {workOrder.creatorName}
                  </p>
                )}

                {canEdit && canManageCustomers && workOrder.customer && (
                  <div className="mt-4 pt-4 border-t-2 border-gray-100 space-y-3">
                    <form action={setContact} className="flex flex-col sm:flex-row gap-2">
                      <input type="hidden" name="workOrderId" value={workOrder.id} />
                      <select
                        name="contactId"
                        defaultValue={workOrder.contactId || ""}
                        className="flex-1 min-w-0 border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
                      >
                        <option value="">{t("orders.edit.noContact")}</option>
                        {workOrder.customer.contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.role ? ` (${c.role})` : ""}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap flex-shrink-0">
                        {t("orders.detail.saveContact")}
                      </button>
                    </form>

                    <details className="rounded-xl border-2 border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-black text-blue-800 select-none">
                        {t("orders.detail.newContact")}
                      </summary>
                      <form action={addContactToCustomer} className="space-y-2 p-3 pt-1">
                        <input type="hidden" name="workOrderId" value={workOrder.id} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input required name="name" placeholder={t("orders.detail.namePlaceholder")} className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                          <input name="role" placeholder={t("orders.detail.rolePlaceholder")} className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                          <input type="email" name="email" placeholder={t("orders.detail.emailPlaceholder")} className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                          <input type="tel" name="phone" placeholder={t("orders.detail.phonePlaceholder")} className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                        </div>
                        <button type="submit" className="w-full bg-gray-900 text-white py-2 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm">
                          {t("orders.detail.addAndSelect")}
                        </button>
                      </form>
                    </details>
                  </div>
                )}
              </div>

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 text-sm">
                <h2 className="font-black text-gray-900 mb-3 border-b pb-2">{t("orders.detail.techniciansTitle")}</h2>
                {workOrder.technicians.length > 0 ? (
                  <div className="space-y-2">
                    {workOrder.technicians.map(tech => (
                      <div key={tech.id} className="bg-gray-50 p-2.5 rounded-xl font-bold text-gray-900 flex items-center gap-2 border-2 border-gray-200 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0"></span>
                        <span className="flex-1 min-w-0 truncate">{tech.name}</span>
                        {canAssign && (
                          <form action={unassignTechnician} className="flex-shrink-0">
                            <input type="hidden" name="workOrderId" value={workOrder.id} />
                            <input type="hidden" name="technicianId" value={tech.id} />
                            <button type="submit" className="text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg border border-red-200 transition whitespace-nowrap">
                              {t("orders.detail.remove")}
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-red-600 font-bold">{t("orders.detail.noTechnicians")}</p>
                )}

                {canAssign && availableTechnicians.length > 0 && (
                  <form action={assignTechnician} className="flex flex-col sm:flex-row gap-2 mt-4 border-t-2 border-gray-100 pt-4">
                    <input type="hidden" name="workOrderId" value={workOrder.id} />
                    <select
                      name="technicianId"
                      required
                      defaultValue=""
                      className="flex-1 min-w-0 border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
                    >
                      <option value="" disabled>{t("orders.detail.selectTechnician")}</option>
                      {availableTechnicians.map((tech) => (
                        <option key={tech.id} value={tech.id}>
                          {tech.name} ({tech.role === 'ADMIN' ? t("orders.detail.roleAdmin") : tech.role === 'OFFICE' ? t("orders.detail.roleOffice") : t("orders.detail.roleTechnician")})
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap flex-shrink-0">
                      {t("orders.detail.addTechnician")}
                    </button>
                  </form>
                )}
              </div>

              <WorkOrderAttachments
                workOrderId={workOrderId}
                attachments={workOrder.attachments.map((a) => ({
                  id: a.id,
                  fileName: a.fileName,
                  dataUrl: a.dataUrl,
                }))}
                canUpload={canModify}
                canDelete={isAdmin && !isClosed}
              />

            </div>
          </div>


          {/* Audit log - full width bottom */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
            <h2 className="font-black text-gray-900 mb-3 border-b pb-2">{t("orders.detail.auditLog")}</h2>
            <AuditLogTable logs={auditLogs} />
          </div>

        </div>

      </div>
    </div>
  );
}
