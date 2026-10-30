import { Fragment } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { WorkStatus, type VisitStatus } from "@prisma/client";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import AuditLogTable from "@/components/AuditLogTable";
import Icon, { type IconName } from "@/components/icons";
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
import {
  dateOnlyInOslo,
  formatDateLocalized,
  formatDateRangeLocalized,
  formatDateTimeLocalized,
} from "@/lib/dates";
import {
  VISIT_STATUS_LABEL_KEYS,
  canTransitionVisit,
  isTerminalVisitStatus,
} from "@/lib/visit-status";
import { idSchema } from "@/lib/schemas/common";
import { parseJsonObject, REPORT_STATUS_DEVIATION } from "@/lib/report-answers";
import { verifiedSubmittedTemplateId } from "@/lib/report-submission";
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
  setVisitStatus,
  updateStatus,
} from "./actions";

/** Field Pulse-flater. Samme verdier som app-skallet, skrevet direkte. */
const FIELD_APP = "field-app";
const FIELD_PANEL =
  "field-card shadow-[0_20px_50px_rgba(0,0,0,0.28)]";
const PAPER_CARD =
  "field-sheet p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-6";
const PAPER_INNER =
  "rounded-xl border border-line bg-white/50 p-3 sm:p-4";
const LIME_BUTTON =
  "signal-button text-sm shadow-sm";
