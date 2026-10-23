import { redirect } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import TagSelector from "@/components/TagSelector";
import AuditLogTable from "@/components/AuditLogTable";
import CommentSection from "@/components/CommentSection";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import MarkdownView from "@/components/MarkdownView";
import WorkOrderAttachments from "@/components/WorkOrderAttachments";
import { LIMITS, cleanEmail, cleanPhone, cleanStatus, cleanText } from "@/lib/sanitize";
import { needsComment, parseImageUrls, readLineComment } from "@/lib/report-answers";
import { getCurrentUser, requireAdmin } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import {
  requireWorkOrderAccess,
  staffForDepartment,
  workOrderScope,
} from "@/lib/access";
import {
  reportUnlockSchema,
  workOrderStatusSchema,
  workOrderTemplateSchema,
} from "@/lib/schemas";
import { transitionWorkOrderStatus } from "@/lib/work-order-status-action";
import { deleteWorkOrder } from "./actions";

const auditActor = (user?: {
  id: string;
  name: string | null;
  email: string | null;
} | null) => ({
  id: user?.id ?? "",
  name: user?.name ?? null,
  email: user?.email ?? null,
});

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED': return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200 shadow-sm">✅ Fullført</span>;
    case 'IN_PROGRESS': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm">🔄 Påbegynt</span>;
    case 'CANCELLED': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200 shadow-sm">❌ Kansellert</span>;
    case 'OPEN': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200 shadow-sm">✨ Åpen</span>;
    case 'PLANNED': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">📅 Planlagt</span>;
    case 'WAITING': return <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold border border-orange-200 shadow-sm">⏸️ Venter</span>;
    default: return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">⏳ Planlagt</span>;
  }
}

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

