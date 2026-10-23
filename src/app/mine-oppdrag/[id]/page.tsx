import { redirect } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import AuditLogTable from "@/components/AuditLogTable";
import MarkdownEditor from "@/components/MarkdownEditor";
import MarkdownView from "@/components/MarkdownView";
import WorkOrderAttachments from "@/components/WorkOrderAttachments";
import { markdownToPlainText } from "@/lib/markdown";
import { LIMITS, cleanMarkdown, cleanStatus, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import {
  requireWorkOrderAccess,
  staffForDepartment,
  workOrderScope,
} from "@/lib/access";
import { formatDateRange, formatDateTime } from "@/lib/dates";
import { commentCreateSchema, workOrderStatusSchema, workOrderTemplateSchema } from "@/lib/schemas";
import { transitionWorkOrderStatus } from "@/lib/work-order-status-action";

const auditActor = (user?: {
  id: string;
  name: string | null;
  email: string | null;
} | null) => ({
  id: user?.id ?? "",
  name: user?.name ?? null,
  email: user?.email ?? null,
});

export default async function TechnicianWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;

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
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Oppdraget finnes ikke</h1>
        <p className="text-gray-500 mb-4">Det kan ha blitt slettet, eller så er lenken feil.</p>
        <Link href="/mine-oppdrag" className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition">
          Gå tilbake til oversikten
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
  const canWriteReports = hasPermission(user, "reports.write");

  const allUsers = await prisma.user.findMany({
    where: staffForDepartment(workOrder.departmentId),
    orderBy: { name: 'asc' },
    take: 100,
  });
  const availableUsers = allUsers.filter(u => !workOrder.technicians.some(t => t.id === u.id));

  const allTemplates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const availableTemplates = allTemplates.filter(t => !workOrder.templates.some(wt => wt.id === t.id));

  // --- SERVER ACTION: OPPDATER STATUS ---
  async function updateStatus(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.update", workOrderId);
    if (!access) redirect(`/mine-oppdrag/${workOrderId}?error=ikke-tilgang`);
    const parsed = workOrderStatusSchema.safeParse({
      status: cleanStatus(formData.get("status")),
    });
    if (!parsed.success) redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);
    const newStatus = parsed.data.status as WorkStatus;

    // Kansellering er en kontorhandling. Montører skal ikke kunne lukke et
    // oppdrag slik at det forsvinner fra feltportalen.
    if (newStatus === "CANCELLED" && !hasPermission(access.user, "workorders.edit")) {
      redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-status`);
    }

    const result = await transitionWorkOrderStatus({
      workOrderId,
      from: access.workOrder.status as WorkStatus,
      to: newStatus,
      isAdmin: access.user.role === "ADMIN",
      actor: auditActor(access.user),
      action: `Montør endret status til: ${newStatus}`,
    });
    if (!result.ok) {
      redirect(`/mine-oppdrag/${workOrderId}?error=${result.error}`);
    }

    revalidatePath(`/mine-oppdrag/${workOrderId}`);
  }

  // --- SERVER ACTION: LEGG TIL KOMMENTAR ---
  async function addComment(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.update", workOrderId);
    if (!access) redirect(`/mine-oppdrag/${workOrderId}?error=ikke-tilgang`);
    const parsed = commentCreateSchema.safeParse({
      content: cleanMarkdown(formData.get("content")),
    });
    if (!parsed.success) redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);
    const content = parsed.data.content;

    await prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          content,
          workOrderId: workOrderId,
          authorName: access.user.name || access.user.email || "Montør"
        }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `La til kommentar: "${markdownToPlainText(content).slice(0, 30)}..."`,
        actor: auditActor(access.user),
        metadata: { commentId: comment.id },
      });
    });

    revalidatePath(`/mine-oppdrag/${workOrderId}`);
  }

  // --- SERVER ACTION: LEGG TIL SJEKKLISTE ---
  async function addTemplate(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.update", workOrderId);
    if (!access) redirect(`/mine-oppdrag/${workOrderId}?error=ikke-tilgang`);
    const parsed = workOrderTemplateSchema.safeParse({
      templateId: cleanText(formData.get("templateId"), { maxLength: LIMITS.line }),
    });
    if (!parsed.success) redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);
    const templateId = parsed.data.templateId;

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          templates: { connect: { id: templateId } }
        }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: "La til en sjekkliste på oppdraget",
        actor: auditActor(access.user),
        metadata: { templateId },
      });
    });

    revalidatePath(`/mine-oppdrag/${workOrderId}`);
  }

  // --- SERVER ACTION: LEGG TIL NY MONTØR / KONTORPERSON ---
  async function addTechnician(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.update", workOrderId);
    if (!access) redirect(`/mine-oppdrag/${workOrderId}?error=ikke-tilgang`);
    const userId = cleanText(formData.get("userId"), { maxLength: LIMITS.line });
    if (!userId) redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);

    const targetUser = await prisma.user.findFirst({
      where: { id: userId, ...staffForDepartment(access.workOrder.departmentId) },
    });
    if (!targetUser) redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          technicians: { connect: { id: userId } }
        }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `La til ${targetUser.name || 'bruker'} på oppdraget`,
        actor: auditActor(access.user),
        metadata: { userId },
      });
    });

    revalidatePath(`/mine-oppdrag/${workOrderId}`);
  }

  // --- SERVER ACTION: FJERN MONTØR / SEG SELV ---
  async function removeTechnician(formData: FormData) {
    "use server";
    const access = await requireWorkOrderAccess("workorders.update", workOrderId);
    if (!access) redirect(`/mine-oppdrag/${workOrderId}?error=ikke-tilgang`);
    const userId = cleanText(formData.get("userId"), { maxLength: LIMITS.line });
    if (!userId) redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);

    const targetUser = await prisma.user.findFirst({
      where: { id: userId, ...staffForDepartment(access.workOrder.departmentId) },
    });
    if (!targetUser) redirect(`/mine-oppdrag/${workOrderId}?error=ugyldig-data`);

    await prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: {
          technicians: { disconnect: { id: userId } }
        }
      });
      await audit(tx, {
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: `Fjernet ${targetUser?.name || 'bruker'} fra oppdraget`,
        actor: auditActor(access.user),
        metadata: { userId },
      });
    });

    revalidatePath(`/mine-oppdrag/${workOrderId}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex justify-between items-start border-b pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900">{workOrder.title}</h1>
            <p className="text-sm text-gray-600 mt-1">🏢 {workOrder.customer?.name || "Uten kunde"}</p>
            <p className="text-xs text-gray-500 font-bold mt-1">🏷️ Avdeling: {workOrder.department.name}</p>
            {workOrder.tags && workOrder.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {workOrder.tags.map((tag: any) => (
                  <span
                    key={tag.id}
                    className="text-white px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm"
                    suppressHydrationWarning
                    style={{ backgroundColor: tag.color || "#3b82f6" }}
                  >
                    🏷️ {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Link href="/mine-oppdrag" className="bg-white text-gray-700 px-4 py-2 rounded-xl text-sm font-bold border-2 border-gray-200 shadow-sm hover:bg-gray-100 transition">
            &larr; Tilbake
          </Link>
        </div>

        {error === "locked" && (
          <div className="bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-2xl px-4 py-3 text-sm font-bold">
            🔒 Rapporten er låst og ble ikke lagret. Kontakt en administrator hvis den må endres.
          </div>
        )}

        {error === "ugyldig-status" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-4 py-3 text-sm font-bold">
            ⛔ Statusendringen er ikke lovlig fra oppdragets nåværende tilstand.
          </div>
        )}

        {error && !["locked", "ugyldig-status"].includes(error) && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-4 py-3 text-sm font-bold">
            ⛔ Handlingen kunne ikke utføres. Sjekk feltene og prøv igjen.
          </div>
        )}

        {/* STATUS & INFO */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 border-b pb-4 mb-4">

            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Oppdragsstatus</p>
              {canUpdate ? (
                <form action={updateStatus} className="flex items-center gap-2 flex-wrap">
                  <select
                    name="status"
                    defaultValue={workOrder.status}
                    className="border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-600 min-w-[180px]"
                  >
                    <option value="OPEN">Åpen / Ny</option>
                    <option value="PENDING">Venter / Planlagt</option>
                    <option value="IN_PROGRESS">Påbegynt</option>
                    <option value="COMPLETED">Fullført</option>
                    {canEdit && <option value="CANCELLED">Kansellert</option>}
                  </select>
                  <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition whitespace-nowrap">
                    Oppdater
                  </button>
                </form>
              ) : (
                <p className="text-sm text-gray-500 italic">
                  Du har ikke rettighet til å endre status.
                </p>
              )}
            </div>

            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Planlagt Dato</p>
              <p className="font-bold text-gray-900 bg-gray-50 p-2.5 border-2 border-gray-200 rounded-xl inline-block w-full">
                📅 {formatDateRange(workOrder.scheduledFor, workOrder.scheduledTo) || "Ingen dato valgt"}
              </p>
            </div>

          </div>

          <div>
            <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Arbeidsbeskrivelse / Instrukser</h2>
            <div className="bg-blue-50/60 border-2 border-blue-200 p-3 sm:p-4 rounded-xl">
              {workOrder.description ? (
                <MarkdownView value={workOrder.description} className="text-gray-900 font-medium" />
              ) : (
                <p className="text-sm text-gray-900 font-medium">
                  Ingen beskrivelse lagt til for dette oppdraget.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* KOMMENTARER / LOGG */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4">
          <h2 className="font-black text-lg text-gray-900 border-b pb-2">💬 Kommentarer & Oppdateringer</h2>

          {/* Skriv ny kommentar */}
          {canUpdate && (
            <form action={addComment} className="space-y-3">
              <MarkdownEditor
                name="content"
                rows={3}
                required
                placeholder="Skriv en kommentar eller melding til kontoret/kolleger..."
              />
              <div className="flex justify-end">
                <button type="submit" className="bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap">
                  💬 Legg til kommentar
                </button>
              </div>
            </form>
          )}

          {/* Liste over tidligere kommentarer */}
          <div className="space-y-3 pt-4 border-t border-gray-200">
            {workOrder.workComments.length === 0 ? (
              <p className="text-sm text-gray-500 italic">Ingen kommentarer registrert på oppdraget ennå.</p>
            ) : (
              workOrder.workComments.map((comment: any) => (
                <div key={comment.id} className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200 space-y-1">
                  <div className="flex justify-between items-center text-[10px] text-gray-500 font-bold">
                    <span>{comment.authorName || "Ukjent"}</span>
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
          <h2 className="font-black text-lg text-gray-900 border-b pb-2">👷 Tildelte personell & Kontor</h2>

          <div className="space-y-2">
            {workOrder.technicians.length === 0 ? (
              <p className="text-sm text-red-600 font-bold">Ingen er tildelt dette oppdraget ennå.</p>
            ) : (
              <div className="space-y-2">
                {workOrder.technicians.map((t: any) => (
                  <div key={t.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-200 gap-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0"></span>
                      <div className="min-w-0">
                        <p className="font-black text-gray-900 text-sm truncate">{t.name} {t.id === user.id ? <span className="text-[10px] text-blue-600">(Du)</span> : ""}</p>
                        <p className="text-[10px] text-gray-500">{t.role === 'ADMIN' ? 'Admin / Kontor' : t.role === 'OFFICE' ? 'Kontor' : 'Montør'}</p>
                      </div>
                    </div>

                    {canUpdate && (
                      <form action={removeTechnician} className="flex-shrink-0">
                        <input type="hidden" name="userId" value={t.id} />
                        <button type="submit" className="text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-200 transition whitespace-nowrap">
                          {t.id === user.id ? "Fjern meg" : "Fjern"}
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canUpdate && availableUsers.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Legg til kollega eller kontor for oppfølging</p>
              <form action={addTechnician} className="flex gap-2 flex-wrap">
                <select
                  name="userId"
                  required
                  defaultValue=""
                  className="border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-white flex-1 outline-none shadow-sm min-w-[200px]"
                >
                  <option value="" disabled>-- Velg person --</option>
                  {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role === 'ADMIN' ? 'Admin / Kontor' : u.role === 'OFFICE' ? 'Kontor' : u.role === 'TECHNICIAN' ? 'Montør' : u.role === 'CUSTOMER' ? 'Kundeportal' : 'Standard'})</option>
                  ))}
                </select>
                <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
                  + Legg til
                </button>
              </form>
            </div>
          )}
        </div>

        {/* LOKASJON & KONTAKTPERSON */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
          <h2 className="font-black text-lg text-gray-900 mb-4 border-b pb-2">📍 Lokasjon & Kontakt</h2>
          <div className="text-sm text-gray-800 space-y-4">
            <div>
              <p className="text-gray-900">
                <strong>Adresse:</strong>
                <GoogleMapsLink
                  address={workOrder.customer?.address}
                  postalCode={workOrder.customer?.postalCode}
                  city={workOrder.customer?.city}
                  label={workOrder.customer?.address || "Ikke oppgitt"}
                />
                {workOrder.customer?.postalCode || ""} {workOrder.customer?.city || ""}
              </p>
              {workOrder.customer?.phone && (
                <p className="mt-1">
                  <strong>Firma-tlf:</strong> <a href={`tel:${workOrder.customer?.phone}`} className="text-blue-600 font-bold hover:underline">{workOrder.customer?.phone}</a>
                </p>
              )}
            </div>

            {workOrder.contact ? (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">Oppdragets kontaktperson</p>
                <p className="font-black text-gray-900 text-base">{workOrder.contact.name}</p>
                <div className="mt-2 space-y-1 text-sm">
                  {workOrder.contact.phone && <p>📞 <a href={`tel:${workOrder.contact.phone}`} className="text-blue-600 font-bold hover:underline">{workOrder.contact.phone}</a></p>}
                  {workOrder.contact.email && <p>✉️ <a href={`mailto:${workOrder.contact.email}`} className="text-blue-600 font-bold hover:underline">{workOrder.contact.email}</a></p>}
                </div>
              </div>
            ) : workOrder.customer?.contacts && workOrder.customer?.contacts.length > 0 ? (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-3">Kundens kontaktpersoner</p>
                <div className="space-y-3 divide-y divide-gray-200">
                  {workOrder.customer?.contacts.map((c: any) => (
                    <div key={c.id} className="pt-3 first:pt-0">
                      <p className="font-black text-gray-900">{c.name} {c.role ? <span className="text-gray-500 font-normal">({c.role})</span> : ""}</p>
                      <div className="mt-1 space-y-0.5 text-sm">
                        {c.phone && <p>📞 <a href={`tel:${c.phone}`} className="text-blue-600 font-bold hover:underline">{c.phone}</a></p>}
                        {c.email && <p>✉️ <a href={`mailto:${c.email}`} className="text-blue-600 font-bold hover:underline">{c.email}</a></p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                <p className="text-xs text-gray-500 italic">Ingen spesifikk kontaktperson registrert på dette oppdraget eller kunden.</p>
              </div>
            )}
          </div>
        </div>

        {/* SJEKKLISTER */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-blue-200">
          <h2 className="font-black text-lg text-gray-900 mb-4 border-b pb-2">📋 Sjekklister for oppdraget</h2>

          {workOrder.templates.length === 0 ? (
            <p className="text-sm text-gray-500 italic mb-4">Ingen sjekklister er knyttet til dette oppdraget ennå.</p>
          ) : (
            <div className="space-y-3 mb-6">
              {workOrder.templates.map(template => {
                const report = workOrder.reports.find(report => report.templateId === template.id);

                return (
                  <div key={template.id} className={`flex flex-wrap justify-between items-center gap-3 p-3 sm:p-4 rounded-xl border-2 transition ${report ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                    <span className={`font-bold text-sm ${report ? 'text-green-900' : 'text-blue-900'} flex items-center gap-2`}>
                      {template.title}
                      {report?.isLocked && (
                        <span className="bg-gray-800 text-white text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          🔒 LÅST
                        </span>
                      )}
                      {report && !report.isLocked && (
                        <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black px-2 py-0.5 rounded-full whitespace-nowrap">
                          🔓 LÅST OPP
                        </span>
                      )}
                    </span>

                    {report ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/rapporter/${workOrderId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-blue-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg hover:bg-blue-800 shadow-sm transition whitespace-nowrap"
                        >
                          📄 Se rapport (PDF)
                        </Link>
                        {canWriteReports && canUpdate && !report.isLocked && (
                          <Link
                            href={`/mine-oppdrag/${workOrderId}/skjema/${template.id}`}
                            className="bg-amber-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg hover:bg-amber-600 shadow-sm transition whitespace-nowrap"
                          >
                            ✏️ Rediger
                          </Link>
                        )}
                      </div>
                    ) : canWriteReports && canUpdate ? (
                      <Link
                        href={`/mine-oppdrag/${workOrderId}/skjema/${template.id}`}
                        className="bg-blue-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg hover:bg-blue-800 shadow-sm transition whitespace-nowrap"
                      >
                        Fyll ut skjema &rarr;
                      </Link>
                    ) : (
                      <span className="text-[10px] font-bold text-gray-500">
                        Venter på utfylling
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {canUpdate && availableTemplates.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Trenger du et ekstra skjema?</p>
              <form action={addTemplate} className="flex gap-2 flex-wrap">
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
                <button type="submit" className="bg-gray-200 text-gray-800 px-4 py-2.5 rounded-xl text-sm font-black hover:bg-gray-300 transition shadow-sm whitespace-nowrap">
                  + Legg til
                </button>
              </form>
            </div>
          )}
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
          <h2 className="font-black text-gray-900 mb-3 border-b pb-2">📋 Aktivitetslogg</h2>
          <AuditLogTable logs={auditLogs} />
        </div>
      </div>
    </div>
  );
}
