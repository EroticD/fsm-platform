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
import Icon from "@/components/icons";
import { needsComment, parseImageUrls, readLineComment } from "@/lib/report-answers";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffForDepartment, workOrderScope } from "@/lib/access";
import { statusSelectOptions } from "@/lib/work-order-status";
import {
  addContactToCustomer,
  assignTechnician,
  cloneWorkOrder,
  createVisit,
  deleteVisit,
  deleteWorkOrder,
  moveVisit,
  assignVisit,
  setContact,
  setReportLegalHold,
  setReportLock,
  setTags,
  setTemplate,
  setVisitStatus,
  setWorkOrderLegalHold,
  unassignTechnician,
  updateStatus,
  updateVisit,
} from "./actions";
import {
  lastIncludedVisitDate,
  visitDateInput,
  visitTimeInput,
} from "./visit-planning";
import CustomerToast from "@/components/customer/CustomerToast";
import {
  dateOnlyInOslo,
  formatDateLocalized,
  formatDateRangeLocalized,
  formatDateTimeLocalized,
  parseDateOnly,
  todayInOslo,
} from "@/lib/dates";
import {
  VISIT_STATUS_LABEL_KEYS,
  allowedVisitTransitions,
  isTerminalVisitStatus,
} from "@/lib/visit-status";
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
import { slaRemainingMinutes, slaStateAt } from "@/lib/sla";

// Command Center-verdier. Fallbackene matcher office-card/signal-button/
// ink-button-tokenene, slik at flaten står riktig også før de er lastet.
const CARD = "office-card";
const SUB_CARD =
  "rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const INK_SOLID =
  "ink-button text-xs";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const SECTION_TITLE =
  "text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]";

const STATUS_TONE: Record<string, string> = {
  IN_PROGRESS:
    "border-[var(--ink,#131711)] bg-[var(--signal,#c8f135)] text-[var(--ink,#131711)]",
  COMPLETED: "border-[#a9c96a] bg-[#eef7d6] text-[#283509]",
  CANCELLED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  WAITING: "border-[#e4c98f] bg-[#fdf5e4] text-[#7a4f0c]",
};

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

/** Handlingskoder action-wrappers redirecter tilbake med etter vellykket lagring. */
const DETAIL_FEEDBACK_MESSAGE_KEYS: Record<string, string> = {
  tags: "orders.feedback.tagsSaved",
  status: "orders.feedback.statusUpdated",
  montor: "orders.feedback.technicianAssigned",
  "montor-fjernet": "orders.feedback.technicianRemoved",
  kontakt: "orders.feedback.contactSelected",
  "kontakt-lagt-til": "orders.feedback.contactAdded",
  sjekkliste: "orders.feedback.templateAdded",
  "rapport-las": "orders.feedback.reportLockUpdated",
  bevaring: "orders.feedback.legalHoldUpdated",
  "rapport-bevaring": "orders.feedback.reportLegalHoldUpdated",
  klonet: "orders.feedback.cloned",
  oppdatert: "orders.feedback.workOrderUpdated",
  dato: "orders.feedback.workOrderUpdated",
  "visitt-opprettet": "orders.feedback.visitCreated",
  "visitt-flyttet": "orders.feedback.visitMoved",
  "visitt-tildelt": "orders.feedback.visitAssigned",
  "visitt-oppdatert": "orders.feedback.visitUpdated",
  "visitt-slettet": "orders.feedback.visitDeleted",
  "visitt-status": "orders.feedback.visitStatusUpdated",
};

/** Feilkoder fra visittjenesten, oversatt i planleggingskortet. */
const PLANNING_ERROR_KEYS: Record<string, string> = {
  overlap: "orders.detail.planning.errors.overlap",
  invalidTimeRange: "orders.detail.planning.errors.invalidTimeRange",
  durationTooLong: "orders.detail.planning.errors.durationTooLong",
  invalidTechnician: "orders.detail.planning.errors.invalidTechnician",
  invalidInput: "orders.detail.planning.errors.invalidInput",
  invalidSequence: "orders.detail.planning.errors.invalidSequence",
  legalHold: "orders.detail.planning.errors.legalHold",
  workOrderLocked: "orders.detail.planning.errors.workOrderLocked",
  visitLocked: "orders.detail.planning.errors.visitLocked",
  statusTransition: "orders.detail.planning.errors.statusTransition",
  noChange: "orders.detail.planning.errors.noChange",
  forbidden: "orders.detail.planning.errors.forbidden",
  notFound: "orders.detail.planning.errors.notFound",
  conflict: "orders.detail.planning.errors.conflict",
  generic: "orders.detail.planning.errors.generic",
};

const SLA_STATE_KEYS: Record<string, string> = {
  ON_TRACK: "orders.detail.sla.onTrack",
  AT_RISK: "orders.detail.sla.atRisk",
  BREACHED: "orders.detail.sla.breached",
  MET: "orders.detail.sla.met",
  CANCELLED: "orders.detail.sla.cancelled",
};

const SLA_STATE_TONES: Record<string, string> = {
  ON_TRACK: "border-[#bcd39a] bg-[#eef7d6] text-[#283509]",
  AT_RISK: "border-[#e4c98f] bg-[#fdf5e4] text-[#6b4808]",
  BREACHED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  MET: "border-[#b9cdb4] bg-[#eaf3e4] text-[#24502f]",
  CANCELLED: "border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
};