function ReportContent({ report, template }: { report: any; template: any }) {
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

  // Viser svaret på ett sjekkpunkt. Brukes både for enheter og for eldre rapporter.
  const renderAnswer = (field: ReportField, answer: unknown) => {
    if (field.type === "CHECKBOX") {
      return (
        <span className={answer ? "text-green-700 font-black" : "text-gray-500 font-bold"}>
          {answer ? "Ja / Utført" : "Nei / Ikke krysset av"}
        </span>
      );
    }
    if (field.type === "STATUS") {
      return answer ? (
        <span className={needsComment(field, answer) ? "text-red-800 font-black" : "text-green-800 font-black"}>
          {String(answer)}
        </span>
      ) : (
        <span className="text-gray-400">Ikke vurdert</span>
      );
    }
    if (field.type === "SIGNATURE") {
      return (
        <span className="text-blue-800 font-black bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block">
          ✍️ {answer ? `Signert av: ${String(answer)}` : "Ikke signert"}
        </span>
      );
    }
    if (field.type === "IMAGE") {
      const urls = parseImageUrls(answer);
      if (urls.length === 0) return <span className="text-gray-400">Ikke vedlagt</span>;
      return (
        <span className="flex flex-wrap gap-2">
          {urls.map((url, index) => (
            <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Vedlegg ${index + 1}`}
                className="h-20 w-20 object-cover rounded-lg border-2 border-gray-200 bg-white hover:border-blue-400 transition"
              />
            </a>
          ))}
        </span>
      );
    }
    return (
      <span className="text-gray-900 font-medium italic">
        {answer !== undefined && answer !== "" ? `"${String(answer)}"` : <span className="text-gray-400">Ikke besvart</span>}
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
              <span className="text-gray-400 font-medium">Ikke besvart</span>
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
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">{label}</p>
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-20 bg-white border border-gray-200 rounded" />
        )}
        <p className="text-sm font-bold text-gray-900 mt-1">{name || "Uten navn"}</p>
      </div>
    );
  };

  const technicianSignature = signatureBlock("✍️ Montør / tekniker", report?.technicianSignatureUrl, report?.technicianName);
  const customerSignature = signatureBlock("✍️ Kunde", report?.customerSignatureUrl, report?.customerName);

  return (
    <div className="bg-white p-4 rounded-lg border-2 border-gray-200 shadow-sm text-sm space-y-4">
      <div className="flex gap-2 items-center">
        <span className="text-gray-500 font-black uppercase text-xs tracking-wider">Hovedresultat:</span>
        <span className={`font-bold px-3 py-1 rounded-full text-xs ${reportStatus === "GODKJENT" ? "bg-green-100 text-green-800 border border-green-200" : "bg-red-100 text-red-800 border border-red-200"}`}>
          {reportStatus === "GODKJENT" ? "✅ Godkjent / Utført" : "❌ Avvik funnet"}
        </span>
      </div>

      {/* ENHETER */}
      {units.length > 0 && (
        <div className="border-t-2 border-gray-200 pt-3 mt-3 space-y-3">
          <p className="text-xs font-black text-gray-600 uppercase tracking-wider">
            Enheter som ble kontrollert ({units.length})
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
                      {unit.serialNumber ? `SN: ${unit.serialNumber}` : "Uten serienummer"}
                      {unit.location ? ` • ${unit.location}` : ""}
                    </p>
                  </div>
                  <span className={`font-bold px-3 py-1 rounded-full text-[11px] border ${unit.status === "AVVIK" ? "bg-red-100 text-red-800 border-red-200" : "bg-green-100 text-green-800 border-green-200"}`}>
                    {unit.status === "AVVIK" ? "❌ Avvik" : "✅ Godkjent"}
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

      {/* SJEKKPUNKTER (eldre rapporter som ikke har enheter) */}
      {units.length === 0 && fields.length > 0 && (
        <div className="border-t-2 border-gray-200 pt-3 mt-3 space-y-2">
          <p className="text-xs font-black text-gray-600 uppercase tracking-wider">Svar på sjekkpunkter:</p>
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
          <span className="text-gray-500 font-black uppercase text-xs tracking-wider block mb-1">Generelle notater fra montør:</span>
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
  searchParams: Promise<{ error?: string }>;
}) {
  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;
  const { error } = await searchParams;

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
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Oppdraget finnes ikke</h1>
        <Link href="/" className="text-blue-700 font-bold hover:underline">Gå til dashbordet</Link>
      </div>
    );
  }

  // Kansellerte oppdrag er avsluttet og skal ikke vises til montørene.
  // Kontoret kan fortsatt åpne dem for oppfølging og historikk.
  if (user.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    redirect("/oppdrag");
  }

  const isAdmin = user.role === "ADMIN";
  const canUpdate = hasPermission(user, "workorders.update");
  const canEdit = hasPermission(user, "workorders.edit");
  const canAssign = hasPermission(user, "workorders.assign");
  const canDeleteWorkOrder = hasPermission(user, "workorders.delete");
  const canWriteReports = hasPermission(user, "reports.write");
  const canManageCustomers = hasPermission(user, "customers.manage");

  const allTemplates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const availableTemplates = allTemplates.filter(t => !workOrder.templates.some(wt => wt.id === t.id));
  const allTags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  const staffUsers = await prisma.user.findMany({
    where: staffForDepartment(workOrder.departmentId),
    orderBy: { name: 'asc' },
    take: 100,
  });
  const availableTechnicians = staffUsers.filter(u => !workOrder.technicians.some(t => t.id === u.id));

  // Fanges opp her slik at handlingene under har en ikke-null kunde.
  const customerId = workOrder.customerId;

  async function setTemplate(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.edit", workOrderId);
    if (!access) redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);
    const parsed = workOrderTemplateSchema.safeParse({
      templateId: cleanText(formData.get("templateId"), { maxLength: LIMITS.line }),
    });
    if (!parsed.success) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);
    const templateId = parsed.data.templateId;

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { templates: { connect: { id: templateId } } }
      });
      // Sjekklisten er en del av oppdraget, så hendelsen følger oppdragets id.
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: "La til en sjekkliste på oppdraget",
        actor: auditActor(access.user),
        metadata: { templateId },
      });
    });
    revalidatePath(`/oppdrag/${workOrderId}`);
  }

  async function setContact(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.edit", workOrderId);
    if (!access || !hasPermission(access.user, "customers.manage")) {
      redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);
    }

    const contactId = cleanText(formData.get("contactId"), { maxLength: LIMITS.line });

    let contactName: string | null = null;
    if (contactId) {
      // Kontaktpersonen må tilhøre kunden oppdraget gjelder.
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact || contact.customerId !== customerId) {
        redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);
      }
      contactName = contact.name;
    }

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { contactId: contactId || null }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: contactName ? `Valgte kontaktperson: ${contactName}` : "Fjernet kontaktpersonen fra oppdraget",
        actor: auditActor(access.user),
        metadata: contactId ? { contactId } : undefined,
      });
    });

    revalidatePath(`/oppdrag/${workOrderId}`);
  }

  async function addContactToCustomer(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.edit", workOrderId);
    if (!access || !hasPermission(access.user, "customers.manage")) {
      redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);
    }
    if (!customerId) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);

    const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
    const email = cleanEmail(formData.get("email"));
    const phone = cleanPhone(formData.get("phone"));
    const role = cleanText(formData.get("role"), { maxLength: LIMITS.short });

    if (!name) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);

    await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          name,
          email: email || null,
          phone: phone || null,
          role: role || null,
          customerId
        }
      });

      // Den nye kontaktpersonen blir valgt på oppdraget med en gang.
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { contactId: contact.id }
      });

      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `La til kontaktperson: ${name}`,
        actor: auditActor(access.user),
        metadata: { contactId: contact.id, customerId },
      });
    });

    revalidatePath(`/oppdrag/${workOrderId}`);
    revalidatePath(`/kunder/${customerId}`);
  }

  async function assignTechnician(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
    if (!access) redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);

    const technicianId = cleanText(formData.get("technicianId"), { maxLength: LIMITS.line });
    if (!technicianId) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);

    // Bare ansatte i oppdragets avdeling kan tildeles.
    const target = await prisma.user.findFirst({
      where: { id: technicianId, ...staffForDepartment(access.workOrder.departmentId) },
    });
    if (!target) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { technicians: { connect: { id: technicianId } } }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `La til ${target.name} som montør`,
        actor: auditActor(access.user),
        metadata: { technicianId },
      });
    });

    revalidatePath(`/oppdrag/${workOrderId}`);
  }

  async function unassignTechnician(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
    if (!access) redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);

    const technicianId = cleanText(formData.get("technicianId"), { maxLength: LIMITS.line });
    if (!technicianId) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);

    const target = await prisma.user.findFirst({
      where: { id: technicianId, ...staffForDepartment(access.workOrder.departmentId) },
    });
    if (!target) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { technicians: { disconnect: { id: technicianId } } }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `Fjernet ${target.name || 'montør'} fra oppdraget`,
        actor: auditActor(access.user),
        metadata: { technicianId },
      });
    });

    revalidatePath(`/oppdrag/${workOrderId}`);
  }

  async function updateStatus(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.update", workOrderId);
    if (!access) redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);
    const parsed = workOrderStatusSchema.safeParse({
      status: cleanStatus(formData.get("status")),
    });
    if (!parsed.success) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);
    const status = parsed.data.status as WorkStatus;

    // Kansellering er en kontorhandling og krever workorders.edit. Montører
    // kan oppdatere fremdrift, men ikke lukke oppdraget slik at det forsvinner.
    if (status === "CANCELLED" && !hasPermission(access.user, "workorders.edit")) {
      redirect(`/oppdrag/${workOrderId}?error=ugyldig-status`);
    }

    const result = await transitionWorkOrderStatus({
      workOrderId,
      from: access.workOrder.status as WorkStatus,
      to: status,
      isAdmin: access.user.role === "ADMIN",
      actor: auditActor(access.user),
      action: `${access.user.role === "TECHNICIAN" ? "Montør" : "Kontoret"} endret status til: ${status}`,
    });
    if (!result.ok) {
      redirect(`/oppdrag/${workOrderId}?error=${result.error}`);
    }
    revalidatePath(`/oppdrag/${workOrderId}`);
  }

  async function setTags(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.edit", workOrderId);
    if (!access) redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);
    const tagNames = formData.getAll("tags")
      .map(t => cleanText(t, { maxLength: LIMITS.short }))
      .filter(Boolean);

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          tags: {
            set: [],
            connectOrCreate: tagNames.map(name => ({
              where: { name },
              create: { name }
            }))
          }
        }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `Oppdaterte tags: ${tagNames.join(", ") || "(ingen)"}`,
        actor: auditActor(access.user),
        metadata: { tags: tagNames },
      });
    });

    revalidatePath(`/oppdrag/${workOrderId}`);
  }

  async function setReportLock(formData: FormData) {
    "use server";
    // Bare administratorer kan låse opp en signert rapport igjen.
    if (!(await requireAdmin())) redirect(`/oppdrag/${workOrderId}?error=ikke-tilgang`);

    const parsed = reportUnlockSchema.safeParse({
      reportId: cleanText(formData.get("reportId"), { maxLength: LIMITS.line }),
      lock: formData.get("lock"),
    });
    if (!parsed.success) redirect(`/oppdrag/${workOrderId}?error=ugyldig-data`);
    const { reportId, lock: shouldLock } = parsed.data;

    const report = await prisma.report.findFirst({
      where: { id: reportId, workOrderId },
      select: { id: true },
    });
    if (!report) redirect(`/oppdrag/${workOrderId}?error=ikke-funnet`);

    const actor = await getCurrentUser();
    if (!actor) redirect("/api/auth/signin");

    const lockedUntil = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id: reportId },
        data: shouldLock
          ? { isLocked: true, lockedAt: lockedUntil, lockedByName: actor.name || actor.email }
          : { isLocked: false, lockedAt: null, lockedByName: null },
      });
      // Rapporten hører til oppdraget, så hendelsen følger oppdragets id.
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: shouldLock
          ? "Låste rapporten igjen"
          : "Låste opp rapporten slik at den kan rettes (sporbarhet: endringer logges)",
        actor: auditActor(actor),
        metadata: { reportId },
      });
    });

    revalidatePath(`/oppdrag/${workOrderId}`);
    revalidatePath(`/rapporter/${workOrderId}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* HEADER MED REDIGERINGS-KNAPP */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-xl md:text-3xl font-black text-gray-900">{workOrder.title}</h1>
              <StatusBadge status={workOrder.status} />
            </div>
            {/* Tags */}
            {canEdit ? (
              <form action={setTags} className="mb-3 space-y-2">
                <TagSelector
                  allTags={allTags}
                  selectedTagNames={workOrder.tags.map((t: any) => t.name)}
                />
                <button type="submit" className="bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-800 transition shadow-sm">
                  💾 Lagre tags
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
                      style={{ backgroundColor: tag.color || "#3b82f6" }}
                    >
                      🏷️ {tag.name}
                    </span>
                  ))}
                </div>
              )
            )}
            <p className="text-gray-600 font-medium">🏢 <Link href={`/kunder/${workOrder.customerId}`} className="hover:underline font-bold text-blue-700">{workOrder.customer?.name || "Uten kunde"}</Link></p>
            <p className="text-xs text-gray-500 font-bold mt-1">🏷️ Avdeling: {workOrder.department.name}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && (
              <Link
                href={`/oppdrag/${workOrder.id}/rediger`}
                className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm flex items-center gap-2"
              >
                ✏️ Rediger oppdrag
              </Link>
            )}
            {canDeleteWorkOrder && (
              <ConfirmSubmitForm
                action={deleteWorkOrder}
                confirmMessage={`Slette oppdraget «${workOrder.title}»? Alle rapporter, kommentarer og vedlegg til oppdraget blir slettet. Dette kan ikke angres.`}
              >
                <input type="hidden" name="workOrderId" value={workOrder.id} />
                <button
                  type="submit"
                  className="bg-white border-2 border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-red-50 transition shadow-sm"
                >
                  🗑️ Slett oppdrag
                </button>
              </ConfirmSubmitForm>
            )}
            <Link href="/" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm">
              &larr; Tilbake
            </Link>
          </div>
        </div>

        {error === "locked" && (
          <div className="bg-amber-50 border-2 border-amber-200 text-amber-900 rounded-2xl px-5 py-4 text-sm font-bold">
            🔒 Rapporten er låst og kan ikke endres. En administrator må låse den opp først.
          </div>
        )}

        {error === "ugyldig-status" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            ⛔ Statusendringen er ikke lovlig fra oppdragets nåværende tilstand.
            Fullførte eller kansellerte oppdrag kan bare gjenåpnes av en administrator.
          </div>
        )}

        {error && !["locked", "ugyldig-status"].includes(error) && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            ⛔ Handlingen kunne ikke utføres. Sjekk feltene og prøv igjen.
          </div>
        )}

        <div className="space-y-6">

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
                <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Arbeidsbeskrivelse</h2>
                {workOrder.description ? (
                  <MarkdownView value={workOrder.description} className="text-gray-900 font-medium" />
                ) : (
                  <p className="text-sm text-gray-900 font-medium">Ingen beskrivelse lagt til.</p>
                )}
              </div>

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                  <h2 className="font-black text-lg text-gray-900">📋 Sjekklister & Rapporter</h2>
                </div>

                {workOrder.templates.length === 0 ? (
                  <p className="text-sm text-gray-500 italic mb-4">Ingen sjekklister er lagt til dette oppdraget ennå.</p>
                ) : (
                  <div className="space-y-4 mb-6">
                    {workOrder.templates.map(template => {
                      const report = workOrder.reports.find(r => r.templateId === template.id);
                      // Skjemaet kan fylles ut både fra feltportalen og herfra.
                      const fillHref = `/mine-oppdrag/${workOrder.id}/skjema/${template.id}?returnTo=${encodeURIComponent(`/oppdrag/${workOrder.id}`)}`;

                      return (
                        <div key={template.id} className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
                          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                            <span className="font-black text-gray-900 text-base">{template.title}</span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {report ? (
                                <>
                                  <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1 rounded-full border border-green-200">✅ Utfylt</span>
                                  {report.isLocked ? (
                                    <span className="bg-gray-800 text-white text-xs font-bold px-3 py-1 rounded-full">🔒 Låst</span>
                                  ) : (
                                    <span className="bg-amber-100 text-amber-900 text-xs font-bold px-3 py-1 rounded-full border border-amber-300">🔓 Låst opp</span>
                                  )}
                                  <Link
                                    href={`/rapporter/${workOrder.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
                                  >
                                    📄 Åpne PDF
                                  </Link>
                                  {canWriteReports && canUpdate && !report.isLocked && (
                                    <Link
                                      href={fillHref}
                                      className="bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-amber-600 transition shadow-sm whitespace-nowrap"
                                    >
                                      ✍️ Fyll ut på nytt
                                    </Link>
                                  )}
                                  {isAdmin && (
                                    <form action={setReportLock}>
                                      <input type="hidden" name="reportId" value={report.id} />
                                      <input type="hidden" name="lock" value={report.isLocked ? "0" : "1"} />
                                      <button
                                        type="submit"
                                        className={`text-xs font-bold px-3 py-1.5 rounded-full transition shadow-sm whitespace-nowrap ${
                                          report.isLocked
                                            ? "bg-white border-2 border-amber-300 text-amber-900 hover:bg-amber-50"
                                            : "bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-100"
                                        }`}
                                      >
                                        {report.isLocked ? "🔓 Lås opp for retting" : "🔒 Lås igjen"}
                                      </button>
                                    </form>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-3 py-1 rounded-full border border-yellow-200">⏳ Venter på utfylling</span>
                                  {canWriteReports && canUpdate && (
                                    <Link
                                      href={fillHref}
                                      className="bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-amber-600 transition shadow-sm whitespace-nowrap"
                                    >
                                      ✍️ Fyll ut skjema
                                    </Link>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {report && !report.isLocked && (
                            <div className="bg-amber-50 border-2 border-amber-200 text-amber-900 text-xs font-bold rounded-xl px-3 py-2 mb-3">
                              ⚠️ Rapporten er låst opp og kan endres. Lås den igjen når rettingen er ferdig.
                            </div>
                          )}

                          {report ? (
                            <ReportContent report={report} template={template} />
                          ) : (
                            <p className="text-xs text-gray-500 italic">Skjemaet venter på utfylling.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}
                  
                  {canEdit && availableTemplates.length > 0 && (
                    <div className="border-t-2 border-gray-200 pt-4">
                      <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-2">Krev flere sjekklister på oppdraget</p>
                      <form action={setTemplate} className="flex gap-2 flex-wrap">
                        <select
                          name="templateId"
                          required
                          defaultValue=""
                          className="border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white flex-1 outline-none shadow-sm min-w-[200px]"
                        >
                          <option value="" disabled>-- Velg sjekklistemal --</option>
                          {availableTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                          ))}
                        </select>
                        <button type="submit" className="bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap">
                          + Legg til
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
                <h2 className="font-black text-gray-900 mb-3 border-b pb-2">Endre Status</h2>
                {canUpdate ? (
                  <form action={updateStatus} className="flex flex-col gap-3">
                    <select
                      name="status"
                      defaultValue={workOrder.status}
                      className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none shadow-sm"
                    >
                      <option value="OPEN">Åpen / Ny</option>
                      <option value="PENDING">Venter / Planlagt</option>
                      <option value="IN_PROGRESS">Påbegynt</option>
                      <option value="COMPLETED">Fullført</option>
                      {canEdit && <option value="CANCELLED">Kansellert</option>}
                    </select>
                    <button type="submit" className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
                      Oppdater Status
                    </button>
                  </form>
                ) : (
                  <p className="text-sm text-gray-500 italic">
                    Du har ikke rettighet til å endre status på dette oppdraget.
                  </p>
                )}
              </div>

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 text-sm">
                <h2 className="font-black text-gray-900 mb-3 border-b pb-2">📍 Lokasjon & Kontakt</h2>
                <div className="space-y-2 text-gray-800 mb-4">
                  <p><strong>Firma:</strong> {workOrder.customer?.name || "Uten kunde"}</p>
                  <p><strong>Adresse:</strong>
                    <GoogleMapsLink
                      address={workOrder.customer?.address}
                      postalCode={workOrder.customer?.postalCode}
                      city={workOrder.customer?.city}
                    />
                  </p>
                </div>

                {workOrder.contact ? (
                  <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border-2 border-gray-200">
                    <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-1">Kontaktperson</p>
                    <p className="font-black text-gray-900">{workOrder.contact.name}</p>
                    <p className="text-gray-600">📞 <a href={`tel:${workOrder.contact.phone}`} className="text-blue-700 font-bold hover:underline">{workOrder.contact.phone || "-"}</a></p>
                    <p className="text-gray-600">✉️ <a href={`mailto:${workOrder.contact.email}`} className="text-blue-700 font-bold hover:underline">{workOrder.contact.email || "-"}</a></p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic">Ingen kontaktperson valgt for oppdraget.</p>
                )}

                {workOrder.creatorName && (
                  <p className="text-xs text-gray-500 mt-2">
                    <strong>Opprettet av:</strong> {workOrder.creatorName}
                  </p>
                )}

                {canEdit && canManageCustomers && workOrder.customer && (
                  <div className="mt-4 pt-4 border-t-2 border-gray-100 space-y-3">
                    <form action={setContact} className="flex flex-col sm:flex-row gap-2">
                      <select
                        name="contactId"
                        defaultValue={workOrder.contactId || ""}
                        className="flex-1 min-w-0 border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
                      >
                        <option value="">— Ingen kontaktperson —</option>
                        {workOrder.customer.contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.role ? ` (${c.role})` : ""}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap flex-shrink-0">
                        Lagre kontakt
                      </button>
                    </form>

                    <details className="rounded-xl border-2 border-gray-200 bg-gray-50">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-black text-blue-800 select-none">
                        + Ny kontaktperson for kunden
                      </summary>
                      <form action={addContactToCustomer} className="space-y-2 p-3 pt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input required name="name" placeholder="Navn *" className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                          <input name="role" placeholder="Rolle (valgfritt)" className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                          <input type="email" name="email" placeholder="E-post (valgfritt)" className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                          <input type="tel" name="phone" placeholder="Telefon (valgfritt)" className="border-2 border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white" />
                        </div>
                        <button type="submit" className="w-full bg-gray-900 text-white py-2 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm">
                          Legg til og velg på oppdraget
                        </button>
                      </form>
                    </details>
                  </div>
                )}
              </div>

              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 text-sm">
                <h2 className="font-black text-gray-900 mb-3 border-b pb-2">👷 Tildelte Montører</h2>
                {workOrder.technicians.length > 0 ? (
                  <div className="space-y-2">
                    {workOrder.technicians.map(tech => (
                      <div key={tech.id} className="bg-gray-50 p-2.5 rounded-xl font-bold text-gray-900 flex items-center gap-2 border-2 border-gray-200 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0"></span>
                        <span className="flex-1 min-w-0 truncate">{tech.name}</span>
                        {canAssign && (
                          <form action={unassignTechnician} className="flex-shrink-0">
                            <input type="hidden" name="technicianId" value={tech.id} />
                            <button type="submit" className="text-[11px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg border border-red-200 transition whitespace-nowrap">
                              Fjern
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-red-600 font-bold">Ingen montører er tildelt ennå!</p>
                )}

                {canAssign && availableTechnicians.length > 0 && (
                  <form action={assignTechnician} className="flex flex-col sm:flex-row gap-2 mt-4 border-t-2 border-gray-100 pt-4">
                    <select
                      name="technicianId"
                      required
                      defaultValue=""
                      className="flex-1 min-w-0 border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
                    >
                      <option value="" disabled>-- Velg montør --</option>
                      {availableTechnicians.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.role === 'ADMIN' ? 'Admin / Kontor' : t.role === 'OFFICE' ? 'Kontor' : 'Montør'})
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap flex-shrink-0">
                      + Legg til montør
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
                canUpload={canUpdate}
                canDelete={isAdmin}
              />

            </div>
          </div>

          {/* Audit log - full width bottom */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
            <h2 className="font-black text-gray-900 mb-3 border-b pb-2">📋 Aktivitetslogg</h2>
            <AuditLogTable logs={auditLogs} />
          </div>

        </div>

      </div>
    </div>
  );
}