const DARK_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-[#2a3328] bg-white/5 px-3 py-2 text-sm font-bold text-paper transition hover:border-signal/60 hover:bg-white/10";
/** Hurtighandlingene skal alltid være minst 44 px høye på touch. */
const QUICK_ACTION =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#2a3328] bg-white/5 px-3 text-sm font-bold text-paper shadow-sm transition hover:border-signal/60 hover:bg-white/10";

/** Montørens lovlige vei gjennom visitten. Kansellering hører til kontoret. */
const FIELD_VISIT_FLOW: ReadonlyArray<{
  from: readonly VisitStatus[];
  to: VisitStatus;
  labelKey: string;
}> = [
  {
    from: ["PLANNED", "ASSIGNED"],
    to: "EN_ROUTE",
    labelKey: "orders.fieldDetail.visits.startDriving",
  },
  {
    from: ["EN_ROUTE"],
    to: "ON_SITE",
    labelKey: "orders.fieldDetail.visits.onSite",
  },
  {
    from: ["ON_SITE"],
    to: "DONE",
    labelKey: "orders.fieldDetail.visits.complete",
  },
];

const VISIT_ERROR_KEYS: Record<string, string> = {
  overlap: "orders.fieldDetail.visits.errors.overlap",
  invalidTimeRange: "orders.fieldDetail.visits.errors.invalidTimeRange",
  durationTooLong: "orders.fieldDetail.visits.errors.invalidTimeRange",
  invalidTechnician: "orders.fieldDetail.visits.errors.invalidInput",
  invalidInput: "orders.fieldDetail.visits.errors.invalidInput",
  invalidSequence: "orders.fieldDetail.visits.errors.invalidInput",
  legalHold: "orders.fieldDetail.visits.errors.legalHold",
  workOrderLocked: "orders.fieldDetail.visits.errors.workOrderLocked",
  visitLocked: "orders.fieldDetail.visits.errors.visitLocked",
  statusTransition: "orders.fieldDetail.visits.errors.statusTransition",
  noChange: "orders.fieldDetail.visits.errors.noChange",
  forbidden: "orders.fieldDetail.visits.errors.forbidden",
  notFound: "orders.fieldDetail.visits.errors.notFound",
  conflict: "orders.fieldDetail.visits.errors.conflict",
  generic: "orders.fieldDetail.visits.errors.generic",
};

/**
 * Kompakt faktarad i heroen. Verdien er alltid hentet fra oppdraget – aldri
 * et estimat eller en standardverdi som ser ut som ekte data.
 */
function HeroFact({
  icon,
  label,
  value,
  className = "",
}: {
  icon: IconName;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 items-start gap-2 rounded-xl border border-[#2a3328] bg-field/65 px-2.5 py-2 ${className}`}
    >
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-paper/50">
          {label}
        </p>
        <p className="mt-0.5 break-words text-[11px] font-bold leading-snug text-paper/90">
          {value}
        </p>
      </div>
    </div>
  );
}

/**
 * Ekte framdriftsring for sjekklistene. Ringen viser besvarte sjekkpunkter,
 * mens avvik og kladdestatus står ved siden av. Den er en progressbar for
 * skjermlesere, ikke bare en dekorativ grafikk.
 */
function ChecklistProgressRing({
  answered,
  total,
  deviations,
  percent,
  label,
  valueText,
  deviationLabel,
  draftLabel,
  hasDraft,
}: {
  answered: number;
  total: number;
  deviations: number;
  percent: number;
  label: string;
  valueText: string;
  deviationLabel: string;
  draftLabel: string;
  hasDraft: boolean;
}) {
  const size = 84;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={answered}
      aria-valuetext={valueText}
      aria-label={label}
      className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-white/45 p-3 sm:gap-4 sm:p-4"
    >
      <div className="relative shrink-0" aria-hidden>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--line)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={deviations > 0 ? "var(--risk)" : "var(--success)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percent / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-black leading-none text-ink">
            {percent}%
          </span>
          <span className="mt-0.5 text-[10px] font-bold text-muted">
            {answered}/{total}
          </span>
        </span>
      </div>

      <div className="min-w-0 space-y-1">
        <p className="text-sm font-black leading-snug text-ink">{label}</p>
        <p
          className={`flex items-center gap-1.5 text-xs font-bold ${
            deviations > 0 ? "text-risk" : "text-muted"
          }`}
        >
          <Icon
            name={deviations > 0 ? "alert" : "check"}
            className="h-3.5 w-3.5"
          />
          {deviationLabel}
        </p>
        <p
          className={`flex items-center gap-1.5 text-xs font-bold ${
            hasDraft ? "text-success" : "text-muted"
          }`}
        >
          <Icon name="clock" className="h-3.5 w-3.5" />
          {draftLabel}
        </p>
      </div>
    </div>
  );
}

type ProgressUnit = {
  status?: string | null;
  answers?: Record<string, unknown>;
  answersJson?: string | null;
};

/** Felt-ID-ene i en mal, brukt til å telle besvarte sjekkpunkter. */
function templateFieldIds(fieldsJson: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(fieldsJson || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((field) =>
      field && typeof field === "object" && typeof field.id === "string"
        ? [field.id]
        : [],
    );
  } catch {
    return [];
  }
}

function unitAnswers(unit: ProgressUnit): Record<string, unknown> {
  return unit.answers ?? parseJsonObject(unit.answersJson);
}

/** Teller felter med en faktisk verdi, på tvers av alle enhetene i malen. */
function countAnswered(
  fieldIds: string[],
  units: ProgressUnit[],
): number {
  let answered = 0;
  for (const unit of units) {
    const answers = unitAnswers(unit);
    for (const fieldId of fieldIds) {
      const value = answers[fieldId];
      if (
        value !== undefined &&
        value !== null &&
        (typeof value === "string" ? value.trim() !== "" : true)
      ) {
        answered += 1;
      }
    }
  }
  return answered;
}

function draftUnits(dataJson: string): ProgressUnit[] {
  const parsed = parseJsonObject(dataJson);
  return Array.isArray(parsed.units)
    ? (parsed.units.filter(
        (unit): unit is ProgressUnit =>
          Boolean(unit) && typeof unit === "object",
      ) as ProgressUnit[])
    : [];
}

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
    visitOk?: string;
    visitError?: string;
  }>;
}) {
  const { error, reportSubmitted, removed, restored, visitOk, visitError } =
    await searchParams;

  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;

  const t = await getTranslations("common");
  const locale = await getLocale();
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
      reports: { include: { units: { orderBy: { sortOrder: "asc" } } } },
      reportDrafts: { where: { userId: user.id } },
      tags: true,
      workComments: { orderBy: { createdAt: "desc" } },
      attachments: { orderBy: { id: "desc" } },
      product: true,
      technicians: true,
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
      <div className={`min-h-screen ${FIELD_APP} flex flex-col items-center justify-center p-4 pb-32 sm:p-6`}>
        <div className="field-sheet w-full max-w-lg p-6 text-center shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
          <h1 className="text-2xl font-black text-ink mb-2">{t("orders.fieldDetail.notFoundTitle")}</h1>
          <p className="text-muted mb-4">{t("orders.fieldDetail.notFoundText")}</p>
          <Link href="/mine-oppdrag" className={LIME_BUTTON}>
            {t("orders.fieldDetail.backToOverview")}
          </Link>
        </div>
      </div>
    );
  }

  // Kansellerte oppdrag er avsluttet og skal ikke vises i feltportalen.
  // De finnes fortsatt som historikk på kundesiden.
  if (workOrder.status === "CANCELLED") redirect("/mine-oppdrag");

  // En kvittering krever en faktisk låst rapport for denne malen. En gjettet
  // query-parameter skal verken rydde kladder eller vise suksessbanneret.
  const reportSubmittedVerified = verifiedSubmittedTemplateId(
    reportSubmitted,
    workOrder.reports,
  );

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
  const allChecklistsLocked =
    orderedTemplates.length > 0 &&
    orderedTemplates.every(
      (template) => reportsByTemplate.get(template.id)?.isLocked === true,
    );
  const doneChecklists = orderedTemplates.filter((template) =>
    reportsByTemplate.has(template.id),
  ).length;
  // Kladden avgjør om CTA-en skal si «Fortsett» eller «Start» for akkurat den
  // sjekklisten CTA-en peker på – ikke om en helt annen sjekkliste er fylt ut.
  const draftsByTemplate = new Map(
    (workOrder.reportDrafts ?? []).map((draft) => [draft.templateId, draft]),
  );
  const hasChecklistDraft = orderedTemplates.some((template) =>
    draftsByTemplate.has(template.id),
  );
  const canOpenChecklist = canWriteReports && canUpdate;
  const nextReport = nextTemplate
    ? reportsByTemplate.get(nextTemplate.id)
    : undefined;
  const nextDraft = nextTemplate
    ? draftsByTemplate.get(nextTemplate.id)
    : undefined;
  const stickyAction =
    canOpenChecklist && nextTemplate
      ? {
          href: `/mine-oppdrag/${workOrderId}/skjema/${nextTemplate.id}`,
          label:
            nextReport || nextDraft
              ? t("orders.fieldDetail.stickyContinueForm")
              : t("orders.fieldDetail.stickyStartForm"),
          complete: false,
        }
      : !isClosed && canUpdate
        ? {
            href: "#status",
            label: allChecklistsLocked
              ? t("orders.workOrderForm.title")
              : t("orders.fieldDetail.stickyComplete"),
            complete: true,
          }
        : null;

  // Dagens eller neste visitt. Åpne visiter går foran avsluttede, slik at en
  // nettopp fullført formiddagsvisitt ikke skjuler ettermiddagens jobb.
  const now = new Date();
  const todayIso = dateOnlyInOslo(now);
  const nonCancelledVisits = (workOrder.visits ?? []).filter(
    (visit) => visit.status !== "CANCELLED",
  );
  const openVisits = nonCancelledVisits.filter(
    (visit) => !isTerminalVisitStatus(visit.status),
  );
  const visitCandidates = openVisits.length > 0 ? openVisits : nonCancelledVisits;
  const currentVisit =
    visitCandidates.find((visit) => visit.endsAt >= now) ??
    visitCandidates[0] ??
    null;
  const currentVisitLastDay = currentVisit
    ? dateOnlyInOslo(new Date(currentVisit.endsAt.getTime() - 1))
    : "";
  const currentVisitIsToday = Boolean(
    currentVisit &&
      dateOnlyInOslo(currentVisit.startsAt) <= todayIso &&
      currentVisitLastDay >= todayIso,
  );
  const currentVisitDate =
    currentVisit && currentVisit.allDay
      ? currentVisitLastDay &&
        dateOnlyInOslo(currentVisit.startsAt) !== currentVisitLastDay
        ? `${formatDateLocalized(currentVisit.startsAt, locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })} – ${formatDateLocalized(new Date(currentVisit.endsAt.getTime() - 1), locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}`
        : formatDateLocalized(currentVisit.startsAt, locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
      : currentVisit
        ? formatDateLocalized(currentVisit.startsAt, locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : "";
  const currentVisitStartTime = currentVisit
    ? formatDateLocalized(currentVisit.startsAt, locale, { timeStyle: "short", hourCycle: "h23" })
    : "";
  const currentVisitEndTime = currentVisit
    ? formatDateLocalized(currentVisit.endsAt, locale, { timeStyle: "short", hourCycle: "h23" })
    : "";
  const currentVisitSameDay = Boolean(
    currentVisit &&
      dateOnlyInOslo(currentVisit.startsAt) === currentVisitLastDay,
  );
  const currentVisitTime = !currentVisit
    ? ""
    : currentVisit.allDay
      ? t("orders.fieldDetail.visits.allDay")
      : currentVisitSameDay
        ? `${currentVisitStartTime}–${currentVisitEndTime}`
        : `${currentVisitStartTime} – ${formatDateLocalized(
            currentVisit.endsAt,
            locale,
            { day: "numeric", month: "short" },
          )} ${currentVisitEndTime}`;
  const currentVisitTechnicians =
    currentVisit?.technicians
      .map((technician) => technician.user.name || technician.user.email)
      .filter(Boolean)
      .join(", ") || "";
  const currentVisitNextStep = currentVisit
    ? (FIELD_VISIT_FLOW.find(
        (step) =>
          step.from.includes(currentVisit.status) &&
          canTransitionVisit(currentVisit.status, step.to),
      ) ?? null)
    : null;
  const currentVisitTerminal = currentVisit
    ? isTerminalVisitStatus(currentVisit.status)
    : false;
  const visitErrorKey = visitError
    ? (VISIT_ERROR_KEYS[visitError] ?? VISIT_ERROR_KEYS.generic)
    : "";

  // Framdrift for sjekklistene. Signerte rapporter vinner over en eventuell
  // gammel kladd, slik at tellingen alltid viser det som faktisk er lagret.
  let answeredCheckpoints = 0;
  let totalCheckpoints = 0;
  let deviationCheckpoints = 0;
  for (const template of orderedTemplates) {
    const fieldIds = templateFieldIds(template.fieldsJson);
    const report = reportsByTemplate.get(template.id);
    const draft = draftsByTemplate.get(template.id);
    const units: ProgressUnit[] =
      report?.units?.length
        ? report.units
        : draft && typeof draft.dataJson === "string"
          ? draftUnits(draft.dataJson)
          : [];
    const unitCount = Math.max(units.length, 1);
    totalCheckpoints += fieldIds.length * unitCount;
    answeredCheckpoints += countAnswered(fieldIds, units);
    deviationCheckpoints += units.filter(
      (unit) => unit.status === REPORT_STATUS_DEVIATION,
    ).length;
  }
  const checklistPercent =
    totalCheckpoints > 0
      ? Math.round((answeredCheckpoints / totalCheckpoints) * 100)
      : 0;

  // Hurtighandlinger med ekte lenker – telefon, kart, kunde, utstyr og
  // dokumentbiblioteket. Handlinger uten data skjules i stedet for å vises
  // som døde knapper.
  const contactPhone =
    workOrder.contact?.phone ||
    workOrder.customer?.contacts?.find((contact) => contact.phone)?.phone ||
    workOrder.customer?.phone ||
    null;
  const mapQuery = [
    workOrder.address || workOrder.customer?.address,
    workOrder.postalCode || workOrder.customer?.postalCode,
    workOrder.city || workOrder.customer?.city,
  ]
    .filter(Boolean)
    .join(", ");
  const mapsHref = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;
  const customerHref =
    workOrder.customer?.id && hasPermission(user, "customers.view")
      ? `/kunder/${workOrder.customer.id}`
      : null;
  const unitHref =
    hasPermission(user, "equipment.view") && workOrder.productId
      ? `/enheter/${workOrder.productId}`
      : hasPermission(user, "equipment.view") && workOrder.customer?.id
        ? `/kunder/${workOrder.customer.id}?tab=utstyr`
        : null;
  const documentsHref = hasPermission(user, "documents.view")
    ? `/dokumenter?q=${encodeURIComponent(workOrder.title)}`
    : null;

  // Heroen viser bare verdier som faktisk finnes på oppdraget. Manglende
  // opplysninger får en nøytral «ikke oppgitt»-tekst i stedet for oppdiktede
  // standardverdier.
  const missingValue = t("orders.fieldDetail.addressUnknown");
  const heroAddress = mapQuery || missingValue;
  const heroCustomer =
    workOrder.customer?.name || t("orders.fieldDetail.internalOrder");
  const heroContact =
    workOrder.contact?.name ||
    workOrder.customer?.contacts?.[0]?.name ||
    t("orders.fieldDetail.noContact");
  const heroTechnicians =
    workOrder.technicians.length > 0
      ? workOrder.technicians.map((tech) => tech.name).join(", ")
      : t("orders.fieldDetail.noPersonnel");
  const checklistCountLabel = t("orders.detail.checklistsCount", {
    done: doneChecklists,
    total: orderedTemplates.length,
  });

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
    <div className={`min-h-screen ${FIELD_APP} p-4 pb-48 sm:p-6 sm:pb-10`}>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* HEADER – mørk jobbflate med status, kunde og dato. */}
        <header className="field-hero relative overflow-hidden p-5 shadow-[0_24px_70px_rgba(0,0,0,0.35)] sm:p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-signal/15 blur-3xl"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-signal/25 bg-field px-3 py-1 text-[11px] font-black uppercase tracking-wider text-signal">
                <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                {statusLabels[workOrder.status]}
              </span>
              <Link href="/mine-oppdrag" className={DARK_BUTTON}>
                {t("orders.fieldDetail.back")}
              </Link>
            </div>

            <h1 className="mt-4 text-2xl font-black leading-tight tracking-tight text-paper sm:text-3xl">
              {workOrder.title}
            </h1>
            <div className="mt-2 space-y-1 text-sm font-bold text-paper/90">
              <p className="flex items-start gap-2">
                <Icon name="building" className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                <span className="min-w-0 break-words">{heroCustomer}</span>
              </p>
              <p className="flex items-start gap-2 text-paper/75">
                <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                <span className="min-w-0 break-words">{heroAddress}</span>
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1 text-paper/80">
                <Icon name="building" className="h-3.5 w-3.5 text-signal" />
                {workOrder.department.name}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <HeroFact
                icon="file"
                label={t("orders.list.orderNumber")}
                value={workOrder.orderNumber || missingValue}
              />
              <HeroFact
                icon="clock"
                label={t("orders.fieldDetail.scheduledDate")}
                value={
                  formatDateRangeLocalized(
                    workOrder.scheduledFor,
                    workOrder.scheduledTo,
                    locale,
                  ) || t("orders.fieldDetail.noDate")
                }
              />
              <HeroFact
                icon="users"
                label={t("orders.detail.techniciansTitle")}
                value={heroTechnicians}
              />
              <HeroFact
                icon="user"
                label={t("orders.detail.contact")}
                value={heroContact}
              />
              <HeroFact
                icon="list"
                label={t("orders.detail.checklistsTitle")}
                value={checklistCountLabel}
                className="col-span-2 sm:col-span-1"
              />
            </div>

            {workOrder.tags && workOrder.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {workOrder.tags.map((tag: any) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 text-white px-2.5 py-1 rounded-full text-xs font-bold shadow-sm"
                    suppressHydrationWarning
                    style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
                  >
                    <Icon name="flag" className="h-3 w-3" />
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </header>

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

        {reportSubmittedVerified && (
          <ReportSubmissionCleanup
            userId={user.id}
            workOrderId={workOrderId}
            templateId={reportSubmittedVerified}
            verified
          />
        )}

        {/* HURTIGHANDLINGER – telefon, kart og de viktigste detaljsidene. */}
        {(contactPhone ||
          mapsHref ||
          customerHref ||
          unitHref ||
          documentsHref) && (
          <div className={`${FIELD_PANEL} p-4 sm:p-5`}>
            <h2 className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-paper/60">
              {t("orders.fieldDetail.quickActions")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {contactPhone && (
                <a
                  href={`tel:${contactPhone}`}
                  aria-label={t("orders.fieldDetail.callContact")}
                  className={QUICK_ACTION}
                >
                  <Icon name="phone" className="h-4 w-4 text-signal" />
                  {t("orders.fieldDetail.callContact")}
                </a>
              )}
              {mapsHref && (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={QUICK_ACTION}
                >
                  <Icon name="navigation" className="h-4 w-4 text-signal" />
                  {t("orders.fieldDetail.map")}
                  <span className="sr-only"> ({t("orders.fieldDetail.newTab")})</span>
                </a>
              )}
              {customerHref && (
                <Link href={customerHref} className={QUICK_ACTION}>
                  <Icon name="building" className="h-4 w-4 text-signal" />
                  {t("orders.fieldDetail.customer")}
                </Link>
              )}
              {unitHref && (
                <Link href={unitHref} className={QUICK_ACTION}>
                  <Icon name="wrench" className="h-4 w-4 text-signal" />
                  {t("orders.fieldDetail.unit")}
                </Link>
              )}
              {documentsHref && (
                <Link href={documentsHref} className={QUICK_ACTION}>
                  <Icon name="folder" className="h-4 w-4 text-signal" />
                  {t("orders.fieldDetail.documents")}
                </Link>
              )}
            </div>
          </div>
        )}

        {/* STATUS & DATO – mørk statusflate under hurtighandlingene. */}
        <div id="status" className={`scroll-mt-4 ${FIELD_PANEL} p-4 sm:p-6`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">

            <div>
              <p className="text-xs font-black text-paper/60 uppercase tracking-wider mb-2">{t("orders.fieldDetail.statusTitle")}</p>
              {isClosed ? (
                <p className="text-sm text-paper/70 italic">
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
                      aria-label={t("orders.fieldDetail.statusTitle")}
                      className="border-2 border-[#2a3328] p-2.5 rounded-xl text-base sm:text-sm font-bold text-ink bg-paper outline-none focus:border-signal min-w-[180px] min-h-11"
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
                      className="status-submit-disabled min-h-11 bg-white/10 text-paper/70 px-4 py-2.5 rounded-xl text-sm font-bold transition whitespace-nowrap"
                    >
                      {t("orders.fieldDetail.update")}
                    </SubmitButton>
                    <SubmitButton
                      disabled={statusOptions.length === 0}
                      pendingLabel={t("orders.fieldDetail.updating")}
                      className="status-submit-ready signal-button text-sm whitespace-nowrap"
                    >
                      {t("orders.fieldDetail.update")}
                    </SubmitButton>
                  </ConfirmSubmitForm>
                  {canCancelNow && (
                    <details className="mt-2 rounded-xl border border-risk/40 bg-risk/10 p-2">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-bold text-risk [&::-webkit-details-marker]:hidden">
                        {t("orders.fieldDetail.moreActions")}
                      </summary>
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
                          className="min-h-11 border-2 border-risk/40 bg-risk/10 text-risk px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-risk/15 transition whitespace-nowrap"
                        >
                          {t("orders.fieldDetail.cancelWorkOrder")}
                        </SubmitButton>
                      </ConfirmSubmitForm>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-sm text-paper/70 italic">
                  {t("orders.fieldDetail.noStatusPermission")}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-black text-paper/60 uppercase tracking-wider mb-2">{t("orders.fieldDetail.scheduledDate")}</p>
              <p className="flex items-center gap-2 font-bold text-paper bg-field p-2.5 border-2 border-[#2a3328] rounded-xl w-full">
                <Icon name="clock" className="h-4 w-4 shrink-0 text-signal" />
                {formatDateRangeLocalized(workOrder.scheduledFor, workOrder.scheduledTo, locale) || t("orders.fieldDetail.noDate")}
              </p>
            </div>

          </div>
        </div>

        {/* VISITT – dagens eller neste planlagte tidsrom. Statusflyten her er
            visitens egen og blandes ikke med oppdragets status. */}
        <div id="visitt" className={`scroll-mt-4 ${FIELD_PANEL} p-4 sm:p-6`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-paper/60">
                {t(
                  currentVisitIsToday
                    ? "orders.fieldDetail.visits.todayTitle"
                    : "orders.fieldDetail.visits.nextTitle",
                )}
              </p>
              {currentVisit ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-paper">
                  <span className="capitalize">{currentVisitDate}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-sm font-black tabular-nums text-signal">
                    <Icon name="clock" className="h-3.5 w-3.5" />
                    {currentVisitTime}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-sm font-bold text-paper/80">
                  {t("orders.fieldDetail.visits.empty")}
                </p>
              )}
            </div>
            {currentVisit && (
              <span className="inline-flex items-center rounded-full border border-signal/25 bg-field px-3 py-1 text-xs font-black uppercase tracking-wide text-signal">
                {t(VISIT_STATUS_LABEL_KEYS[currentVisit.status])}
              </span>
            )}
          </div>

          <div
            aria-live="polite"
            role="status"
            className={`mt-3 text-sm font-bold ${
              visitErrorKey ? "text-risk" : "text-signal"
            }`}
          >
            {visitErrorKey
              ? t(visitErrorKey)
              : visitOk
                ? t("orders.fieldDetail.visits.statusUpdated")
                : ""}
          </div>

          {currentVisit && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <p className="flex items-start gap-2 rounded-xl border border-[#2a3328] bg-field/65 px-3 py-2 font-medium text-paper/90">
                  <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                  <span className="min-w-0">{heroAddress}</span>
                </p>
                <p className="flex items-start gap-2 rounded-xl border border-[#2a3328] bg-field/65 px-3 py-2 font-medium text-paper/90">
                  <Icon name="users" className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                  <span className="min-w-0">
                    {currentVisitTechnicians ||
                      t("orders.fieldDetail.visits.noTechnicians")}
                  </span>
                </p>
              </div>

              {currentVisit.notes && (
                <p className="whitespace-pre-wrap rounded-xl border border-[#2a3328] bg-white/5 px-3 py-2 text-sm font-medium text-paper/80">
                  {currentVisit.notes}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {canUpdate && !isClosed && currentVisitNextStep ? (
                  <form action={setVisitStatus}>
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <input type="hidden" name="visitId" value={currentVisit.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={currentVisitNextStep.to}
                    />
                    <SubmitButton
                      pendingLabel={t("orders.fieldDetail.updating")}
                      className="signal-button min-h-11 text-sm shadow-sm"
                    >
                      {t(currentVisitNextStep.labelKey)}
                    </SubmitButton>
                  </form>
                ) : currentVisitTerminal ? (
                  <p className="text-sm font-medium italic text-paper/70">
                    {t("orders.fieldDetail.visits.locked")}
                  </p>
                ) : !canUpdate ? (
                  <p className="text-sm font-medium italic text-paper/70">
                    {t("orders.fieldDetail.noStatusPermission")}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* SJEKKLISTER – papirark på mørk bunn, høyt opp. */}
        <div className={PAPER_CARD}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
            <h2 className="font-black text-lg text-ink">{t("orders.fieldDetail.checklistsTitle")}</h2>
            {stickyAction && (
              <div className="hidden sm:block">
                <Link href={stickyAction.href} className={LIME_BUTTON}>
                  {stickyAction.label}
                  <Icon
                    name={stickyAction.complete ? "check" : "arrowRight"}
                    className="h-4 w-4"
                  />
                </Link>
              </div>
            )}
          </div>

          {totalCheckpoints > 0 && (
            <ChecklistProgressRing
              answered={answeredCheckpoints}
              total={totalCheckpoints}
              deviations={deviationCheckpoints}
              percent={checklistPercent}
              label={t("orders.fieldDetail.checklistProgress", {
                answered: answeredCheckpoints,
                total: totalCheckpoints,
              })}
              valueText={[
                t("orders.fieldDetail.checklistProgress", {
                  answered: answeredCheckpoints,
                  total: totalCheckpoints,
                }),
                t("orders.fieldDetail.checklistDeviations", {
                  count: deviationCheckpoints,
                }),
              ].join(", ")}
              deviationLabel={t("orders.fieldDetail.checklistDeviations", {
                count: deviationCheckpoints,
              })}
              draftLabel={
                hasChecklistDraft
                  ? t("orders.fieldDetail.checklistDraftSaved")
                  : t("orders.fieldDetail.checklistDraftMissing")
              }
              hasDraft={hasChecklistDraft}
            />
          )}

          {workOrder.templates.length === 0 ? (
            <p className="text-sm text-muted italic mb-4">{t("orders.fieldDetail.noChecklists")}</p>
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
                      <span className="inline-flex items-center gap-1.5 text-xs font-black text-indigo-900 uppercase tracking-wider">
                        <Icon name="flag" className="h-3.5 w-3.5" />
                        {t("orders.templateGroups.hms")}
                      </span>
                      <span className="h-px flex-1 bg-indigo-200" />
                    </div>
                  )}
                  <div className={`flex flex-wrap justify-between items-center gap-3 p-3 sm:p-4 rounded-xl border-2 transition ${report ? 'bg-signal/20 border-success/30' : 'bg-white/50 border-line'}`}>
                    <span className={`font-bold text-sm ${report ? 'text-ink' : 'text-ink'} flex items-center gap-2 flex-wrap`}>
                      {template.title}
                      {isHmsTemplate(template) && (
                        <span className="inline-flex items-center gap-1 bg-white/10 text-paper border border-white/20 text-xs font-black px-2 py-0.5 rounded-full uppercase tracking-wide">
                          <Icon name="flag" className="h-3 w-3" />
                          {template.hmsType
                            ? t(HMS_TYPE_MESSAGE_KEYS[template.hmsType])
                            : t("orders.templateGroups.hmsBadge")}
                        </span>
                      )}
                      {canViewReports && report?.reportNumber && (
                        <span className="bg-white text-ink border border-line text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("orders.fieldDetail.reportNumber", {
                            number: report.reportNumber,
                          })}
                        </span>
                      )}
                      {report?.isLocked && (
                        <span className="bg-white/5 text-paper text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("orders.fieldDetail.locked")}
                        </span>
                      )}
                      {report && !report.isLocked && (
                        <span className="bg-signal/10 text-warning border border-warning/40 text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("orders.fieldDetail.unlocked")}
                        </span>
                      )}
                    </span>

                    {report ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        {canViewReports && (
                          <Link
                            href={`/rapporter/${workOrderId}?rapport=${report.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ink-button text-xs shadow-sm whitespace-nowrap"
                          >
                            {t("orders.fieldDetail.openReport")}
                          </Link>
                        )}
                        {canWriteReports && canUpdate && !report.isLocked && (
                          <Link
                            href={`/mine-oppdrag/${workOrderId}/skjema/${template.id}`}
                            className="signal-button text-xs shadow-sm whitespace-nowrap"
                          >
                            {t("orders.fieldDetail.edit")}
                          </Link>
                        )}
                      </div>
                    ) : canWriteReports && canUpdate ? (
                      <Link
                        href={`/mine-oppdrag/${workOrderId}/skjema/${template.id}`}
                        className="signal-button text-xs shadow-sm whitespace-nowrap"
                      >
                        {t("orders.fieldDetail.fillForm")}
                      </Link>
                    ) : (
                      <span className="text-xs font-bold text-muted">
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
            <details className="border-t border-line pt-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-black uppercase tracking-wider text-muted [&::-webkit-details-marker]:hidden">
                <Icon name="plus" className="h-4 w-4" />
                {t("orders.fieldDetail.extraChecklist")}
              </summary>
              <form action={addTemplate} className="mt-2 flex gap-2 flex-wrap">
                <input type="hidden" name="workOrderId" value={workOrderId} />
                <select
                  name="templateId"
                  required
                  defaultValue=""
                  aria-label={t("orders.fieldDetail.extraChecklist")}
                  className="border-2 border-line p-2.5 rounded-xl text-base font-bold text-ink bg-white flex-1 outline-none shadow-sm min-w-[200px] min-h-11 sm:text-sm"
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
                    <optgroup label={t("orders.templateGroups.hms")}>
                      {availableHmsTemplates.map((template) => (
                        <option key={template.id} value={template.id}>{template.title}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button type="submit" className={`${DARK_BUTTON} whitespace-nowrap`}>
                  {t("orders.fieldDetail.add")}
                </button>
              </form>
            </details>
          )}
        </div>

        {/* ARBEIDSBESKRIVELSE */}
        <div className={PAPER_CARD}>
          <h2 className="text-xs font-black text-muted uppercase tracking-wider mb-2">{t("orders.fieldDetail.descriptionTitle")}</h2>
          <div className={PAPER_INNER}>
            {workOrder.description ? (
              <MarkdownView value={workOrder.description} className="text-ink font-medium" />
            ) : (
              <p className="text-sm text-muted font-medium">
                {t("orders.fieldDetail.noDescription")}
              </p>
            )}
          </div>
        </div>

        {/* KOMMENTARER / LOGG – editoren er kollapset bak en knapp. */}
        <div className={`${PAPER_CARD} space-y-4`}>
          <h2 className="font-black text-lg text-ink border-b border-line pb-2">{t("orders.fieldDetail.commentsTitle")}</h2>

          {canUpdate && (
            <details className="rounded-xl">
              <summary className="ink-button cursor-pointer list-none text-sm shadow-sm [&::-webkit-details-marker]:hidden">
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
                  <button type="submit" className="signal-button text-sm shadow-sm whitespace-nowrap">
                    {t("orders.fieldDetail.addComment")}
                  </button>
                </div>
              </form>
            </details>
          )}

          {/* Liste over tidligere kommentarer */}
          <div className="space-y-3 pt-4 border-t border-line">
            {workOrder.workComments.length === 0 ? (
              <p className="text-sm text-muted italic">{t("orders.fieldDetail.noComments")}</p>
            ) : (
              workOrder.workComments.map((comment: any) => (
                <div key={comment.id} className="bg-white/50 p-3 sm:p-4 rounded-xl border border-line space-y-1">
                  <div className="flex justify-between items-center text-xs text-muted font-bold">
                    <span>{comment.authorName || t("orders.fieldDetail.unknownAuthor")}</span>
                    <span>{formatDateTimeLocalized(comment.createdAt, locale)}</span>
                  </div>
                  <div className="text-sm text-ink font-medium">
                    <MarkdownView value={comment.content} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* TILDELTE MONTØRER & KONTOR */}
        <div className={`${PAPER_CARD} space-y-4`}>
          <h2 className="font-black text-lg text-ink border-b border-line pb-2">{t("orders.fieldDetail.personnelTitle")}</h2>

          <div className="space-y-2">
            {workOrder.technicians.length === 0 ? (
              <p className="text-sm text-risk font-bold">{t("orders.fieldDetail.noPersonnel")}</p>
            ) : (
              <div className="space-y-2">
                {workOrder.technicians.map((tech: any) => (
                  <div key={tech.id} className="flex justify-between items-center bg-white/50 p-3 rounded-xl border border-line gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-success flex-shrink-0"></span>
                      <div className="min-w-0">
                        <p className="font-black text-ink text-sm truncate">{tech.name} {tech.id === user.id ? <span className="text-xs text-success">{t("orders.fieldDetail.you")}</span> : ""}</p>
                        <p className="text-xs text-muted">{tech.role === 'ADMIN' ? t("orders.fieldDetail.roleAdmin") : tech.role === 'OFFICE' ? t("orders.fieldDetail.roleOffice") : t("orders.fieldDetail.roleTechnician")}</p>
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
            <details className="border-t border-line pt-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-black uppercase tracking-wider text-muted [&::-webkit-details-marker]:hidden">
                <Icon name="plus" className="h-4 w-4" />
                {t("orders.fieldDetail.addPersonnel")}
              </summary>
              <form action={addTechnician} className="mt-2 flex gap-2 flex-wrap">
                <input type="hidden" name="workOrderId" value={workOrderId} />
                <select
                  name="userId"
                  required
                  defaultValue=""
                  aria-label={t("orders.fieldDetail.addPersonnel")}
                  className="border-2 border-line p-2.5 rounded-xl text-base font-bold text-ink bg-white flex-1 outline-none shadow-sm min-w-[200px] min-h-11 sm:text-sm"
                >
                  <option value="" disabled>{t("orders.fieldDetail.selectPerson")}</option>
                  {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role === 'ADMIN' ? t("orders.fieldDetail.roleAdmin") : u.role === 'OFFICE' ? t("orders.fieldDetail.roleOffice") : u.role === 'TECHNICIAN' ? t("orders.fieldDetail.roleTechnician") : u.role === 'CUSTOMER' ? t("orders.fieldDetail.roleCustomer") : t("orders.fieldDetail.roleStandard")})</option>
                  ))}
                </select>
                <button type="submit" className={`${DARK_BUTTON} whitespace-nowrap`}>
                  {t("orders.fieldDetail.add")}
                </button>
              </form>
            </details>
          )}
        </div>

        {/* LOKASJON & KONTAKTPERSON */}
        <div className={PAPER_CARD}>
          <h2 className="font-black text-lg text-ink mb-4 border-b border-line pb-2">{t("orders.fieldDetail.locationTitle")}</h2>
          <div className="text-sm text-ink space-y-4">
            <div>
              <p className="text-ink">
                <strong>{t("orders.fieldDetail.address")}</strong>{" "}
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
                  <a href={`tel:${workOrder.customer?.phone}`} className="inline-flex min-h-11 items-center text-success font-bold hover:underline">{workOrder.customer?.phone}</a>
                </p>
              )}
            </div>

            {workOrder.contact ? (
              <div className="bg-white/50 p-3 sm:p-4 rounded-xl border border-line">
                <p className="text-xs font-black text-muted uppercase tracking-wider mb-1">{t("orders.fieldDetail.contactTitle")}</p>
                <p className="font-black text-ink text-base">{workOrder.contact.name}</p>
                <div className="mt-2 space-y-1 text-sm">
                  {workOrder.contact.phone && <p className="flex items-center gap-2"><Icon name="phone" className="h-4 w-4 shrink-0 text-success" /><a href={`tel:${workOrder.contact.phone}`} className="inline-flex min-h-11 items-center text-success font-bold hover:underline">{workOrder.contact.phone}</a></p>}
                  {workOrder.contact.email && <p className="flex items-center gap-2"><Icon name="mail" className="h-4 w-4 shrink-0 text-success" /><a href={`mailto:${workOrder.contact.email}`} className="inline-flex min-h-11 items-center text-success font-bold hover:underline">{workOrder.contact.email}</a></p>}
                </div>
              </div>
            ) : workOrder.customer?.contacts && workOrder.customer?.contacts.length > 0 ? (
              <div className="bg-white/50 p-3 sm:p-4 rounded-xl border border-line">
                <p className="text-xs font-black text-muted uppercase tracking-wider mb-3">{t("orders.fieldDetail.customerContacts")}</p>
                <div className="space-y-3 divide-y divide-line">
                  {workOrder.customer?.contacts.map((c: any) => (
                    <div key={c.id} className="pt-3 first:pt-0">
                      <p className="font-black text-ink">{c.name} {c.role ? <span className="text-muted font-normal">({c.role})</span> : ""}</p>
                      <div className="mt-1 space-y-0.5 text-sm">
                        {c.phone && <p className="flex items-center gap-2"><Icon name="phone" className="h-4 w-4 shrink-0 text-success" /><a href={`tel:${c.phone}`} className="inline-flex min-h-11 items-center text-success font-bold hover:underline">{c.phone}</a></p>}
                        {c.email && <p className="flex items-center gap-2"><Icon name="mail" className="h-4 w-4 shrink-0 text-success" /><a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center text-success font-bold hover:underline">{c.email}</a></p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white/50 p-3 rounded-xl border border-line">
                <p className="text-xs text-muted italic">{t("orders.fieldDetail.noContact")}</p>
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

        {/* Audit log – sjelden oppslag, derfor sammenklappet. */}
        <details className={PAPER_CARD}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-black text-ink [&::-webkit-details-marker]:hidden">
            <Icon name="list" className="h-4 w-4" />
            {t("orders.fieldDetail.auditLog")}
          </summary>
          <div className="mt-3 border-t border-line pt-3">
            <AuditLogTable logs={auditLogs} />
          </div>
        </details>
      </div>

      {/* Angre-toast etter fjerning av personell. */}
      {removedUser && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom,0px)+10.5rem)] z-50 mx-auto flex max-w-md items-center gap-2 rounded-2xl field-card px-3 py-2 text-sm font-bold shadow-xl sm:bottom-4"
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
              className="signal-button text-sm"
            >
              {t("orders.fieldDetail.undo")}
            </SubmitButton>
          </form>
          <Link
            href={`/mine-oppdrag/${workOrderId}`}
            aria-label={t("orders.fieldDetail.dismiss")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-paper hover:bg-white/10"
          >
            <Icon name="close" className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* Sticky handlingslinje på mobil, over bunnmenyen. */}
      {stickyAction && (
        <div className="field-sticky-cta fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-40 border-t border-[#2a3328] bg-field/95 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.28)] backdrop-blur sm:hidden">
          <Link
            href={stickyAction.href}
            className="field-cta w-full justify-between px-5"
          >
            <span>{stickyAction.label}</span>
            <Icon
              name={stickyAction.complete ? "check" : "arrowRight"}
              className="h-5 w-5"
            />
          </Link>
        </div>
      )}
    </div>
  );
}
