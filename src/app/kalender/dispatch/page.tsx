import { redirect } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import { markdownToPlainText } from "@/lib/markdown";
import { formatAddress } from "@/lib/address";
import { formatDateRange } from "@/lib/dates";
import { LIMITS, cleanStatus, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import {
  requireWorkOrderAccess,
  staffScope,
  workOrderScope,
} from "@/lib/access";
import { workOrderStatusSchema } from "@/lib/schemas/workOrder";
import { transitionWorkOrderStatus } from "@/lib/work-order-status-action";
import {
  assignTechnician as assignTechnicianService,
  unassignTechnician as unassignTechnicianService,
} from "@/server/work-orders";
import { notifyWorkOrderEvent } from "@/server/notifications";

/** Oversetter tjenestens feilkode til dispatch-sidens query-parameter. */
function dispatchErrorFor(error: string): string {
  if (error === "ikke-tilgang" || error === "forbidden") return "ikke-tilgang";
  if (error === "ugyldig-data") return "ugyldig-data";
  return "ukjent";
}

const auditActor = (user?: {
  id: string;
  name: string | null;
  email: string | null;
} | null) => ({
  id: user?.id ?? "",
  name: user?.name ?? null,
  email: user?.email ?? null,
});

// Hjelpekomponent for status-etikett
async function DispatchStatusBadge({ status }: { status: string }) {
  const t = await getTranslations("common");
  switch (status) {
    case 'COMPLETED': return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200 shadow-sm">{t("calendar.dispatch.badgeCompleted")}</span>;
    case 'IN_PROGRESS': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm">{t("calendar.dispatch.badgeInProgress")}</span>;
    case 'CANCELLED': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200 shadow-sm">{t("calendar.dispatch.badgeCancelled")}</span>;
    case 'OPEN': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200 shadow-sm">{t("calendar.dispatch.badgeOpen")}</span>;
    case 'PENDING': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">{t("calendar.dispatch.badgePending")}</span>;
    case 'PLANNED': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">{t("calendar.dispatch.badgePlanned")}</span>;
    case 'WAITING': return <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold border border-orange-200 shadow-sm">{t("calendar.dispatch.badgeWaiting")}</span>;
    default: return <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-bold border border-gray-200 shadow-sm">{status}</span>;
  }
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; workOrderId?: string }>;
}) {
  const { error, workOrderId: errorWorkOrderId } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.assign")) redirect("/");

  const t = await getTranslations("common");

  // Hent alle åpne oppdrag som ikke er fullført eller kansellert, i egen avdeling.
  const workOrders = await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScope(user),
        { status: { notIn: ['COMPLETED', 'CANCELLED'] as any } },
      ],
    },
    include: {
      customer: true,
      technicians: true,
      product: true
    },
    orderBy: {
      scheduledFor: 'asc'
    },
    take: 500,
  });

  // Hent alle tilgjengelige montører i egen avdeling.
  const availableTechnicians = await prisma.user.findMany({
    where: staffScope(user),
    orderBy: { name: 'asc' },
    take: 200,
  });

  // --- SERVER ACTION: TILDEL MONTØR ---
  // Går via den delte tjenesten, slik at tildelingen også sender
  // ASSIGNMENT-varselet til montøren på samme måte som ellers i appen.
  async function assignTechnician(formData: FormData) {
    "use server";
    const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
    const technicianId = cleanText(formData.get("technicianId"), { maxLength: LIMITS.line });
    if (!workOrderId || !technicianId) {
      redirect("/kalender/dispatch?error=ugyldig-data");
    }

    const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
    if (!access) redirect("/kalender/dispatch?error=ikke-tilgang");

    try {
      const result = await assignTechnicianService(access.user, workOrderId, technicianId);
      if (!result.ok) {
        redirect(
          `/kalender/dispatch?error=${dispatchErrorFor(result.error)}&workOrderId=${encodeURIComponent(workOrderId)}`,
        );
      }
      revalidatePath("/kalender/dispatch");
    } catch (error) {
      console.error("Feil ved tildeling av montør:", error);
      redirect(
        `/kalender/dispatch?error=ukjent&workOrderId=${encodeURIComponent(workOrderId)}`,
      );
    }
  }

  // --- SERVER ACTION: FJERN MONTØR ---
  async function removeTechnician(formData: FormData) {
    "use server";
    const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
    const technicianId = cleanText(formData.get("technicianId"), { maxLength: LIMITS.line });
    if (!workOrderId || !technicianId) {
      redirect("/kalender/dispatch?error=ugyldig-data");
    }

    const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
    if (!access) redirect("/kalender/dispatch?error=ikke-tilgang");

    try {
      const result = await unassignTechnicianService(access.user, workOrderId, technicianId);
      if (!result.ok) {
        redirect(
          `/kalender/dispatch?error=${dispatchErrorFor(result.error)}&workOrderId=${encodeURIComponent(workOrderId)}`,
        );
      }
      revalidatePath("/kalender/dispatch");
    } catch (error) {
      console.error("Feil ved fjerning av montør:", error);
      redirect(
        `/kalender/dispatch?error=ukjent&workOrderId=${encodeURIComponent(workOrderId)}`,
      );
    }
  }

  // --- SERVER ACTION: OPPRETT STATUS ---
  async function updateStatus(formData: FormData) {
    "use server";
    const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
    const parsed = workOrderStatusSchema.safeParse({
      status: cleanStatus(formData.get("status")),
    });
    if (!workOrderId || !parsed.success) {
      redirect("/kalender/dispatch?error=ugyldig-data");
    }

    const access = await requireWorkOrderAccess("workorders.update", workOrderId);
    if (!access) redirect("/kalender/dispatch?error=ikke-tilgang");

    const nextStatus = parsed.data.status as WorkStatus;
    // Kansellering er en kontorhandling. Dispatch skal ikke kunne omgå
    // workorders.edit ved å velge CANCELLED i statusfeltet.
    if (nextStatus === "CANCELLED" && !hasPermission(access.user, "workorders.edit")) {
      redirect(
        `/kalender/dispatch?error=ikke-tilgang&workOrderId=${encodeURIComponent(workOrderId)}`,
      );
    }

    let result;
    try {
      result = await transitionWorkOrderStatus({
        workOrderId,
        from: access.workOrder.status as WorkStatus,
        to: nextStatus,
        isAdmin: access.user.role === "ADMIN",
        actor: auditActor(access.user),
        action: `Kontoret endret status til: ${nextStatus}`,
      });
    } catch (error) {
      console.error("Feil ved oppdatering av status:", error);
      redirect(
        `/kalender/dispatch?error=ukjent&workOrderId=${encodeURIComponent(workOrderId)}`,
      );
    }
    if (!result.ok) {
      redirect(
        `/kalender/dispatch?error=${result.error}&workOrderId=${encodeURIComponent(workOrderId)}`,
      );
    }

    // Samme varsel som den vanlige statusflyten sender ved kansellering.
    if (nextStatus === "CANCELLED") {
      try {
        await notifyWorkOrderEvent(
          workOrderId,
          "CANCELLED",
          "Oppdraget er kansellert",
          "Oppdraget er kansellert.",
          `/oppdrag/${workOrderId}`,
          `cancelled:${workOrderId}`,
        );
      } catch (error) {
        console.error("Kunne ikke sende kanselleringsvarsel:", error);
      }
    }

    revalidatePath("/kalender/dispatch");
  }

  // Sorter oppdrag: utdelte først, så tildelte
  const unassigned = workOrders.filter(wo => wo.technicians.length === 0);
  const assigned = workOrders.filter(wo => wo.technicians.length > 0);

  const statusLabelFor = (status: string) => {
    switch (status) {
      case "OPEN":
        return t("calendar.dispatch.statusOpen");
      case "IN_PROGRESS":
        return t("calendar.dispatch.statusInProgress");
      case "WAITING":
        return t("calendar.dispatch.statusWaiting");
      case "COMPLETED":
        return t("calendar.dispatch.statusCompleted");
      case "CANCELLED":
        return t("calendar.dispatch.statusCancelled");
      case "PENDING":
        return t("calendar.dispatch.statusPending");
      case "PLANNED":
        return t("calendar.dispatch.statusPlanned");
      default:
        return status;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t("calendar.dispatch.title")}</h1>
            <p className="text-gray-600 text-sm">{t("calendar.dispatch.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/kalender" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition text-sm whitespace-nowrap">
              {t("calendar.dispatch.backToCalendar")}
            </Link>
          </div>
        </div>

        {error === "ugyldig-status" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 p-4 rounded-xl text-sm font-bold">
            {t("calendar.dispatch.invalidStatus")}
          </div>
        )}

        {error && error !== "ugyldig-status" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 p-4 rounded-xl text-sm font-bold">
            {t("calendar.dispatch.genericError")}
          </div>
        )}

        {/* FANER (TABS) FOR Å BYTTE VISNING */}
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-1 bg-gray-200 p-1 rounded-xl min-w-max">
            <Link href="/kalender" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              {t("calendar.common.resources")}
            </Link>
            <Link href="/kalender/maned" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              {t("calendar.common.month")}
            </Link>
            <Link href="/kalender/uke" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              {t("calendar.common.week")}
            </Link>
            <Link href="/kalender/uke-2" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              {t("calendar.common.biweekly")}
            </Link>
            <Link href="/kalender/dispatch" className="px-4 py-2 rounded-lg text-sm font-bold bg-white shadow-sm text-gray-900 pointer-events-none whitespace-nowrap">
              {t("calendar.common.dispatch")}
            </Link>
          </div>
        </div>

        {/* ANTALL UTASSIGNERTE */}
        {unassigned.length > 0 && (
          <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-xl shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-amber-800 text-lg flex items-center gap-2">
                  {t("calendar.dispatch.unassignedCount", { count: unassigned.length })}
                </h2>
                <p className="text-amber-700 text-sm mt-1">{t("calendar.dispatch.unassignedWarning")}</p>
              </div>
              <Link href="/kalender/dispatch" className="bg-amber-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-700 transition whitespace-nowrap text-sm">
                {t("calendar.dispatch.refresh")}
              </Link>
            </div>
          </div>
        )}

        {/* UTASSIGNERTE OPPDRAG */}
        {unassigned.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-200">
              <h2 className="font-bold text-lg text-gray-900">{t("calendar.dispatch.unassignedTitle")}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {unassigned.map(wo => (
                <div
                  key={wo.id}
                  className={`p-4 hover:bg-gray-50 transition ${
                    error && errorWorkOrderId === wo.id
                      ? "bg-red-50 ring-2 ring-inset ring-red-300"
                      : ""
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-base">
                          <Link
                            href={`/oppdrag/${wo.id}`}
                            className="text-gray-900 hover:text-blue-700 hover:underline transition-colors"
                          >
                            {wo.title}
                          </Link>
                        </h3>
                        <DispatchStatusBadge status={wo.status} />
                      </div>
                      <p className="text-[10px] text-gray-600">
                        🏢 {wo.customer?.name || t("calendar.common.noCustomer")}
                        {wo.product && <span className="text-gray-400 ml-1">• {wo.product.model}</span>}
                        {wo.scheduledFor && (
                          <span className="text-gray-400 ml-2">📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo)}</span>
                        )}
                      </p>
                      {formatAddress(wo.customer) && (
                        <p className="text-[10px] text-gray-500 mt-0.5">📍 {formatAddress(wo.customer)}</p>
                      )}
                      {wo.description && (
                        <p className="text-[10px] text-gray-700 italic mt-1">
                          {markdownToPlainText(wo.description)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <ConfirmSubmitForm
                        action={assignTechnician}
                        confirmMessage={t("calendar.dispatch.assignConfirm")}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <select
                          name="technicianId"
                          required
                          className="border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="">{t("calendar.dispatch.selectTechnician")}</option>
                          {availableTechnicians.map(tech => (
                            <option key={tech.id} value={tech.id}>{tech.name} ({tech.role === 'ADMIN' ? t("calendar.dispatch.roleAdmin") : tech.role === 'OFFICE' ? t("calendar.dispatch.roleOffice") : t("calendar.dispatch.roleTechnician")})</option>
                          ))}
                        </select>
                        <button type="submit" className="bg-[var(--primary-color)] text-white px-3 py-2 rounded-xl text-xs font-bold hover:opacity-90 transition whitespace-nowrap">
                          {t("calendar.dispatch.assign")}
                        </button>
                      </ConfirmSubmitForm>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TILDELTE OPPDRAG */}
        {assigned.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-6">
            <div className="bg-gray-50 p-4 border-b border-gray-200">
              <h2 className="font-bold text-lg text-gray-900">{t("calendar.dispatch.assignedTitle")}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {assigned.map(wo => (
                <div
                  key={wo.id}
                  className={`p-4 hover:bg-gray-50 transition ${
                    error && errorWorkOrderId === wo.id
                      ? "bg-red-50 ring-2 ring-inset ring-red-300"
                      : ""
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-base">
                          <Link
                            href={`/oppdrag/${wo.id}`}
                            className="text-gray-900 hover:text-blue-700 hover:underline transition-colors"
                          >
                            {wo.title}
                          </Link>
                        </h3>
                        <DispatchStatusBadge status={wo.status} />
                      </div>
                      <p className="text-[10px] text-gray-600">
                        🏢 {wo.customer?.name || t("calendar.common.noCustomer")}
                        {wo.technicians.length > 0
                          ? ` • 👷 ${wo.technicians.map(t => t.name).join(", ")}`
                          : ""}
                      </p>
                      {formatAddress(wo.customer) && (
                        <p className="text-[10px] text-gray-500 mt-0.5">📍 {formatAddress(wo.customer)}</p>
                      )}
                      {wo.scheduledFor && (
                        <p className="text-[10px] text-gray-500">
                          📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <ConfirmSubmitForm
                        action={removeTechnician}
                        confirmMessage={t("calendar.dispatch.removeConfirm")}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <select
                          name="technicianId"
                          required
                          className="border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-600"
                        >
                          {wo.technicians.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        <button type="submit" className="bg-red-600 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-red-700 transition whitespace-nowrap">
                          {t("calendar.dispatch.remove")}
                        </button>
                      </ConfirmSubmitForm>
                      <form action={updateStatus} className="flex items-center gap-2">
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <select
                          name="status"
                          required
                          className="border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-600"
                        >
                          <option value={wo.status}>{statusLabelFor(wo.status)}</option>
                          <option value="OPEN">{t("calendar.dispatch.statusOpen")}</option>
                          <option value="IN_PROGRESS">{t("calendar.dispatch.statusInProgress")}</option>
                          <option value="WAITING">{t("calendar.dispatch.statusWaiting")}</option>
                          <option value="COMPLETED">{t("calendar.dispatch.statusCompleted")}</option>
                          <option value="CANCELLED">{t("calendar.dispatch.statusCancelled")}</option>
                          <option value="PENDING">{t("calendar.dispatch.statusPending")}</option>
                          <option value="PLANNED">{t("calendar.dispatch.statusPlanned")}</option>
                        </select>
                        <button type="submit" className="bg-gray-900 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-gray-800 transition whitespace-nowrap">
                          {t("calendar.dispatch.update")}
                        </button>
                      </form>
                      <Link href={`/oppdrag/${wo.id}`} className="text-blue-600 text-xs font-bold hover:underline whitespace-nowrap">
                        {t("calendar.dispatch.viewDetails")}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {workOrders.length === 0 && (
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center">
            <p className="text-gray-500 italic">{t("calendar.dispatch.empty")}</p>
          </div>
        )}

      </div>
    </div>
  );
}
