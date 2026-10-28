import { Fragment } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { WorkStatus } from "@prisma/client";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import AuditLogTable from "@/components/AuditLogTable";
import MarkdownEditor from "@/components/MarkdownEditor";
import MarkdownView from "@/components/MarkdownView";
import WorkOrderAttachments from "@/components/WorkOrderAttachments";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import CustomerToast from "@/components/customer/CustomerToast";
import ErrorBanner from "@/components/ErrorBanner";
import ReportSubmissionCleanup from "@/components/ReportSubmissionCleanup";
import SubmitButton from "@/components/SubmitButton";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffForDepartment, workOrderScope } from "@/lib/access";
import { statusSelectOptions } from "@/lib/work-order-status";
import { formatDateRange, formatDateTime } from "@/lib/dates";
import { idSchema } from "@/lib/schemas/common";
import {
  HMS_TYPE_MESSAGE_KEYS,
  isHmsTemplate,
  splitTemplatesByCategory,
} from "@/lib/template-categories";
import * as workOrderService from "@/server/work-orders";
import {
  addComment,
  addTechnician,
  addTemplate,
  updateStatus,
} from "./actions";

export default async function TechnicianWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    reportSubmitted?: string;
    removed?: string;
    restored?: string;
  }>;
}) {
  const { error, reportSubmitted, removed, restored } = await searchParams;

  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;

  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    include: {
      department: true,
      customer: {
        include: { contacts: true }
      },
      contact: true,
      templates: true,
      reports: true,
      tags: true,
      workComments: { orderBy: { createdAt: "desc" } },
      attachments: { orderBy: { id: "desc" } },
      product: true,
      technicians: true
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
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("orders.fieldDetail.notFoundTitle")}</h1>
        <p className="text-gray-600 mb-4">{t("orders.fieldDetail.notFoundText")}</p>
        <Link href="/mine-oppdrag" className="inline-flex min-h-11 items-center bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition">
          {t("orders.fieldDetail.backToOverview")}
        </Link>
      </div>
    );
  }

  // Kansellerte oppdrag er avsluttet og skal ikke vises i feltportalen.
  // De finnes fortsatt som historikk på kundesiden.
  if (workOrder.status === "CANCELLED") redirect("/mine-oppdrag");

  const isAdmin = user.role === "ADMIN";
  const canUpdate = hasPermission(user, "workorders.update");
  const canEdit = hasPermission(user, "workorders.edit");

  // Et nylig fjernet personellmedlem gir en angre-knapp i en toast nederst.
  const removedId = removed ? idSchema.safeParse(removed) : null;
  const removedUser = removedId?.success
    ? await prisma.user.findFirst({
        where: {
          id: removedId.data,
          ...staffForDepartment(workOrder.departmentId),
        },
        select: { id: true, name: true },
      })
    : null;

  const statusLabels: Record<WorkStatus, string> = {
    OPEN: t("orders.fieldDetail.statusOpen"),
    PENDING: t("orders.fieldDetail.statusPending"),
    PLANNED: t("orders.fieldDetail.statusPlanned"),
    IN_PROGRESS: t("orders.fieldDetail.statusInProgress"),
    WAITING: t("orders.fieldDetail.statusWaiting"),
    COMPLETED: t("orders.fieldDetail.statusCompleted"),
    CANCELLED: t("orders.fieldDetail.statusCancelled"),
  };
  // Kansellerte oppdrag er allerede avvist for montører lenger opp.
  const isClosed = workOrder.status === "COMPLETED";
  // Alle åpne statuser kan velges fritt, i tillegg til fullført/kansellert.
  // En låst rapport påvirker ikke valgene – den låser bare rapporten.
  // PENDING er systemets startstatus og tilbys ikke som manuelt valg.
  // Feltportalen gjenåpner ikke fullførte oppdrag; det gjøres fra kontorsiden
  // med en begrunnelse.
  const allowedStatusOptions = isClosed
    ? []
    : statusSelectOptions(workOrder.status, isAdmin);
  const canCancelNow =
    canUpdate &&
    canEdit &&
    !isClosed &&
    allowedStatusOptions.includes("CANCELLED");
  const statusOptions = allowedStatusOptions.filter(
    (status) => status !== "CANCELLED",
  );
  const canWriteReports = hasPermission(user, "reports.write");
  const canViewReports = hasPermission(user, "reports.view");

  const allUsers = await prisma.user.findMany({
    where: staffForDepartment(workOrder.departmentId),
    orderBy: { name: 'asc' },
    take: 100,
  });
  const availableUsers = allUsers.filter(u => !workOrder.technicians.some((tech) => tech.id === u.id));

  const allTemplates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const availableTemplates = allTemplates.filter(template => !workOrder.templates.some(wt => wt.id === template.id));
  const { service: serviceTemplates, hms: hmsTemplates } =
    splitTemplatesByCategory(workOrder.templates);
  // Service først, deretter en egen HMS-seksjon. Rekkefølgen innad er uendret.
  const orderedTemplates = [...serviceTemplates, ...hmsTemplates];
  const {
    service: availableServiceTemplates,
    hms: availableHmsTemplates,
  } = splitTemplatesByCategory(availableTemplates);

  // Neste sjekkliste er den første som mangler rapport eller er ulåst.
  const reportsByTemplate = new Map(
    workOrder.reports.map((report) => [report.templateId, report]),
  );
  const nextTemplate = orderedTemplates.find((template) => {
    const report = reportsByTemplate.get(template.id);
    return !report || !report.isLocked;
  });
  const hasAnyReport = orderedTemplates.some((template) =>
    reportsByTemplate.has(template.id),
  );
  const canOpenChecklist = canWriteReports && canUpdate;
  const stickyAction =
    canOpenChecklist && nextTemplate
      ? {
          href: `/mine-oppdrag/${workOrderId}/skjema/${nextTemplate.id}`,
          label: hasAnyReport
            ? t("orders.fieldDetail.stickyContinueForm")
            : t("orders.fieldDetail.stickyStartForm"),
        }
      : !isClosed && canUpdate
        ? {
            href: "#status",
            label: t("orders.fieldDetail.stickyComplete"),
          }
        : null;

  /**
   * Fjerner personell og redirecter med en kvittering, slik at siden kan vise
   * en toast med angre. Selve autorisasjonen ligger i tjenestelaget.
   */
  async function removeTechnicianWithUndo(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor || !actor.isActive) redirect("/api/auth/signin");

    const parsedUserId = idSchema.safeParse(formData.get("userId"));
    if (!parsedUserId.success) {
      redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);
    }

    const result = await workOrderService.removeTechnician(
      actor,
      workOrderId,
      parsedUserId.data,
    );
    if (!result.ok) {
      redirect(`/mine-oppdrag/${workOrderId}?error=${result.error}`);
    }

    revalidatePath(`/mine-oppdrag/${workOrderId}`);
    revalidatePath("/mine-oppdrag");
    redirect(
      `/mine-oppdrag/${workOrderId}?removed=${encodeURIComponent(parsedUserId.data)}`,
    );
  }

  /** Angre legger personen tilbake gjennom samme autoriserte tjeneste. */
  async function undoRemoveTechnician(formData: FormData) {
    "use server";
    const actor = await getCurrentUser();
    if (!actor || !actor.isActive) redirect("/api/auth/signin");

    const parsedUserId = idSchema.safeParse(formData.get("userId"));
    if (!parsedUserId.success) {
      redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);
    }

    const result = await workOrderService.addTechnician(
      actor,
      workOrderId,
      parsedUserId.data,
    );
    if (!result.ok) {
      redirect(`/mine-oppdrag/${workOrderId}?error=${result.error}`);
    }

    revalidatePath(`/mine-oppdrag/${workOrderId}`);
    revalidatePath("/mine-oppdrag");
    redirect(`/mine-oppdrag/${workOrderId}?restored=1`);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-28 sm:p-6 sm:pb-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex justify-between items-start gap-3 border-b border-gray-300 pb-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-black text-gray-900">{workOrder.title}</h1>
            <p className="text-sm text-gray-600 mt-1">🏢 {workOrder.customer?.name || t("orders.fieldDetail.internalOrder")}</p>
            <p className="text-xs text-gray-600 font-bold mt-1">{t("orders.fieldDetail.department", { name: workOrder.department.name })}</p>
            {workOrder.tags && workOrder.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {workOrder.tags.map((tag: any) => (
                  <span
                    key={tag.id}
                    className="text-white px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm"
                    suppressHydrationWarning
                    style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
                  >
                    🏷️ {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Link href="/mine-oppdrag" className="inline-flex min-h-11 shrink-0 items-center bg-white text-gray-700 px-4 py-2 rounded-xl text-sm font-bold border-2 border-gray-200 shadow-sm hover:bg-gray-100 transition">
            {t("orders.fieldDetail.back")}
          </Link>
        </div>

        {restored && (
          <CustomerToast
            message={t("orders.fieldDetail.restoredToast")}
            tone="success"
          />
        )}

        {error === "locked" && (
          <ErrorBanner message={t("orders.errors.lockedField")} />
        )}

        {error === "ugyldig-status" && (
          <ErrorBanner message={t("orders.errors.invalidStatusField")} />
        )}

        {error && !["locked", "ugyldig-status"].includes(error) && (
          <ErrorBanner message={t("orders.errors.generic")} />
        )}

        {reportSubmitted && (
          <ReportSubmissionCleanup
            userId={user.id}
            workOrderId={workOrderId}
            templateId={reportSubmitted}
          />
        )}

        {/* STATUS & DATO – rett under headeren, sammen med sjekklistene. */}
        <div id="status" className="scroll-mt-4 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">

            <div>
              <p className="text-xs font-black text-gray-600 uppercase tracking-wider mb-2">{t("orders.fieldDetail.statusTitle")}</p>
              {isClosed ? (
                <p className="text-sm text-gray-600 italic">
                  {t("orders.errors.workOrderLocked")}
                </p>
              ) : canUpdate ? (
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
                    confirmMessage={t("orders.fieldDetail.completeConfirm")}
                    confirmWhenField="status"
                    confirmWhenValue="COMPLETED"
                    className="status-form flex items-center gap-2 flex-wrap"
                  >
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <select
                      name="status"
                      defaultValue={workOrder.status}
                      className="border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-600 min-w-[180px] min-h-11"
                    >
                      <option value={workOrder.status} disabled>
                        {statusLabels[workOrder.status]} ({t("orders.fieldDetail.currentStatus")})
                      </option>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {statusLabels[status]}
                        </option>
                      ))}
                    </select>
                    <SubmitButton
                      disabled
                      pendingLabel={t("orders.fieldDetail.updating")}
                      className="status-submit-disabled min-h-11 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition whitespace-nowrap"
                    >
                      {t("orders.fieldDetail.update")}
                    </SubmitButton>
                    <SubmitButton
                      disabled={statusOptions.length === 0}
                      pendingLabel={t("orders.fieldDetail.updating")}
                      className="status-submit-ready min-h-11 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition whitespace-nowrap"
                    >
                      {t("orders.fieldDetail.update")}
                    </SubmitButton>
                  </ConfirmSubmitForm>
                  {canCancelNow && (
                    <ConfirmSubmitForm
                      action={updateStatus}
                      confirmMessage={t("orders.fieldDetail.cancelConfirm")}
                      confirmWhenField="status"
                      confirmWhenValue="CANCELLED"
                      danger
                      className="mt-2 flex items-center gap-2 flex-wrap"
                    >
                      <input type="hidden" name="workOrderId" value={workOrderId} />
                      <input type="hidden" name="status" value="CANCELLED" />
                      <SubmitButton
                        pendingLabel={t("orders.fieldDetail.updating")}
                        className="min-h-11 border-2 border-red-200 bg-white text-red-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-red-50 transition whitespace-nowrap"
                      >
                        {t("orders.fieldDetail.cancelWorkOrder")}
                      </SubmitButton>
                    </ConfirmSubmitForm>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-600 italic">
                  {t("orders.fieldDetail.noStatusPermission")}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-black text-gray-600 uppercase tracking-wider mb-2">{t("orders.fieldDetail.scheduledDate")}</p>
              <p className="font-bold text-gray-900 bg-gray-50 p-2.5 border-2 border-gray-200 rounded-xl inline-block w-full">
                📅 {formatDateRange(workOrder.scheduledFor, workOrder.scheduledTo) || t("orders.fieldDetail.noDate")}
              </p>
            </div>

          </div>
        </div>

        {/* SJEKKLISTER – høyt opp, slik at montøren slipper å scrolle. */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200">
          <h2 className="font-black text-lg text-gray-900 mb-4 border-b pb-2">{t("orders.fieldDetail.checklistsTitle")}</h2>

          {workOrder.templates.length === 0 ? (
            <p className="text-sm text-gray-600 italic mb-4">{t("orders.fieldDetail.noChecklists")}</p>
          ) : (
            <div className="space-y-3 mb-6">
              {orderedTemplates.map((template, templateIndex) => {
                const report = workOrder.reports.find(report => report.templateId === template.id);
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
                  <div className={`flex flex-wrap justify-between items-center gap-3 p-3 sm:p-4 rounded-xl border-2 transition ${report ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                    <span className={`font-bold text-sm ${report ? 'text-green-900' : 'text-blue-900'} flex items-center gap-2 flex-wrap`}>
                      {template.title}
                      {isHmsTemplate(template) && (
                        <span className="bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                          🛡️ {template.hmsType
                            ? t(HMS_TYPE_MESSAGE_KEYS[template.hmsType])
                            : t("orders.templateGroups.hmsBadge")}
                        </span>
                      )}
                      {canViewReports && report?.reportNumber && (
                        <span className="bg-white text-gray-700 border border-gray-300 text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("orders.fieldDetail.reportNumber", {
                            number: report.reportNumber,
                          })}
                        </span>
                      )}
                      {report?.isLocked && (
                        <span className="bg-gray-800 text-white text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("orders.fieldDetail.locked")}
                        </span>
                      )}
                      {report && !report.isLocked && (
                        <span className="bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("orders.fieldDetail.unlocked")}
                        </span>
                      )}
                    </span>

                    {report ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        {canViewReports && (
                          <Link
                            href={`/rapporter/${workOrderId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-11 items-center bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-blue-800 shadow-sm transition whitespace-nowrap"
                          >
                            {t("orders.fieldDetail.openReport")}
                          </Link>
                        )}
                        {canWriteReports && canUpdate && !report.isLocked && (
                          <Link
                            href={`/mine-oppdrag/${workOrderId}/skjema/${template.id}`}
                            className="inline-flex min-h-11 items-center bg-amber-700 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-amber-800 shadow-sm transition whitespace-nowrap"
                          >
                            {t("orders.fieldDetail.edit")}
                          </Link>
                        )}
                      </div>
                    ) : canWriteReports && canUpdate ? (
                      <Link
                        href={`/mine-oppdrag/${workOrderId}/skjema/${template.id}`}
                        className="inline-flex min-h-11 items-center bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-blue-800 shadow-sm transition whitespace-nowrap"
                      >
                        {t("orders.fieldDetail.fillForm")}
                      </Link>
                    ) : (
                      <span className="text-xs font-bold text-gray-600">
                        {t("orders.fieldDetail.waitingFill")}
                      </span>
                    )}
                  </div>
                  </Fragment>
                );
              })}
            </div>
          )}

          {canUpdate && availableTemplates.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs font-black text-gray-600 uppercase tracking-wider mb-2">{t("orders.fieldDetail.extraChecklist")}</p>
              <form action={addTemplate} className="flex gap-2 flex-wrap">
                <input type="hidden" name="workOrderId" value={workOrderId} />
                <select
                  name="templateId"
                  required
                  defaultValue=""
                  className="border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white flex-1 outline-none shadow-sm min-w-[200px] min-h-11"
                >
                  <option value="" disabled>{t("orders.fieldDetail.selectTemplate")}</option>
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
                <button type="submit" className="min-h-11 bg-gray-200 text-gray-800 px-4 py-2.5 rounded-xl text-sm font-black hover:bg-gray-300 transition shadow-sm whitespace-nowrap">
                  {t("orders.fieldDetail.add")}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* ARBEIDSBESKRIVELSE */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <h2 className="text-xs font-black text-gray-600 uppercase tracking-wider mb-2">{t("orders.fieldDetail.descriptionTitle")}</h2>
          <div className="bg-blue-50/60 border-2 border-blue-200 p-3 sm:p-4 rounded-xl">
            {workOrder.description ? (
              <MarkdownView value={workOrder.description} className="text-gray-900 font-medium" />
            ) : (
              <p className="text-sm text-gray-900 font-medium">
                {t("orders.fieldDetail.noDescription")}
              </p>
            )}
          </div>
        </div>

        {/* KOMMENTARER / LOGG – editoren er kollapset bak en knapp. */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4">
          <h2 className="font-black text-lg text-gray-900 border-b pb-2">{t("orders.fieldDetail.commentsTitle")}</h2>

          {canUpdate && (
            <details className="rounded-xl">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-xl bg-blue-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 [&::-webkit-details-marker]:hidden">
                {t("orders.fieldDetail.writeComment")}
              </summary>
              <form action={addComment} className="mt-3 space-y-3">
                <input type="hidden" name="workOrderId" value={workOrderId} />
                <MarkdownEditor
                  name="content"
                  rows={3}
                  required
                  placeholder={t("orders.fieldDetail.commentPlaceholder")}
                />
                <div className="flex justify-end">
                  <button type="submit" className="min-h-11 bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap">
                    {t("orders.fieldDetail.addComment")}
                  </button>
                </div>
              </form>
            </details>
          )}

          {/* Liste over tidligere kommentarer */}
          <div className="space-y-3 pt-4 border-t border-gray-200">
            {workOrder.workComments.length === 0 ? (
              <p className="text-sm text-gray-600 italic">{t("orders.fieldDetail.noComments")}</p>
            ) : (
              workOrder.workComments.map((comment: any) => (
                <div key={comment.id} className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200 space-y-1">
                  <div className="flex justify-between items-center text-xs text-gray-600 font-bold">
                    <span>{comment.authorName || t("orders.fieldDetail.unknownAuthor")}</span>
                    <span>{formatDateTime(comment.createdAt)}</span>
                  </div>
                  <div className="text-sm text-gray-900 font-medium">
                    <MarkdownView value={comment.content} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* TILDELTE MONTØRER & KONTOR */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4">
          <h2 className="font-black text-lg text-gray-900 border-b pb-2">{t("orders.fieldDetail.personnelTitle")}</h2>

          <div className="space-y-2">
            {workOrder.technicians.length === 0 ? (
              <p className="text-sm text-red-700 font-bold">{t("orders.fieldDetail.noPersonnel")}</p>
            ) : (
              <div className="space-y-2">
                {workOrder.technicians.map((tech: any) => (
                  <div key={tech.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-200 gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0"></span>
                      <div className="min-w-0">
                        <p className="font-black text-gray-900 text-sm truncate">{tech.name} {tech.id === user.id ? <span className="text-xs text-blue-700">{t("orders.fieldDetail.you")}</span> : ""}</p>
                        <p className="text-xs text-gray-600">{tech.role === 'ADMIN' ? t("orders.fieldDetail.roleAdmin") : tech.role === 'OFFICE' ? t("orders.fieldDetail.roleOffice") : t("orders.fieldDetail.roleTechnician")}</p>
                      </div>
                    </div>

                    {canUpdate && (
                      <ConfirmSubmitForm
                        action={removeTechnicianWithUndo}
                        confirmMessage={t("orders.fieldDetail.removeConfirm", {
                          name: tech.name,
                        })}
                        confirmLabel={
                          tech.id === user.id
                            ? t("orders.fieldDetail.removeMe")
                            : t("orders.fieldDetail.remove")
                        }
                        danger
                        className="flex-shrink-0"
                      >
                        <input type="hidden" name="workOrderId" value={workOrderId} />
                        <input type="hidden" name="userId" value={tech.id} />
                        <SubmitButton
                          pendingLabel={t("orders.fieldDetail.updating")}
                          className="min-h-11 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg border border-red-300 transition whitespace-nowrap"
                        >
                          {tech.id === user.id ? t("orders.fieldDetail.removeMe") : t("orders.fieldDetail.remove")}
                        </SubmitButton>
                      </ConfirmSubmitForm>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canUpdate && availableUsers.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs font-black text-gray-600 uppercase tracking-wider mb-2">{t("orders.fieldDetail.addPersonnel")}</p>
              <form action={addTechnician} className="flex gap-2 flex-wrap">
                <input type="hidden" name="workOrderId" value={workOrderId} />
                <select
                  name="userId"
                  required
                  defaultValue=""
                  className="border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white flex-1 outline-none shadow-sm min-w-[200px] min-h-11"
                >
                  <option value="" disabled>{t("orders.fieldDetail.selectPerson")}</option>
                  {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role === 'ADMIN' ? t("orders.fieldDetail.roleAdmin") : u.role === 'OFFICE' ? t("orders.fieldDetail.roleOffice") : u.role === 'TECHNICIAN' ? t("orders.fieldDetail.roleTechnician") : u.role === 'CUSTOMER' ? t("orders.fieldDetail.roleCustomer") : t("orders.fieldDetail.roleStandard")})</option>
                  ))}
                </select>
                <button type="submit" className="min-h-11 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
                  {t("orders.fieldDetail.add")}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* LOKASJON & KONTAKTPERSON */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <h2 className="font-black text-lg text-gray-900 mb-4 border-b pb-2">{t("orders.fieldDetail.locationTitle")}</h2>
          <div className="text-sm text-gray-800 space-y-4">
            <div>
              <p className="text-gray-900">
                <strong>{t("orders.fieldDetail.address")}</strong>
                <GoogleMapsLink
                  address={workOrder.address ?? workOrder.customer?.address}
                  postalCode={workOrder.postalCode ?? workOrder.customer?.postalCode}
                  city={workOrder.city ?? workOrder.customer?.city}
                  label={workOrder.address || workOrder.customer?.address || t("orders.fieldDetail.addressUnknown")}
                />
                {workOrder.postalCode || workOrder.customer?.postalCode || ""}{" "}
                {workOrder.city || workOrder.customer?.city || ""}
              </p>
              {workOrder.customer?.phone && (
                <p className="mt-1">
                  <strong>{t("orders.fieldDetail.companyPhone")}</strong>{" "}
                  <a href={`tel:${workOrder.customer?.phone}`} className="inline-flex min-h-11 items-center text-blue-700 font-bold hover:underline">{workOrder.customer?.phone}</a>
                </p>
              )}
            </div>

            {workOrder.contact ? (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200">
                <p className="text-xs font-black text-gray-600 uppercase tracking-wider mb-1">{t("orders.fieldDetail.contactTitle")}</p>
                <p className="font-black text-gray-900 text-base">{workOrder.contact.name}</p>
                <div className="mt-2 space-y-1 text-sm">
                  {workOrder.contact.phone && <p>📞 <a href={`tel:${workOrder.contact.phone}`} className="inline-flex min-h-11 items-center text-blue-700 font-bold hover:underline">{workOrder.contact.phone}</a></p>}
                  {workOrder.contact.email && <p>✉️ <a href={`mailto:${workOrder.contact.email}`} className="inline-flex min-h-11 items-center text-blue-700 font-bold hover:underline">{workOrder.contact.email}</a></p>}
                </div>
              </div>
            ) : workOrder.customer?.contacts && workOrder.customer?.contacts.length > 0 ? (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200">
                <p className="text-xs font-black text-gray-600 uppercase tracking-wider mb-3">{t("orders.fieldDetail.customerContacts")}</p>
                <div className="space-y-3 divide-y divide-gray-200">
                  {workOrder.customer?.contacts.map((c: any) => (
                    <div key={c.id} className="pt-3 first:pt-0">
                      <p className="font-black text-gray-900">{c.name} {c.role ? <span className="text-gray-600 font-normal">({c.role})</span> : ""}</p>
                      <div className="mt-1 space-y-0.5 text-sm">
                        {c.phone && <p>📞 <a href={`tel:${c.phone}`} className="inline-flex min-h-11 items-center text-blue-700 font-bold hover:underline">{c.phone}</a></p>}
                        {c.email && <p>✉️ <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center text-blue-700 font-bold hover:underline">{c.email}</a></p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                <p className="text-xs text-gray-600 italic">{t("orders.fieldDetail.noContact")}</p>
              </div>
            )}
          </div>
        </div>

        {/* Vedlegg */}
        <WorkOrderAttachments
          workOrderId={workOrderId}
          attachments={workOrder.attachments.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            dataUrl: a.dataUrl,
          }))}
          canUpload={canUpdate}
          canDelete={isAdmin}
        />

        {/* Audit log */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <h2 className="font-black text-gray-900 mb-3 border-b pb-2">{t("orders.fieldDetail.auditLog")}</h2>
          <AuditLogTable logs={auditLogs} />
        </div>
      </div>

      {/* Angre-toast etter fjerning av personell. */}
      {removedUser && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom,0px)+8rem)] z-50 mx-auto flex max-w-md items-center gap-2 rounded-xl border-2 border-gray-700 bg-gray-900 px-3 py-2 text-sm font-bold text-white shadow-xl sm:bottom-4"
        >
          <p className="min-w-0 flex-1">
            {t("orders.fieldDetail.removedToast", {
              name: removedUser.name || t("orders.fieldDetail.unknownAuthor"),
            })}
          </p>
          <form action={undoRemoveTechnician}>
            <input type="hidden" name="userId" value={removedUser.id} />
            <SubmitButton
              pendingLabel={t("orders.fieldDetail.undoing")}
              className="inline-flex min-h-11 items-center rounded-lg bg-white px-3 text-sm font-black text-gray-900 hover:bg-gray-100"
            >
              {t("orders.fieldDetail.undo")}
            </SubmitButton>
          </form>
          <Link
            href={`/mine-oppdrag/${workOrderId}`}
            aria-label={t("orders.fieldDetail.dismiss")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white hover:bg-white/10"
          >
            ✕
          </Link>
        </div>
      )}

      {/* Sticky handlingslinje på mobil. */}
      {stickyAction && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-gray-200 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">
          <Link
            href={stickyAction.href}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-700 px-4 text-base font-black text-white shadow-sm transition hover:bg-blue-800"
          >
            {stickyAction.label}
          </Link>
        </div>
      )}
    </div>
  );
}
