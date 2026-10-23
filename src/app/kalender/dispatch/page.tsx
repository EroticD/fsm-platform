import { redirect } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import { markdownToPlainText } from "@/lib/markdown";
import { formatAddress } from "@/lib/address";
import { formatDateRange } from "@/lib/dates";
import { LIMITS, cleanStatus, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import {
  requireWorkOrderAccess,
  staffForDepartment,
  staffScope,
  workOrderScope,
} from "@/lib/access";
import { workOrderStatusSchema } from "@/lib/schemas/workOrder";
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

// Hjelpekomponent for status-etikett
function DispatchStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED': return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200 shadow-sm">✅ Fullført</span>;
    case 'IN_PROGRESS': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm">🔄 Påbegynt</span>;
    case 'CANCELLED': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200 shadow-sm">❌ Kansellert</span>;
    case 'OPEN': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200 shadow-sm">✨ Åpen</span>;
    case 'PENDING': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">⏳ Planlagt</span>;
    case 'PLANNED': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">📅 Planlagt</span>;
    case 'WAITING': return <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold border border-orange-200 shadow-sm">⏸️ Venter</span>;
    default: return <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-xs font-bold border border-gray-200 shadow-sm">{status}</span>;
  }
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.assign")) redirect("/");

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
  async function assignTechnician(formData: FormData) {
    "use server";
    const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
    const technicianId = cleanText(formData.get("technicianId"), { maxLength: LIMITS.line });
    if (!workOrderId || !technicianId) {
      redirect("/kalender/dispatch?error=ugyldig-data");
    }

    const access = await requireWorkOrderAccess("workorders.assign", workOrderId);
    if (!access) redirect("/kalender/dispatch?error=ikke-tilgang");

    // Bare ansatte i oppdragets avdeling kan tildeles.
    const target = await prisma.user.findFirst({
      where: { id: technicianId, ...staffForDepartment(access.workOrder.departmentId) },
      select: { id: true },
    });
    if (!target) redirect("/kalender/dispatch?error=ugyldig-data");

    try {
      // Sjekk om montøren allerede er tildelt
      const existing = await prisma.workOrder.findUnique({
        where: { id: workOrderId },
        include: { technicians: true }
      });

      const alreadyAssigned = existing?.technicians.some(t => t.id === technicianId);

      if (!alreadyAssigned) {
        await prisma.$transaction(async (tx) => {
          await tx.workOrder.update({
            where: { id: workOrderId },
            data: {
              technicians: {
                connect: { id: technicianId }
              }
            }
          });

          await audit(tx, {
            entityType: "WorkOrder",
            entityId: workOrderId,
            action: `Kontoret tildelte montør til oppdraget`,
            actor: auditActor(access.user),
            metadata: { technicianId },
          });
        });
      }

      revalidatePath("/kalender/dispatch");
    } catch (error) {
      console.error("Feil ved tildeling av montør:", error);
      redirect("/kalender/dispatch?error=ukjent");
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
      await prisma.$transaction(async (tx) => {
        await tx.workOrder.update({
          where: { id: workOrderId },
          data: {
            technicians: {
              disconnect: { id: technicianId }
            }
          }
        });

        await audit(tx, {
          entityType: "WorkOrder",
          entityId: workOrderId,
          action: `Kontoret fjernet montør fra oppdraget`,
          actor: auditActor(access.user),
          metadata: { technicianId },
        });
      });

      revalidatePath("/kalender/dispatch");
    } catch (error) {
      console.error("Feil ved fjerning av montør:", error);
      redirect("/kalender/dispatch?error=ukjent");
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

    let result;
    try {
      result = await transitionWorkOrderStatus({
        workOrderId,
        from: access.workOrder.status as WorkStatus,
        to: parsed.data.status as WorkStatus,
        isAdmin: access.user.role === "ADMIN",
        actor: auditActor(access.user),
        action: `Kontoret endret status til: ${parsed.data.status}`,
      });
    } catch (error) {
      console.error("Feil ved oppdatering av status:", error);
      redirect("/kalender/dispatch?error=ukjent");
    }
    if (!result.ok) {
      redirect(`/kalender/dispatch?error=${result.error}`);
    }

    revalidatePath("/kalender/dispatch");
  }

  // Sorter oppdrag: utdelte først, så tildelte
  const unassigned = workOrders.filter(wo => wo.technicians.length === 0);
  const assigned = workOrders.filter(wo => wo.technicians.length > 0);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">🎛️ Dispatch & Ressursstyring</h1>
            <p className="text-gray-600 text-sm">Fordel montører på åpne oppdrag.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/kalender" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition text-sm whitespace-nowrap">
              &larr; Tilbake til kalender
            </Link>
          </div>
        </div>

        {error === "ugyldig-status" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 p-4 rounded-xl text-sm font-bold">
            ⛔ Statusendringen er ikke lovlig fra oppdragets nåværende tilstand.
            Fullførte eller kansellerte oppdrag kan bare gjenåpnes av en administrator.
          </div>
        )}

        {error && error !== "ugyldig-status" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 p-4 rounded-xl text-sm font-bold">
            ⛔ Handlingen kunne ikke utføres. Sjekk feltene og prøv igjen.
          </div>
        )}

        {/* FANER (TABS) FOR Å BYTTE VISNING */}
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-1 bg-gray-200 p-1 rounded-xl min-w-max">
            <Link href="/kalender" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              🎛️ Ressursoversikt
            </Link>
            <Link href="/kalender/maned" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              📅 Måned
            </Link>
            <Link href="/kalender/uke" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              📅 Uke
            </Link>
            <Link href="/kalender/uke-2" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              📅 2 uker
            </Link>
            <Link href="/kalender/dispatch" className="px-4 py-2 rounded-lg text-sm font-bold bg-white shadow-sm text-gray-900 pointer-events-none whitespace-nowrap">
              🎛️ Dispatch
            </Link>
          </div>
        </div>

        {/* ANTALL UTASSIGNERTE */}
        {unassigned.length > 0 && (
          <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-xl shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-amber-800 text-lg flex items-center gap-2">
                  ⚠️ Uten montør ({unassigned.length})
                </h2>
                <p className="text-amber-700 text-sm mt-1">Disse oppdragene mangler montør og må fordeles.</p>
              </div>
              <Link href="/kalender/dispatch" className="bg-amber-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-700 transition whitespace-nowrap text-sm">
                Oppdater
              </Link>
            </div>
          </div>
        )}

        {/* UTASSIGNERTE OPPDRAG */}
        {unassigned.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-200">
              <h2 className="font-bold text-lg text-gray-900">Ikke tildelt montør</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {unassigned.map(wo => (
                <div key={wo.id} className="p-4 hover:bg-gray-50 transition">
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
                        🏢 {wo.customer?.name || "Uten kunde"}
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
                        confirmMessage="Tildel montør til dette oppdraget?"
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <select
                          name="technicianId"
                          required
                          className="border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="">-- Velg montør --</option>
                          {availableTechnicians.map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.role === 'ADMIN' ? 'Admin' : t.role === 'OFFICE' ? 'Kontor' : 'Montør'})</option>
                          ))}
                        </select>
                        <button type="submit" className="bg-[var(--primary-color)] text-white px-3 py-2 rounded-xl text-xs font-bold hover:opacity-90 transition whitespace-nowrap">
                          Tildel
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
              <h2 className="font-bold text-lg text-gray-900">Tildelte oppdrag</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {assigned.map(wo => (
                <div key={wo.id} className="p-4 hover:bg-gray-50 transition">
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
                        🏢 {wo.customer?.name || "Uten kunde"}
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
                        confirmMessage="Fjern montør fra dette oppdraget?"
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
                          Fjern
                        </button>
                      </ConfirmSubmitForm>
                      <form action={updateStatus} className="flex items-center gap-2">
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <select
                          name="status"
                          required
                          className="border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-600"
                        >
                          <option value={wo.status}>{wo.status === 'OPEN' ? 'Åpen' : wo.status === 'IN_PROGRESS' ? 'Påbegynt' : wo.status === 'COMPLETED' ? 'Fullført' : wo.status === 'CANCELLED' ? 'Kansellert' : wo.status === 'PENDING' ? 'Planlagt' : wo.status === 'PLANNED' ? 'Planlagt' : wo.status === 'WAITING' ? 'Venter' : wo.status}</option>
                          <option value="OPEN">Åpen</option>
                          <option value="IN_PROGRESS">Påbegynt</option>
                          <option value="WAITING">Venter</option>
                          <option value="COMPLETED">Fullført</option>
                          <option value="CANCELLED">Kansellert</option>
                          <option value="PENDING">Planlagt</option>
                          <option value="PLANNED">Planlagt</option>
                        </select>
                        <button type="submit" className="bg-gray-900 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-gray-800 transition whitespace-nowrap">
                          Oppdater
                        </button>
                      </form>
                      <Link href={`/oppdrag/${wo.id}`} className="text-blue-600 text-xs font-bold hover:underline whitespace-nowrap">
                        Se detaljer &rarr;
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
            <p className="text-gray-500 italic">Ingen åpne oppdrag å fordele.</p>
          </div>
        )}

      </div>
    </div>
  );
}