const VISIT_STATUS_TONES: Record<string, string> = {
  PLANNED: "border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
  ASSIGNED: "border-[#bcd39a] bg-[#eef7d6] text-[#283509]",
  EN_ROUTE: "border-[#c9c0ac] bg-[#fff4d6] text-[#6b4808]",
  ON_SITE:
    "border-[var(--ink,#131711)] bg-[var(--signal,#c8f135)] text-[var(--ink,#131711)]",
  DONE: "border-[#b9cdb4] bg-[#eaf3e4] text-[#24502f]",
  CANCELLED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
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
        <span className={answer ? "font-black text-[#283509]" : "font-bold text-[var(--muted,#62685f)]"}>
          {answer ? t("orders.detail.report.yesDone") : t("orders.detail.report.noUnchecked")}
        </span>
      );
    }
    if (field.type === "STATUS") {
      return answer ? (
        <span className={needsComment(field, answer) ? "font-black text-[var(--risk-text,#b42318)]" : "font-black text-[#283509]"}>
          {String(answer)}
        </span>
      ) : (
        <span className="text-[var(--muted,#62685f)]">{t("orders.detail.report.notAssessed")}</span>
      );
    }
    if (field.type === "SIGNATURE") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 font-bold text-[var(--ink,#101310)]">
          <Icon name="pen" className="h-3.5 w-3.5 shrink-0" />
          {answer ? t("orders.detail.report.signedBy", { name: String(answer) }) : t("orders.detail.report.notSigned")}
        </span>
      );
    }
    if (field.type === "IMAGE") {
      const urls = parseImageUrls(answer);
      if (urls.length === 0) return <span className="text-[var(--muted,#62685f)]">{t("orders.detail.report.notAttached")}</span>;
      return (
        <span className="flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={t("orders.detail.report.attachmentAlt", { number: index + 1 })}
                className="h-20 w-20 rounded-lg border border-[var(--line,#d8d3c5)] bg-[var(--surface,#fffdf8)] object-cover transition hover:border-[var(--ink,#131711)]"
              />
            </a>
          ))}
        </span>
      );
    }
    return (
      <span className="font-medium italic text-[var(--ink,#101310)]">
        {answer !== undefined && answer !== "" ? `"${String(answer)}"` : <span className="text-[var(--muted,#62685f)]">{t("orders.detail.report.notAnswered")}</span>}
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
        <div className={alert ? "font-bold text-[var(--risk-text,#b42318)]" : undefined}>
          <span className="font-bold text-[var(--ink,#101310)]">{field.label}: </span>
          {!longText && renderAnswer(field, answer)}
        </div>
        {longText && (
          <div className="mt-1 border-l-2 border-[var(--line,#dedcd1)] pl-2 text-[#2a2f28]">
            {typeof answer === "string" && answer.trim() ? (
              <MarkdownView value={answer} />
            ) : (
              <span className="font-medium text-[var(--muted,#62685f)]">{t("orders.detail.report.notAnswered")}</span>
            )}
          </div>
        )}
        {comment && (
          <div className="mt-1 flex gap-1.5 rounded-r border-l-4 border-[#dfc98b] bg-[#fdf5e4] py-1 pl-2 text-[13px] text-[#6b4808]">
            <Icon name="note" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
      <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
        <p className="mb-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">{label}</p>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-20 rounded border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]" />
        )}
        <p className="mt-1 text-sm font-bold text-[var(--ink,#101310)]">{name || t("orders.detail.report.noName")}</p>
      </div>
    );
  };

  const technicianSignature = signatureBlock(t("orders.detail.report.technicianSignature"), report?.technicianSignatureUrl, report?.technicianName);
  const customerSignature = signatureBlock(t("orders.detail.report.customerSignature"), report?.customerSignatureUrl, report?.customerName);

  return (
    <div className="space-y-4 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 text-sm sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {report?.reportNumber && (
          <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2.5 py-1 text-xs font-bold tracking-wide text-[var(--muted,#62685f)]">
            {t("orders.detail.report.reportNumber", {
              number: report.reportNumber,
            })}
          </span>
        )}
        {summary.usesUnits && (
          <>
            <span className="text-xs font-black uppercase tracking-wider text-[var(--muted,#62685f)]">{t("orders.detail.report.mainResult")}</span>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${reportStatus === "GODKJENT" ? "border-[#b9c99a] bg-[#eef7d6] text-[#283509]" : "border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]"}`}>
              {reportStatus === "GODKJENT" ? t("orders.detail.report.approved") : t("orders.detail.report.deviation")}
            </span>
          </>
        )}
        {report?.legalHold && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#e7b5ae] bg-[#fdf4f2] px-3 py-1 text-xs font-black uppercase tracking-wide text-[var(--risk-text,#b42318)]">
            <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
            {t("orders.detail.legalHoldBadge")}
          </span>
        )}
        {acknowledgement.acknowledged && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#b9c99a] bg-[#eef7d6] px-3 py-1 text-xs font-bold text-[#283509]">
            <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
            {t("orders.detail.report.customerAcknowledged", { date: formatDateLocalized(acknowledgement.at, locale) })}
          </span>
        )}
      </div>

      {acknowledgement.acknowledged && acknowledgement.comment && (
        <div className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] px-3 py-2 text-sm text-[#283509]">
          <p className="text-xs font-black uppercase tracking-wider text-[#3f4a1a]">
            {t("orders.detail.report.customerAcknowledgementComment")}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{acknowledgement.comment}</p>
          {acknowledgement.by && (
            <p className="mt-1 text-xs text-[#3f4a1a]">{acknowledgement.by}</p>
          )}
        </div>
      )}

      {/* ENHETER */}
      {summary.usesUnits && units.length > 0 && (
        <div className="mt-3 space-y-3 border-t border-[var(--line,#dedcd1)] pt-3">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--muted,#62685f)]">
            {t("orders.detail.report.unitsChecked", { count: units.length })}
          </p>

          {units.map((unit, index: number) => {
            let answers: Record<string, unknown> = {};
            try {
              answers = JSON.parse(unit.answersJson || "{}");
            } catch {}

            return (
              <div key={unit.id} className="overflow-hidden rounded-xl border border-[var(--line,#dedcd1)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2">
                  <div>
                    <p className="text-sm font-black text-[var(--ink,#101310)]">{index + 1}. {unit.label}</p>
                    <p className="text-xs text-[var(--muted,#62685f)]">
                      {unit.serialNumber ? t("orders.detail.report.serialNumber", { number: unit.serialNumber }) : t("orders.detail.report.noSerialNumber")}
                      {unit.location ? ` • ${unit.location}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${unit.status === "AVVIK" ? "border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]" : "border-[#b9c99a] bg-[#eef7d6] text-[#283509]"}`}>
                    {unit.status === "AVVIK" ? t("orders.detail.report.deviationShort") : t("orders.detail.report.approvedShort")}
                  </span>
                </div>

                {fields.length > 0 && (
                  <div className="space-y-2 bg-[var(--surface,#fffdf8)] p-3">
                    {fields.map((field) => fieldRow(field, answers, field.id))}
                  </div>
                )}

                {unit.comment && (
                  <div className="border-t border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-sm italic text-[var(--ink,#131711)]">
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
        <div className="mt-3 space-y-2 border-t border-[var(--line,#dedcd1)] pt-3">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--muted,#62685f)]">{t("orders.detail.report.answersTitle")}</p>
          <div className="space-y-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
            {fields.map((field) => fieldRow(field, anonymousAnswers, field.id))}
          </div>
          {anonymousUnit?.comment && (
            <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-sm italic">
              <MarkdownView value={anonymousUnit.comment} />
            </div>
          )}
        </div>
      )}

      {summary.usesUnits && units.length === 0 && fields.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-[var(--line,#dedcd1)] pt-3">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--muted,#62685f)]">{t("orders.detail.report.answersTitle")}</p>
          <div className="space-y-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
            {fields.map((field) => fieldRow(field, parsedAnswers, field.id))}
          </div>
        </div>
      )}

      {/* SIGNATURER */}
      {(technicianSignature || customerSignature) && (
        <div className="grid grid-cols-1 gap-3 border-t border-[var(--line,#dedcd1)] pt-3 sm:grid-cols-2">
          {technicianSignature}
          {customerSignature}
        </div>
      )}

      {report?.comments && (
        <div className="border-t border-[var(--line,#dedcd1)] pt-3">
          <span className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--muted,#62685f)]">{t("orders.detail.report.generalNotes")}</span>
          <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 italic text-[var(--ink,#131711)]">
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
  searchParams: Promise<{
    error?: string;
    reportSubmitted?: string;
    ok?: string;
    planningError?: string;
  }>;
}) {
  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;
  const { error, reportSubmitted, ok, planningError } = await searchParams;
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
      product: true,
      visits: {
        include: {
          technicians: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: [{ startsAt: "asc" }, { sequence: "asc" }],
      },
      slaClocks: {
        orderBy: { startedAt: "desc" },
        take: 5,
        include: { policy: { select: { id: true, name: true } } },
      },
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
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--canvas,#f2efe6)] p-4 text-[var(--ink,#131711)] sm:p-6">
        <h1 className="mb-2 text-2xl font-black">{t("orders.detail.notFoundTitle")}</h1>
        <Link href="/" className="font-bold underline decoration-[var(--signal,#c8f135)] decoration-2 underline-offset-4">{t("orders.detail.goToDashboard")}</Link>
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

  const scheduledLabel = formatDateRangeLocalized(
    workOrder.scheduledFor,
    workOrder.scheduledTo,
    locale,
  );
  const scheduledEnd = workOrder.scheduledTo ?? workOrder.scheduledFor;
  const startOfToday = parseDateOnly(todayInOslo()) ?? new Date();
  const isOverdue = Boolean(
    scheduledEnd && !isClosed && scheduledEnd < startOfToday,
  );
  const hasAddress = Boolean(
    workOrder.address ?? workOrder.customer?.address,
  );
  const feedbackKey = ok ? DETAIL_FEEDBACK_MESSAGE_KEYS[ok] : undefined;
  const canCompleteNow =
    canUpdate && !isClosed && statusOptions.includes("COMPLETED");
  const canCreateVisit = canEdit;
  const canMoveVisit = hasPermission(user, "workorders.assign") && !isClosed;
  const canAssignVisit = canMoveVisit;
  const canUpdateVisit = canEdit;
  const canDeleteVisit = canEdit;
  const canSetVisitStatus = canUpdate && !isClosed;
  const planningErrorKey = planningError
    ? (PLANNING_ERROR_KEYS[planningError] ?? PLANNING_ERROR_KEYS.generic)
    : "";
  const visitStatusLabel = (status: keyof typeof VISIT_STATUS_LABEL_KEYS) =>
    t(VISIT_STATUS_LABEL_KEYS[status]);

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">

        {/* HEADER: status, dato, kunde/kontakt, montører og primærhandlinger */}
        <header className={`${CARD} p-4 sm:p-5`}>
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#616656]">
                  {t("metadata.routes.oppdrag")}
                  {workOrder.orderNumber
                    ? ` · ${t("orders.list.orderNumber")} ${workOrder.orderNumber}`
                    : ""}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight md:text-3xl">
                    {workOrder.title}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
                      STATUS_TONE[workOrder.status] ??
                      "border-[var(--line,#d8d3c5)] bg-white"
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    {statusLabels[workOrder.status]}
                  </span>
                  {workOrder.legalHold && (
                    <span
                      className="rounded-full border border-[#e7b5ae] bg-[#fbe9e7] px-2.5 py-1 text-xs font-bold text-[var(--risk-text,#b42318)]"
                      title={t("orders.detail.legalHoldHint")}
                    >
                      {t("orders.detail.legalHoldBadge")}
                    </span>
                  )}
                  {!workOrder.legalHold &&
                    workOrder.reports.some((report) => report.legalHold) && (
                      <span
                        className="rounded-full border border-[#e7b5ae] bg-[#fdf4f2] px-2.5 py-1 text-xs font-bold text-[var(--risk-text,#b42318)]"
                        title={t("orders.detail.legalHoldReportHint")}
                      >
                        {t("orders.detail.legalHoldReportBadge")}
                      </span>
                    )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-bold">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                      isOverdue
                        ? "border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]"
                        : "border-[var(--line,#d8d3c5)] bg-white"
                    }`}
                  >
                    <span className="uppercase tracking-wide text-[#616656]">
                      {t("date")}
                    </span>
                    <span className="tabular-nums">
                      {scheduledLabel || t("orders.detail.noDate")}
                    </span>
                  </span>
                  {isOverdue && (
                    <span className="rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] px-2.5 py-1 text-[var(--risk-text,#b42318)]">
                      {t("orders.list.overdue")}
                    </span>
                  )}
                  <span className="rounded-lg border border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] px-2.5 py-1 text-[#5e6356]">
                    {t("orders.detail.department", {
                      name: workOrder.department.name,
                    })}
                  </span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className={`${SUB_CARD} min-w-0 px-3 py-2`}>
                  <p className={SECTION_TITLE}>{t("customer")}</p>
                  <div className="mt-0.5 line-clamp-2 text-sm font-bold leading-5">
                    {workOrder.customer ? (
                      <Link
                        href={`/kunder/${workOrder.customerId}`}
                        className="hover:underline"
                      >
                        {workOrder.customer.name}
                      </Link>
                    ) : (
                      <span>{t("orders.detail.internalOrder")}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[#5e6356]">
                    {hasAddress ? (
                      <GoogleMapsLink
                        address={workOrder.address ?? workOrder.customer?.address}
                        postalCode={workOrder.postalCode ?? workOrder.customer?.postalCode}
                        city={workOrder.city ?? workOrder.customer?.city}
                      />
                    ) : (
                      <span className="italic">{t("orders.detail.noAddress")}</span>
                    )}
                  </p>
                </div>

                <div className={`${SUB_CARD} min-w-0 px-3 py-2`}>
                  <p className={SECTION_TITLE}>{t("orders.detail.contact")}</p>
                  {workOrder.contact ? (
                    <>
                      <p className="mt-0.5 truncate text-sm font-bold">
                        {workOrder.contact.name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs font-bold">
                        {workOrder.contact.phone && (
                          <a
                            href={`tel:${workOrder.contact.phone}`}
                            className="text-[#3d4237] hover:underline"
                          >
                            {workOrder.contact.phone}
                          </a>
                        )}
                        {workOrder.contact.email && (
                          <a
                            href={`mailto:${workOrder.contact.email}`}
                            className="truncate text-[#3d4237] hover:underline"
                          >
                            {workOrder.contact.email}
                          </a>
                        )}
                      </p>
                      <Link
                        href={`/meldinger?oppdrag=${workOrder.id}`}
                        className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--ink,#101310)] hover:underline"
                      >
                        <Icon name="mail" className="h-3.5 w-3.5 shrink-0" />
                        {t("sms.nav")}
                      </Link>
                    </>
                  ) : (
                    <p className="mt-1 text-xs italic text-[#5e6356]">
                      {t("orders.detail.noContact")}
                    </p>
                  )}
                </div>

                <div className={`${SUB_CARD} min-w-0 px-3 py-2`}>
                  <p className={SECTION_TITLE}>{t("technician")}</p>
                  {workOrder.technicians.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {workOrder.technicians.map((tech) => (
                        <a
                          key={tech.id}
                          href="#tildel"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#bcd39a] bg-[#eef7d6] px-2 py-0.5 text-xs font-bold text-[#283509] hover:border-[#7f9c4d]"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-[#628426]"
                            aria-hidden
                          />
                          {tech.name}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <a
                      href="#tildel"
                      className="mt-1 inline-flex text-xs font-bold text-[var(--risk-text,#b42318)] hover:underline"
                    >
                      {t("orders.detail.noTechnicians")}
                    </a>
                  )}
                </div>
              </div>

              <details className={`${SUB_CARD} group bg-[var(--paper,#f2efe6)]`}>
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-bold [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="text-[#5e6356] transition group-open:rotate-90">▸</span>
                  {t("orders.detail.tagsCount", {
                    count: workOrder.tags.length,
                  })}
                </summary>
                <div className="space-y-2 border-t border-[var(--line,#d8d3c5)] p-3">
                  {workOrder.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {workOrder.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full px-2.5 py-1 text-xs font-bold"
                          suppressHydrationWarning
                          style={{
                            backgroundColor: tag.color || "#3b82f6",
                            color: readableTextColor(tag.color || "#3b82f6"),
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs italic text-[#5e6356]">
                      {t("orders.detail.noTags")}
                    </p>
                  )}
                  {canEdit && (
                    <form action={setTags} className="space-y-2">
                      <input type="hidden" name="workOrderId" value={workOrder.id} />
                      {/* TagSelector viser egne valgknapper. Den separate «valgte tags»-
                          forhåndsvisningen skjules her for å unngå dobbelt visning. */}
                      <div className="[&>div>div.border-t]:hidden">
                        <TagSelector
                          allTags={allTags}
                          selectedTagNames={workOrder.tags.map((tag) => tag.name)}
                        />
                      </div>
                      <button type="submit" className={INK_SOLID}>
                        {t("orders.detail.saveTags")}
                      </button>
                    </form>
                  )}
                </div>
              </details>
            </div>

            <div className="flex flex-wrap items-start gap-2 lg:max-w-md lg:justify-end">
              {canAssign && (
                <a href="#tildel" className={INK_BUTTON}>
                  {t("orders.detail.assign")}
                </a>
              )}
              {canEdit && (
                <>
                  <Link
                    href={`/oppdrag/${workOrder.id}/rediger`}
                    className={canCompleteNow ? INK_BUTTON : SIGNAL_BUTTON}
                  >
                    {t("orders.detail.editWorkOrder")}
                  </Link>
                  <Link
                    href={`/oppdrag/${workOrder.id}/rediger#office-edit-scheduled-for`}
                    className={INK_BUTTON}
                  >
                    {t("orders.detail.moveDate")}
                  </Link>
                </>
              )}
              {canCompleteNow && (
                <ConfirmSubmitForm
                  action={updateStatus}
                  confirmMessage={t("orders.detail.completeConfirm")}
                >
                  <input type="hidden" name="workOrderId" value={workOrder.id} />
                  <input type="hidden" name="status" value="COMPLETED" />
                  <button type="submit" className={SIGNAL_BUTTON}>
                    {t("orders.detail.completeWorkOrder")}
                  </button>
                </ConfirmSubmitForm>
              )}
              {canCreate && isClosed && (
                <form action={cloneWorkOrder}>
                  <input type="hidden" name="workOrderId" value={workOrder.id} />
                  <button type="submit" className={INK_BUTTON}>
                    {t("orders.detail.cloneWorkOrder")}
                  </button>
                </form>
              )}
              {isAdmin && (
                <form action={setWorkOrderLegalHold} className="flex flex-wrap items-center gap-2">
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
                      className="min-w-[12rem] rounded-lg border border-[#e7b5ae] bg-white px-3 py-2 text-xs font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--risk,#b42318)]"
                    />
                  )}
                  <button
                    type="submit"
                    title={t("orders.detail.legalHoldHint")}
                    className={
                      workOrder.legalHold
                        ? "inline-flex min-h-10 items-center justify-center rounded-lg border border-[#e7b5ae] bg-[#fbe9e7] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9d5]"
                        : "inline-flex min-h-10 items-center justify-center rounded-lg border border-[#dfc98b] bg-white px-3 py-2 text-xs font-bold text-[#6b4808] transition hover:bg-[#fdf5e4]"
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
                  confirmLabel={t("orders.detail.moveToTrash")}
                  danger
                >
                  <input type="hidden" name="workOrderId" value={workOrder.id} />
                  <button
                    type="submit"
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#e7b5ae] bg-white px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fdf4f2]"
                  >
                    {t("orders.detail.deleteWorkOrder")}
                  </button>
                </ConfirmSubmitForm>
              )}
              <Link href="/" className={INK_BUTTON}>
                {t("orders.detail.back")}
              </Link>
            </div>
          </div>
        </header>

        {feedbackKey ? (
          <CustomerToast message={t(feedbackKey)} tone="success" />
        ) : null}

        {error === "locked" && (
          <div className="rounded-lg border border-[#dfc98b] bg-[#fdf5e4] px-4 py-3 text-sm font-bold text-[#6b4808]">
            {t("orders.errors.locked")}
          </div>
        )}

        {error === "ugyldig-status" && (
          <div className="rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t("orders.errors.invalidStatus")}
          </div>
        )}

        {error === "legal-hold" && (
          <div className="rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t("orders.errors.legalHold")}
          </div>
        )}

        {error && !["locked", "ugyldig-status", "legal-hold"].includes(error) && (
          <div className="rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
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

        <div className="space-y-4">

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-start-3 lg:row-start-1">

              <div id="status" className={`${CARD} p-4`}>
                <h2 className={`${SECTION_TITLE} mb-3 border-b border-[var(--line,#d8d3c5)] pb-2`}>{t("orders.detail.changeStatus")}</h2>
                {isClosed && (
                  <p className="mb-3 rounded-lg border border-[#dfc98b] bg-[#fdf5e4] px-3 py-2 text-xs font-bold text-[#6b4808]">
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
                        className="w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2.5 text-sm font-bold text-[var(--ink,#131711)] outline-none transition focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)] disabled:opacity-60"
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
                        <label className="text-xs font-bold text-[#5e6356]">
                          {t("orders.detail.reopenReason")}
                          <textarea
                            name="reason"
                            rows={2}
                            maxLength={1000}
                            required={isClosed}
                            placeholder={t("orders.detail.reopenReasonPlaceholder")}
                            className="mt-1 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                          />
                        </label>
                      )}
                      <SubmitButton
                        disabled
                        pendingLabel={t("orders.detail.updatingStatus")}
                        className="status-submit-disabled w-full whitespace-nowrap rounded-lg bg-[var(--ink,#131711)] px-4 py-2.5 text-xs font-bold text-[var(--paper,#fbfaf4)] transition hover:opacity-85"
                      >
                        {t("orders.detail.updateStatus")}
                      </SubmitButton>
                      <SubmitButton
                        disabled={statusOptions.length === 0}
                        pendingLabel={t("orders.detail.updatingStatus")}
                        className="status-submit-ready w-full whitespace-nowrap rounded-lg bg-[var(--ink,#131711)] px-4 py-2.5 text-xs font-bold text-[var(--paper,#fbfaf4)] transition hover:opacity-85"
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
                          <label className="text-xs font-bold text-[#5e6356]">
                            {t("orders.detail.cancelReason")}
                            <textarea
                              name="reason"
                              rows={2}
                              maxLength={1000}
                              required
                              placeholder={t("orders.detail.cancelReasonPlaceholder")}
                              className="mt-1 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                            />
                          </label>
                        )}
                        <SubmitButton
                          pendingLabel={t("orders.detail.updatingStatus")}
                          className="w-full whitespace-nowrap rounded-lg border border-[#e7b5ae] bg-white px-4 py-2.5 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fdf4f2]"
                        >
                          {t("orders.detail.cancelWorkOrder")}
                        </SubmitButton>
                      </ConfirmSubmitForm>
                    )}
                  </>
                ) : (
                  <p className="text-sm italic text-[#5e6356]">
                    {t("orders.detail.noStatusPermission")}
                  </p>
                )}
              </div>

              <div className={`${CARD} p-4 text-sm`}>
                <h2 className={`${SECTION_TITLE} mb-3 border-b border-[var(--line,#d8d3c5)] pb-2`}>{t("orders.detail.locationTitle")}</h2>
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#616656]">
                    {t("orders.detail.address")}
                  </p>
                  <p className="font-bold">
                    {hasAddress ? (
                      <GoogleMapsLink
                        address={workOrder.address ?? workOrder.customer?.address}
                        postalCode={workOrder.postalCode ?? workOrder.customer?.postalCode}
                        city={workOrder.city ?? workOrder.customer?.city}
                      />
                    ) : (
                      <span className="text-xs italic text-[#5e6356]">{t("orders.detail.noAddress")}</span>
                    )}
                  </p>
                </div>

                {workOrder.creatorName && (
                  <p className="mt-2 text-xs text-[#5e6356]">
                    <strong>{t("orders.detail.createdBy")}</strong> {workOrder.creatorName}
                  </p>
                )}

                {canEdit && canManageCustomers && workOrder.customer && (
                  <div className="mt-3 space-y-3 border-t border-[var(--line,#d8d3c5)] pt-3">
                    <form action={setContact} className="flex flex-col gap-2">
                      <input type="hidden" name="workOrderId" value={workOrder.id} />
                      <select
                        name="contactId"
                        defaultValue={workOrder.contactId || ""}
                        className="min-w-0 flex-1 rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2.5 text-sm font-bold text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                      >
                        <option value="">{t("orders.edit.noContact")}</option>
                        {workOrder.customer.contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.role ? ` (${c.role})` : ""}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={INK_SOLID}>
                        {t("orders.detail.saveContact")}
                      </button>
                    </form>

                    <details className={`${SUB_CARD} bg-[var(--paper,#f2efe6)]`}>
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold">
                        {t("orders.detail.newContact")}
                      </summary>
                      <form action={addContactToCustomer} className="space-y-2 border-t border-[var(--line,#d8d3c5)] p-3">
                        <input type="hidden" name="workOrderId" value={workOrder.id} />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input required name="name" placeholder={t("orders.detail.namePlaceholder")} className="rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2 text-sm text-[var(--ink,#131711)]" />
                          <input name="role" placeholder={t("orders.detail.rolePlaceholder")} className="rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2 text-sm text-[var(--ink,#131711)]" />
                          <input type="email" name="email" placeholder={t("orders.detail.emailPlaceholder")} className="rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2 text-sm text-[var(--ink,#131711)]" />
                          <input type="tel" name="phone" placeholder={t("orders.detail.phonePlaceholder")} className="rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2 text-sm text-[var(--ink,#131711)]" />
                        </div>
                        <button type="submit" className={`${INK_SOLID} w-full`}>
                          {t("orders.detail.addAndSelect")}
                        </button>
                      </form>
                    </details>
                  </div>
                )}
              </div>

              <div id="tildel" className={`${CARD} p-4 text-sm`}>
                <h2 className={`${SECTION_TITLE} mb-3 border-b border-[var(--line,#d8d3c5)] pb-2`}>{t("orders.detail.techniciansTitle")}</h2>
                {workOrder.technicians.length > 0 ? (
                  <div className="space-y-2">
                    {workOrder.technicians.map(tech => (
                      <div key={tech.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] p-2.5 font-bold text-[var(--ink,#131711)]">
                        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#628426]" />
                        <span className="min-w-0 flex-1 truncate">{tech.name}</span>
                        {canAssign && (
                          <form action={unassignTechnician} className="flex-shrink-0">
                            <input type="hidden" name="workOrderId" value={workOrder.id} />
                            <input type="hidden" name="technicianId" value={tech.id} />
                            <button type="submit" className="whitespace-nowrap rounded-md border border-[#e7b5ae] bg-white px-2 py-1 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fdf4f2]">
                              {t("orders.detail.remove")}
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="font-bold text-[var(--risk-text,#b42318)]">{t("orders.detail.noTechnicians")}</p>
                )}

                {canAssign && availableTechnicians.length > 0 && (
                  <form action={assignTechnician} className="mt-3 flex flex-col gap-2 border-t border-[var(--line,#d8d3c5)] pt-3">
                    <input type="hidden" name="workOrderId" value={workOrder.id} />
                    <select
                      name="technicianId"
                      required
                      defaultValue=""
                      className="min-w-0 flex-1 rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2.5 text-sm font-bold text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                    >
                      <option value="" disabled>{t("orders.detail.selectTechnician")}</option>
                      {availableTechnicians.map((tech) => (
                        <option key={tech.id} value={tech.id}>
                          {tech.name} ({tech.role === 'ADMIN' ? t("orders.detail.roleAdmin") : tech.role === 'OFFICE' ? t("orders.detail.roleOffice") : t("orders.detail.roleTechnician")})
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={INK_SOLID}>
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

              {/* Kommentarer ligger i sidepanelet sammen med vedlegg. */}
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

            <div className="space-y-4 lg:col-span-2 lg:col-start-1 lg:row-start-1">

              {/* SLA – klokken er beregnet server-side med åpningstider. */}
              {(workOrder.slaClocks?.length ?? 0) > 0 && (
                <div className={`${CARD} p-4 sm:p-5`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#d8d3c5)] pb-2">
                    <h2 className={SECTION_TITLE}>
                      {t("orders.detail.sla.title")}
                    </h2>
                    <span className="text-xs font-bold text-[#5e6356]">
                      {t("orders.detail.sla.hint")}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {workOrder.slaClocks.map((clock) => {
                      const slaNow = new Date();
                      const state = slaStateAt(clock, slaNow);
                      const remaining = slaRemainingMinutes(clock, slaNow);
                      const terminal =
                        Boolean(clock.resolvedAt) ||
                        state === "MET" ||
                        state === "CANCELLED";
                      return (
                        <div
                          key={clock.id}
                          className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-bold">
                              {clock.policy.name}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${
                                SLA_STATE_TONES[state] ??
                                SLA_STATE_TONES.ON_TRACK
                              }`}
                            >
                              {t(SLA_STATE_KEYS[state] ?? SLA_STATE_KEYS.ON_TRACK)}
                            </span>
                          </div>
                          <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                            <div className="flex gap-1.5">
                              <dt className="font-bold text-[#5e6356]">
                                {t("orders.detail.sla.respondBy")}:
                              </dt>
                              <dd>
                                {formatDateTimeLocalized(
                                  clock.respondBy,
                                  locale,
                                  "–",
                                )}
                              </dd>
                            </div>
                            <div className="flex gap-1.5">
                              <dt className="font-bold text-[#5e6356]">
                                {t("orders.detail.sla.resolveBy")}:
                              </dt>
                              <dd>
                                {formatDateTimeLocalized(
                                  clock.resolveBy,
                                  locale,
                                  "–",
                                )}
                              </dd>
                            </div>
                            {clock.respondedAt ? (
                              <div className="flex gap-1.5">
                                <dt className="font-bold text-[#5e6356]">
                                  {t("orders.detail.sla.respondedAt")}:
                                </dt>
                                <dd>
                                  {formatDateTimeLocalized(
                                    clock.respondedAt,
                                    locale,
                                    "–",
                                  )}
                                </dd>
                              </div>
                            ) : null}
                            {clock.resolvedAt ? (
                              <div className="flex gap-1.5">
                                <dt className="font-bold text-[#5e6356]">
                                  {t("orders.detail.sla.resolvedAt")}:
                                </dt>
                                <dd>
                                  {formatDateTimeLocalized(
                                    clock.resolvedAt,
                                    locale,
                                    "–",
                                  )}
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                          {!terminal ? (
                            <p className="mt-1 text-xs font-bold">
                              {remaining >= 0
                                ? t("orders.detail.sla.timeLeft", {
                                    minutes: remaining,
                                  })
                                : t("orders.detail.sla.overdue", {
                                    minutes: Math.abs(remaining),
                                  })}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PLANLEGGING – visittene er kilden til oppdragets datoperiode. */}
              <div id="planlegging" className={`scroll-mt-4 ${CARD} p-4 sm:p-5`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#d8d3c5)] pb-2">
                  <h2 className={SECTION_TITLE}>{t("orders.detail.planning.title")}</h2>
                  <span className="rounded-full border border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] px-2.5 py-1 text-xs font-bold text-[#5e6356]">
                    {t("orders.detail.planning.count", {
                      count: workOrder.visits?.length ?? 0,
                    })}
                  </span>
                </div>
                <p className="mb-3 text-xs font-medium text-[#5e6356]">
                  {t("orders.detail.planning.hint")}
                </p>

                {planningErrorKey && (
                  <div
                    role="alert"
                    className="mb-3 rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] px-3 py-2 text-sm font-bold text-[var(--risk-text,#b42318)]"
                  >
                    {t(planningErrorKey)}
                  </div>
                )}

                {(workOrder.visits?.length ?? 0) === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] p-4">
                    <p className="text-sm font-bold text-[var(--ink,#131711)]">
                      {t("orders.detail.planning.empty")}
                    </p>
                    <p className="mt-1 text-xs font-medium text-[#5e6356]">
                      {t("orders.detail.planning.emptyHint")}
                    </p>
                    {canCreateVisit && (
                      <a href="#ny-visitt" className={`${SIGNAL_BUTTON} mt-3`}>
                        {t("orders.detail.planning.addVisit")}
                      </a>
                    )}
                  </div>
                ) : (
                  <ol className="space-y-3">
                    {(workOrder.visits ?? []).map((visit) => {
                      const lastIncluded = new Date(visit.endsAt.getTime() - 1);
                      const sameDay =
                        dateOnlyInOslo(visit.startsAt) ===
                        dateOnlyInOslo(lastIncluded);
                      const startDateLabel =
                        formatDateLocalized(visit.startsAt, locale, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        }) || t("orders.detail.noDate");
                      const endDateLabel =
                        formatDateLocalized(lastIncluded, locale, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        }) || startDateLabel;
                      const dateLabel =
                        visit.allDay && !sameDay
                          ? `${startDateLabel} – ${endDateLabel}`
                          : startDateLabel;
                      const startTime = visitTimeInput(visit.startsAt);
                      const endTime = visitTimeInput(visit.endsAt);
                      const timeLabel = visit.allDay
                        ? t("orders.detail.planning.allDay")
                        : sameDay
                          ? `${startTime}–${endTime}`
                          : `${startTime} – ${formatDateLocalized(
                              visit.endsAt,
                              locale,
                              { day: "numeric", month: "short" },
                            )} ${endTime}`;
                      const technicians =
                        visit.technicians
                          .map(
                            (technician) =>
                              technician.user.name || technician.user.email,
                          )
                          .filter(Boolean)
                          .join(", ") ||
                        t("orders.detail.planning.noTechnicians");
                      const statusOptionsForVisit = allowedVisitTransitions(
                        visit.status,
                      );
                      const terminal = isTerminalVisitStatus(visit.status);

                      return (
                        <li
                          key={visit.id}
                          className="rounded-xl border border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-black text-[var(--ink,#131711)]">
                                <span>{dateLabel}</span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold tabular-nums">
                                  <Icon name="clock" className="h-3.5 w-3.5" />
                                  {timeLabel}
                                </span>
                                {visit.allDay && (
                                  <span className="rounded-full border border-[var(--line,#d8d3c5)] bg-white px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#5e6356]">
                                    {t("orders.detail.planning.allDayMarker")}
                                  </span>
                                )}
                              </p>
                              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[#5e6356]">
                                <Icon name="users" className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0">{technicians}</span>
                              </p>
                              {visit.notes && (
                                <p className="mt-1 whitespace-pre-wrap text-xs font-medium text-[#3d4237]">
                                  {visit.notes}
                                </p>
                              )}
                            </div>
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${
                                VISIT_STATUS_TONES[visit.status] ??
                                "border-[var(--line,#d8d3c5)] bg-white"
                              }`}
                            >
                              {visitStatusLabel(visit.status)}
                            </span>
                          </div>

                          {(canMoveVisit ||
                            canAssignVisit ||
                            canUpdateVisit ||
                            canDeleteVisit ||
                            (canSetVisitStatus &&
                              statusOptionsForVisit.length > 0)) && (
                            <details className="group mt-3 border-t border-[var(--line,#d8d3c5)] pt-2">
                              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] text-[#5e6356] [&::-webkit-details-marker]:hidden">
                                <span
                                  aria-hidden
                                  className="transition group-open:rotate-90"
                                >
                                  ▸
                                </span>
                                {t("orders.detail.planning.editVisit")}
                              </summary>

                              <div className="space-y-4 pt-2">
                                {canMoveVisit && (
                                  <form action={moveVisit} className="space-y-2">
                                    <input
                                      type="hidden"
                                      name="workOrderId"
                                      value={workOrder.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="visitId"
                                      value={visit.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="allDay"
                                      value={visit.allDay ? "true" : "false"}
                                    />
                                    <p className="text-xs font-black uppercase tracking-wide text-[#5e6356]">
                                      {t("orders.detail.planning.moveVisit")}
                                    </p>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                      <label className="text-xs font-bold text-[#3d4237]">
                                        {t("orders.detail.planning.startDate")}
                                        <input
                                          type="date"
                                          name="startsOn"
                                          required
                                          defaultValue={visitDateInput(visit.startsAt)}
                                          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                                        />
                                      </label>
                                      <label className="text-xs font-bold text-[#3d4237]">
                                        {t("orders.detail.planning.endDate")}
                                        <input
                                          type="date"
                                          name="endsOn"
                                          required={visit.allDay}
                                          defaultValue={
                                            visit.allDay
                                              ? lastIncludedVisitDate(visit.endsAt)
                                              : visitDateInput(visit.endsAt)
                                          }
                                          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                                        />
                                      </label>
                                      {!visit.allDay && (
                                        <>
                                          <label className="text-xs font-bold text-[#3d4237]">
                                            {t("orders.detail.planning.startTime")}
                                            <input
                                              type="time" lang="en-GB"
                                              name="startTime"
                                              required
                                              defaultValue={startTime}
                                              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                                            />
                                          </label>
                                          <label className="text-xs font-bold text-[#3d4237]">
                                            {t("orders.detail.planning.endTime")}
                                            <input
                                              type="time" lang="en-GB"
                                              name="endTime"
                                              required
                                              defaultValue={endTime}
                                              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                                            />
                                          </label>
                                        </>
                                      )}
                                    </div>
                                    <button type="submit" className={INK_SOLID}>
                                      {t("orders.detail.planning.saveMove")}
                                    </button>
                                  </form>
                                )}

                                {canAssignVisit && (
                                  <form
                                    action={assignVisit}
                                    className="space-y-2 border-t border-[var(--line,#d8d3c5)] pt-3"
                                  >
                                    <input
                                      type="hidden"
                                      name="workOrderId"
                                      value={workOrder.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="visitId"
                                      value={visit.id}
                                    />
                                    <p className="text-xs font-black uppercase tracking-wide text-[#5e6356]">
                                      {t("orders.detail.planning.assignVisit")}
                                    </p>
                                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2">
                                      {staffUsers.length === 0 ? (
                                        <p className="px-2 py-2 text-xs italic text-[#5e6356]">
                                          {t("orders.detail.planning.noStaff")}
                                        </p>
                                      ) : (
                                        staffUsers.map((person) => (
                                          <label
                                            key={person.id}
                                            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-[var(--ink,#131711)] transition hover:bg-[var(--paper,#f2efe6)]"
                                          >
                                            <input
                                              type="checkbox"
                                              name="technicianIds"
                                              value={person.id}
                                              defaultChecked={visit.technicians.some(
                                                (technician) =>
                                                  technician.userId === person.id,
                                              )}
                                              className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                                            />
                                            <span className="min-w-0">
                                              {person.name || person.email}
                                            </span>
                                          </label>
                                        ))
                                      )}
                                    </div>
                                    <button type="submit" className={INK_SOLID}>
                                      {t("orders.detail.planning.saveAssign")}
                                    </button>
                                  </form>
                                )}

                                {canUpdateVisit && (
                                  <form
                                    action={updateVisit}
                                    className="space-y-2 border-t border-[var(--line,#d8d3c5)] pt-3"
                                  >
                                    <input
                                      type="hidden"
                                      name="workOrderId"
                                      value={workOrder.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="visitId"
                                      value={visit.id}
                                    />
                                    <p className="text-xs font-black uppercase tracking-wide text-[#5e6356]">
                                      {t("orders.detail.planning.updateVisit")}
                                    </p>
                                    <label className="block text-xs font-bold text-[#3d4237]">
                                      {t("orders.detail.planning.notes")}
                                      <textarea
                                        name="notes"
                                        rows={2}
                                        maxLength={2000}
                                        defaultValue={visit.notes ?? ""}
                                        placeholder={t(
                                          "orders.detail.planning.notesPlaceholder",
                                        )}
                                        className="mt-1 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                                      />
                                    </label>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)]">
                                        <input
                                          type="checkbox"
                                          name="allDay"
                                          defaultChecked={visit.allDay}
                                          className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                                        />
                                        {t("orders.detail.planning.allDay")}
                                      </label>
                                      <label className="text-xs font-bold text-[#3d4237]">
                                        {t("orders.detail.planning.sequence")}
                                        <input
                                          type="number"
                                          name="sequence"
                                          min={0}
                                          step={1}
                                          defaultValue={visit.sequence}
                                          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                                        />
                                      </label>
                                    </div>
                                    <button type="submit" className={INK_SOLID}>
                                      {t("orders.detail.planning.saveVisit")}
                                    </button>
                                  </form>
                                )}

                                {canSetVisitStatus &&
                                  statusOptionsForVisit.length > 0 && (
                                    <form
                                      action={setVisitStatus}
                                      className="flex flex-col gap-2 border-t border-[var(--line,#d8d3c5)] pt-3 sm:flex-row sm:items-end"
                                    >
                                      <input
                                        type="hidden"
                                        name="workOrderId"
                                        value={workOrder.id}
                                      />
                                      <input
                                        type="hidden"
                                        name="visitId"
                                        value={visit.id}
                                      />
                                      <label className="min-w-0 flex-1 text-xs font-bold text-[#3d4237]">
                                        {t("orders.detail.planning.visitStatus")}
                                        <select
                                          name="status"
                                          required
                                          defaultValue=""
                                          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-bold text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                                        >
                                          <option value="" disabled>
                                            {t(
                                              "orders.detail.planning.chooseStatus",
                                            )}
                                          </option>
                                          {statusOptionsForVisit.map((status) => (
                                            <option key={status} value={status}>
                                              {visitStatusLabel(status)}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <button type="submit" className={INK_SOLID}>
                                        {t("orders.detail.planning.updateStatus")}
                                      </button>
                                    </form>
                                  )}

                                {terminal && (
                                  <p className="text-xs font-medium italic text-[#5e6356]">
                                    {t("orders.detail.planning.visitLocked")}
                                  </p>
                                )}

                                {canDeleteVisit && (
                                  <ConfirmSubmitForm
                                    action={deleteVisit}
                                    confirmMessage={t(
                                      "orders.detail.planning.deleteConfirm",
                                    )}
                                    confirmLabel={t(
                                      "orders.detail.planning.deleteVisit",
                                    )}
                                    danger
                                    className="border-t border-[var(--line,#d8d3c5)] pt-3"
                                  >
                                    <input
                                      type="hidden"
                                      name="workOrderId"
                                      value={workOrder.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="visitId"
                                      value={visit.id}
                                    />
                                    <button
                                      type="submit"
                                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#e7b5ae] bg-white px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fdf4f2]"
                                    >
                                      {t("orders.detail.planning.deleteVisit")}
                                    </button>
                                  </ConfirmSubmitForm>
                                )}
                              </div>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {canCreateVisit && (
                  <details
                    id="ny-visitt"
                    open={(workOrder.visits?.length ?? 0) === 0}
                    className={`${SUB_CARD} group mt-3 scroll-mt-4 bg-[var(--paper,#f2efe6)]`}
                  >
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-bold text-[var(--ink,#131711)] [&::-webkit-details-marker]:hidden">
                      <span
                        aria-hidden
                        className="text-[#5e6356] transition group-open:rotate-90"
                      >
                        ▸
                      </span>
                      <Icon name="plus" className="h-4 w-4" />
                      {t("orders.detail.planning.addVisit")}
                    </summary>
                    <form
                      action={createVisit}
                      className="space-y-3 border-t border-[var(--line,#d8d3c5)] p-3"
                    >
                      <input
                        type="hidden"
                        name="workOrderId"
                        value={workOrder.id}
                      />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="text-xs font-bold text-[#3d4237]">
                          {t("orders.detail.planning.startDate")}
                          <input
                            type="date"
                            name="startsOn"
                            required
                            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                          />
                        </label>
                        <label className="text-xs font-bold text-[#3d4237]">
                          {t("orders.detail.planning.endDate")}
                          <input
                            type="date"
                            name="endsOn"
                            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                          />
                        </label>
                        <label className="text-xs font-bold text-[#3d4237]">
                          {t("orders.detail.planning.startTime")}
                          <input
                            type="time" lang="en-GB"
                            name="startTime"
                            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                          />
                        </label>
                        <label className="text-xs font-bold text-[#3d4237]">
                          {t("orders.detail.planning.endTime")}
                          <input
                            type="time" lang="en-GB"
                            name="endTime"
                            className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                          />
                        </label>
                      </div>
                      <p className="text-xs text-[#5e6356]">
                        {t("orders.detail.planning.timeHint")}
                      </p>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 text-sm font-medium text-[var(--ink,#131711)]">
                        <input
                          type="checkbox"
                          name="allDay"
                          className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                        />
                        {t("orders.detail.planning.allDay")}
                      </label>
                      <fieldset>
                        <legend className="text-xs font-bold text-[#3d4237]">
                          {t("orders.detail.planning.technicians")}
                        </legend>
                        <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2">
                          {staffUsers.length === 0 ? (
                            <p className="px-2 py-2 text-xs italic text-[#5e6356]">
                              {t("orders.detail.planning.noStaff")}
                            </p>
                          ) : (
                            staffUsers.map((person) => (
                              <label
                                key={person.id}
                                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-[var(--ink,#131711)] transition hover:bg-[var(--paper,#f2efe6)]"
                              >
                                <input
                                  type="checkbox"
                                  name="technicianIds"
                                  value={person.id}
                                  className="h-4 w-4 shrink-0 rounded accent-[var(--ink,#101310)]"
                                />
                                <span className="min-w-0">
                                  {person.name || person.email}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      </fieldset>
                      <label className="block text-xs font-bold text-[#3d4237]">
                        {t("orders.detail.planning.notes")}
                        <textarea
                          name="notes"
                          rows={2}
                          maxLength={2000}
                          placeholder={t("orders.detail.planning.notesPlaceholder")}
                          className="mt-1 w-full rounded-lg border border-[var(--line,#d8d3c5)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
                        />
                      </label>
                      <button type="submit" className={SIGNAL_BUTTON}>
                        {t("orders.detail.planning.createVisit")}
                      </button>
                    </form>
                  </details>
                )}
              </div>

              <div className={`${CARD} p-4 sm:p-5`}>
                <h2 className={`${SECTION_TITLE} mb-2`}>{t("orders.detail.descriptionTitle")}</h2>
                {workOrder.description ? (
                  <MarkdownView value={workOrder.description} className="font-medium text-[var(--ink,#131711)]" />
                ) : (
                  <p className="text-sm font-medium text-[var(--ink,#131711)]">{t("orders.detail.noDescription")}</p>
                )}
              </div>

              <div className={`${CARD} p-4 sm:p-5`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#d8d3c5)] pb-2">
                  <h2 className={SECTION_TITLE}>{t("orders.detail.checklistsTitle")}</h2>
                  <span className="text-xs font-bold text-[#5e6356]">
                    {t("orders.detail.checklistsCount", {
                      done: workOrder.reports.length,
                      total: workOrder.templates.length,
                    })}
                  </span>
                </div>

                {!isClosed && workOrder.reports.some((report) => report.isLocked) && (
                  <p className="mb-3 rounded-lg border border-[var(--line,#d8d3c5)] bg-[#f3f6e7] px-3 py-2 text-xs font-bold text-[#3f4a1a]">
                    {t("orders.detail.checklistLockedOnly")}
                  </p>
                )}

                {workOrder.templates.length === 0 && workOrder.reports.length === 0 && (
                  <p className="mb-4 text-sm italic text-[#5e6356]">{t("orders.detail.noChecklists")}</p>
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
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-[#3f4a1a]">
                              {t("orders.templateGroups.hms")}
                            </span>
                            <span className="h-px flex-1 bg-[var(--line,#d8d3c5)]" />
                          </div>
                        )}
                        <div className="rounded-lg border border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-2 text-base font-black text-[var(--ink,#131711)]">
                              {template.title}
                              {isHmsTemplate(template) && (
                                <span
                                  className="rounded-full border border-[#b9c99a] bg-[#eef7d6] px-2 py-0.5 text-xs font-black uppercase tracking-wide text-[#283509]"
                                  title={t("orders.templateGroups.hms")}
                                >
                                  {template.hmsType
                                    ? t(HMS_TYPE_MESSAGE_KEYS[template.hmsType])
                                    : t("orders.templateGroups.hmsBadge")}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {report ? (
                                <>
                                  <span className="rounded-full border border-[#b9c99a] bg-[#eef7d6] px-3 py-1 text-xs font-bold text-[#283509]">{t("orders.detail.filled")}</span>
                                  {report.isLocked ? (
                                    <span className="rounded-full border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] px-3 py-1 text-xs font-bold text-[var(--paper,#f2efe6)]">{t("orders.detail.locked")}</span>
                                  ) : (
                                    <span className="rounded-full border border-[#dfc98b] bg-[#fdf5e4] px-3 py-1 text-xs font-bold text-[#6b4808]">{t("orders.detail.unlocked")}</span>
                                  )}
                                  {canViewReports && (
                                    <>
                                      <Link
                                        href={`/rapporter/${workOrder.id}?rapport=${report.id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="whitespace-nowrap rounded-md bg-[var(--ink,#131711)] px-2.5 py-1.5 text-xs font-bold text-[var(--paper,#fbfaf4)] transition hover:opacity-85"
                                      >
                                        {t("orders.detail.openPdf")}
                                      </Link>
                                      <Link
                                        href={`/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}`}
                                        className="whitespace-nowrap rounded-md border border-[var(--line,#d8d3c5)] bg-white px-2.5 py-1.5 text-xs font-bold text-[var(--ink,#131711)] transition hover:border-[var(--ink,#131711)]"
                                      >
                                        {t("orders.detail.revisions", { count: report.revision })}
                                      </Link>
                                    </>
                                  )}
                                  {canWriteReports && canModify && !report.isLocked && (
                                    <Link
                                      href={fillHref}
                                      className="whitespace-nowrap rounded-md border border-[var(--ink,#131711)] bg-white px-2.5 py-1.5 text-xs font-bold text-[var(--ink,#131711)] transition hover:bg-[var(--ink,#131711)] hover:text-[var(--paper,#fbfaf4)]"
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
                                          className="min-w-[12rem] rounded-md border border-[#dfc98b] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ink,#131711)] outline-none focus:border-[#a87816]"
                                        />
                                      )}
                                      <button
                                        type="submit"
                                        className={`whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-bold transition ${
                                          report.isLocked
                                            ? "border-[#dfc98b] bg-[#fdf5e4] text-[#6b4808] hover:border-[#a87816]"
                                            : "border-[var(--line,#d8d3c5)] bg-white text-[var(--ink,#131711)] hover:border-[var(--ink,#131711)]"
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
                                          className="min-w-[12rem] rounded-md border border-[#e7b5ae] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ink,#131711)] outline-none focus:border-[var(--risk,#b42318)]"
                                        />
                                      )}
                                      <button
                                        type="submit"
                                        className={`whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-bold transition ${
                                          report.legalHold
                                            ? "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)] hover:border-[var(--risk,#b42318)]"
                                            : "border-[#dfc98b] bg-white text-[#6b4808] hover:border-[#a87816]"
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
                                  <span className="rounded-full border border-[#dfc98b] bg-[#fdf5e4] px-3 py-1 text-xs font-bold text-[#6b4808]">{t("orders.detail.waitingFill")}</span>
                                  {canWriteReports && canModify && (
                                    <Link
                                      href={fillHref}
                                      className="whitespace-nowrap rounded-md border border-[var(--ink,#131711)] bg-[var(--signal,#c8f135)] px-2.5 py-1.5 text-xs font-black text-[var(--ink,#131711)] transition hover:opacity-85"
                                    >
                                      {t("orders.detail.fillForm")}
                                    </Link>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {report && !report.isLocked && (
                            <div className="mb-3 rounded-lg border border-[#dfc98b] bg-[#fdf5e4] px-3 py-2 text-xs font-bold text-[#6b4808]">
                              {t("orders.detail.unlockedWarning")}
                            </div>
                          )}

                          {report ? (
                            canViewReports ? (
                              <ReportContent report={report} template={template} />
                            ) : (
                              <p className="text-xs italic text-[#5e6356]">
                                {t("orders.detail.reportNoAccess")}
                              </p>
                            )
                          ) : (
                            <p className="text-xs italic text-[#5e6356]">{t("orders.detail.waitingForm")}</p>
                          )}
                        </div>
                        </Fragment>
                      );
                    })}
                  </div>
                )}

                {orphanReports.length > 0 && (
                  <div className="mb-6 space-y-4">
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-[#6b4808]">
                        {t("orders.detail.orphanReport")}
                      </span>
                      <span className="h-px flex-1 bg-[#dfc98b]" />
                    </div>
                    {orphanReports.map((report) => {
                      const summary = reportUnitSummary(report);
                      return (
                        <div
                          key={report.id}
                          className="rounded-lg border border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-2 text-base font-black text-[var(--ink,#131711)]">
                              {reportDisplayName(
                                report,
                                t("orders.reportsPage.defaultTitle"),
                              )}
                              <span className="rounded-full border border-[#dfc98b] bg-[#fdf5e4] px-2 py-0.5 text-xs font-black uppercase tracking-wide text-[#6b4808]">
                                {t("orders.detail.orphanReport")}
                              </span>
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              {report.isLocked ? (
                                <span className="rounded-full bg-[var(--ink,#131711)] px-2.5 py-1 text-xs font-bold text-[var(--paper,#fbfaf4)]">
                                  {t("orders.detail.locked")}
                                </span>
                              ) : (
                                <span className="rounded-full border border-[#dfc98b] bg-[#fdf5e4] px-2.5 py-1 text-xs font-bold text-[#6b4808]">
                                  {t("orders.detail.unlocked")}
                                </span>
                              )}
                              {canViewReports && (
                                <>
                                  <Link
                                    href={`/rapporter/${workOrder.id}?rapport=${report.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="whitespace-nowrap rounded-md bg-[var(--ink,#131711)] px-2.5 py-1.5 text-xs font-bold text-[var(--paper,#fbfaf4)] transition hover:opacity-85"
                                  >
                                    {t("orders.detail.openPdf")}
                                  </Link>
                                  <Link
                                    href={`/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}`}
                                    className="whitespace-nowrap rounded-md border border-[var(--line,#d8d3c5)] bg-white px-2.5 py-1.5 text-xs font-bold text-[var(--ink,#131711)] transition hover:border-[var(--ink,#131711)]"
                                  >
                                    {t("orders.detail.revisions", { count: report.revision })}
                                  </Link>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                            {report.reportNumber && (
                              <span className="rounded-full border border-[var(--line,#d8d3c5)] bg-white px-2.5 py-1 font-bold tracking-wide text-[#5e6356]">
                                {t("orders.detail.report.reportNumber", {
                                  number: report.reportNumber,
                                })}
                              </span>
                            )}
                            <span className="rounded-full border border-[var(--line,#d8d3c5)] bg-white px-2.5 py-1 font-bold text-[#5e6356]">
                              {formatDateLocalized(
                                report.completedAt,
                                locale,
                                undefined,
                                t("orders.reportsPage.noDate"),
                              )}
                            </span>
                            <span className="rounded-full border border-[var(--line,#d8d3c5)] bg-white px-2.5 py-1 font-bold text-[#5e6356]">
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
                            <p className="text-xs italic text-[#5e6356]">
                              {t("orders.detail.reportNoAccess")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {canEdit && availableTemplates.length > 0 && (
                  <div className="border-t border-[var(--line,#d8d3c5)] pt-4">
                    <p className={`${SECTION_TITLE} mb-2`}>{t("orders.detail.requireChecklists")}</p>
                    <form action={setTemplate} className="flex flex-wrap gap-2">
                      <input type="hidden" name="workOrderId" value={workOrder.id} />
                      <select
                        name="templateId"
                        required
                        defaultValue=""
                        className="min-w-[200px] flex-1 rounded-lg border border-[var(--line,#d8d3c5)] bg-white p-2.5 text-sm font-bold text-[var(--ink,#131711)] outline-none focus:border-[var(--ink,#131711)] focus:ring-2 focus:ring-[var(--signal,#c8f135)]"
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
                          <optgroup label={t("orders.templateGroups.hms")}>
                            {availableHmsTemplates.map((template) => (
                              <option key={template.id} value={template.id}>{template.title}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <button type="submit" className={INK_SOLID}>
                        {t("orders.detail.addTemplate")}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Audit log - full width bottom */}
          <div className={`${CARD} p-4 sm:p-5`}>
            <h2 className={`${SECTION_TITLE} mb-3 border-b border-[var(--line,#d8d3c5)] pb-2`}>{t("orders.detail.auditLog")}</h2>
            <AuditLogTable logs={auditLogs} />
          </div>

        </div>

      </div>
    </div>
  );
}
