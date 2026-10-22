import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { formatAddress } from "@/lib/address";
import { formatDateRange } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";

export default async function CalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  // Montører får se kalenderen, men ikke kontorets verktøy (dispatch-tavla og
  // oppretting av oppdrag fra kontoret er egne, sperrede sider).
  const office = hasPermission(user, "workorders.assign");
  const canCreate = hasPermission(user, "workorders.create");

  // Hent alle ansatte som kan ta oppdrag, innenfor egen avdeling.
  const technicians = await prisma.user.findMany({
    where: staffScope(user),
    orderBy: { name: 'asc' }
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScope(user),
        {
          status: { not: "CANCELLED" },
          OR: [
            { status: { not: "COMPLETED" } },
            { scheduledFor: { gte: thirtyDaysAgo } }
          ],
        },
      ],
    },
    include: {
      customer: true,
      technicians: true
    },
    orderBy: {
      scheduledFor: 'asc'
    }
  });

  const unassignedJobs = workOrders.filter(wo => wo.technicians.length === 0 && wo.status !== "COMPLETED");

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">📅 Planlegging & Kontroll</h1>
            <p className="text-gray-600 mt-1 text-sm">Styr ressurser, montører og fremdriftsplaner.</p>
          </div>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            <Link href="/" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition text-sm">
              &larr; Hjem
            </Link>
            {canCreate && (
              <Link href="/oppdrag/ny" className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-lg font-bold hover:opacity-90 shadow-sm transition flex items-center gap-2 text-sm">
                ➕ Nytt oppdrag
              </Link>
            )}
          </div>
        </div>

        {/* FANER (TABS) FOR Å BYTTE VISNING - scrollable on mobile */}
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-1 bg-gray-200 p-1 rounded-xl min-w-max">
            <Link href="/kalender" className="px-4 py-2 rounded-lg text-sm font-bold bg-white shadow-sm text-gray-900 pointer-events-none whitespace-nowrap">
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
            {office && (
              <Link href="/kalender/dispatch" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
                🎛️ Dispatch
              </Link>
            )}
          </div>
        </div>

        {/* VARSEL: UFORDELTE OPPDRAG */}
        {unassignedJobs.length > 0 && (
          <div className="bg-red-50 border-2 border-red-200 p-4 sm:p-6 rounded-2xl shadow-sm">
            <h2 className="font-bold text-red-800 text-lg flex items-center gap-2 mb-2">
              ⚠️ Ufordelte oppdrag ({unassignedJobs.length})
            </h2>
            <p className="text-sm text-red-600 mb-4">Følgende oppdrag mangler montør og må fordeles!</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {unassignedJobs.map(wo => (
                <Link href={`/oppdrag/${wo.id}`} key={wo.id} className="block group bg-white p-3 sm:p-4 rounded-xl border border-red-100 hover:border-red-400 shadow-sm transition">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-bold text-red-500 uppercase">
                      {formatDateRange(wo.scheduledFor, wo.scheduledTo) || "Ingen dato"}
                    </span>
                  </div>
                  <p className="font-bold text-gray-900 text-sm group-hover:text-red-700">{wo.title}</p>
                  <p className="text-[10px] text-gray-600 mt-1 truncate">🏢 {wo.customer?.name || "Uten kunde"}</p>
                  {formatAddress(wo.customer) && (
                    <p className="text-[10px] text-gray-500 mt-0.5">📍 {formatAddress(wo.customer)}</p>
                  )}
                  <div className="mt-3">
                    <span className="bg-red-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-sm">Tildel montør &rarr;</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* RESSURSOVERSIKT: MONTØRER */}
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-4">Montøroversikt</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {technicians.map(tech => {
              const techJobs = workOrders.filter(wo => wo.technicians.some(t => t.id === tech.id));
              const activeJobs = techJobs.filter(wo => wo.status !== "COMPLETED");
              const completedJobs = techJobs.filter(wo => wo.status === "COMPLETED");

              return (
                <div key={tech.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-5 flex flex-col h-full">
                  <div className="flex justify-between items-center border-b pb-3 sm:pb-4 mb-3 sm:mb-4">
                    <h3 className="font-bold text-gray-900 text-base sm:text-lg flex items-center gap-2">
                      👷 {tech.name}
                    </h3>
                    <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-1 rounded-lg">
                      {activeJobs.length} aktive
                    </span>
                  </div>

                  <div className="flex-1 space-y-3">
                    {activeJobs.length === 0 ? (
                      <div className="bg-gray-50 border border-dashed rounded-xl p-4 sm:p-6 text-center">
                        <p className="text-[10px] text-gray-400 italic font-medium">Ingen aktive oppdrag.</p>
                      </div>
                    ) : (
                      activeJobs.map(wo => {
                        let badgeColor = "bg-gray-100 text-gray-700";
                        let badgeText = "Planlagt";
                        if (wo.status === "IN_PROGRESS") { badgeColor = "bg-blue-100 text-blue-800"; badgeText = "Påbegynt"; }
                        else if (wo.status === "WAITING") { badgeColor = "bg-orange-100 text-orange-800"; badgeText = "Venter"; }

                        return (
                          <Link href={`/oppdrag/${wo.id}`} key={wo.id} className="block group">
                            <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200 group-hover:border-blue-400 hover:shadow-sm transition">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                  {formatDateRange(wo.scheduledFor, wo.scheduledTo) || "Ingen dato"}
                                </span>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${badgeColor}`}>
                                  {badgeText}
                                </span>
                              </div>
                              <p className="font-bold text-gray-900 text-sm group-hover:text-blue-700 leading-tight mb-1">{wo.title}</p>
                              <p className="text-[10px] text-gray-600 truncate">🏢 {wo.customer?.name || "Uten kunde"}</p>
                              {formatAddress(wo.customer) && (
                                <p className="text-[10px] text-gray-500">📍 {formatAddress(wo.customer)}</p>
                              )}
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>

                  {completedJobs.length > 0 && (
                    <div className="mt-4 pt-3 border-t">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Nylig fullført ({completedJobs.length})
                      </p>
                      <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
                        {completedJobs.map(wo => (
                          <Link href={`/oppdrag/${wo.id}`} key={wo.id} className="flex justify-between items-center bg-green-50/50 p-2 rounded-lg border border-green-100 hover:bg-green-50 transition">
                            <span className="text-[10px] font-medium text-gray-700 truncate max-w-[200px]">{wo.title}</span>
                            <span className="text-[9px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold">✅ Fullført</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
