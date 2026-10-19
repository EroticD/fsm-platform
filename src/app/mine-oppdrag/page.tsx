import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import { formatAddress } from "@/lib/address";
import { formatDateRange } from "@/lib/dates";

// Hjelpekomponent for status-etikett
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED': return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200">✅ Fullført</span>;
    case 'IN_PROGRESS': return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200">🔄 Påbegynt</span>;
    case 'CANCELLED': return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200">❌ Kansellert</span>;
    case 'OPEN': return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200">✨ Åpen</span>;
    case 'PLANNED': return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200">📅 Planlagt</span>;
    case 'WAITING': return <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-xs font-bold border border-orange-200">⏸️ Venter</span>;
    default: return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200">⏳ Planlagt</span>;
  }
}

export default async function TechnicianDashboard({ 
  searchParams 
}: { 
  searchParams: Promise<{ q?: string }> 
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) redirect("/api/auth/signin");

  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q?.trim() || "";

  // 1. Hent oppdrag som er tildelt denne montøren
  let assignedWorkOrders: any[] = [];
  // 2. Hent oppdrag som IKKE har noen tildelte montører i det hele tatt
  let unassignedWorkOrders: any[] = [];

  if (searchQuery) {
    assignedWorkOrders = await prisma.workOrder.findMany({
      where: {
        technicians: { some: { id: user.id } },
        OR: [
          { title: { contains: searchQuery, mode: 'insensitive' } },
          { description: { contains: searchQuery, mode: 'insensitive' } },
          { customer: { name: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { city: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { address: { contains: searchQuery, mode: 'insensitive' } } }
        ]
      },
      include: { customer: true, reports: true, technicians: true, tags: true },
      orderBy: { scheduledFor: 'asc' }
    });

    unassignedWorkOrders = await prisma.workOrder.findMany({
      where: {
        technicians: { none: {} },
        OR: [
          { title: { contains: searchQuery, mode: 'insensitive' } },
          { description: { contains: searchQuery, mode: 'insensitive' } },
          { customer: { name: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { city: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { address: { contains: searchQuery, mode: 'insensitive' } } }
        ]
      },
      include: { customer: true, reports: true, technicians: true, tags: true },
      orderBy: { scheduledFor: 'asc' }
    });
  } else {
    assignedWorkOrders = await prisma.workOrder.findMany({
      where: {
        technicians: { some: { id: user.id } }
      },
      include: { customer: true, reports: true, technicians: true, tags: true },
      orderBy: { scheduledFor: 'asc' }
    });

    unassignedWorkOrders = await prisma.workOrder.findMany({
      where: {
        technicians: { none: {} }
      },
      include: { customer: true, reports: true, technicians: true, tags: true },
      orderBy: { scheduledFor: 'asc' }
    });
  }

  // Del opp de tildelte oppdragene i "Aktive / Kommende" og "Fullførte"
  const activeAssigned = assignedWorkOrders.filter(wo => wo.status !== 'COMPLETED' && wo.status !== 'CANCELLED');
  const completedAssigned = assignedWorkOrders.filter(wo => wo.status === 'COMPLETED' || wo.status === 'CANCELLED');

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900">Hei, {user.name || "Montør"} 👋</h1>
            <p className="text-sm text-gray-500 font-medium">Felt-portal for oppdrag og kalender.</p>
          </div>
          <form action="/api/auth/signout" method="POST">
            <button type="submit" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap">
              Logg ut
            </button>
          </form>
        </div>

        {/* SØKEFELT */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-gray-200">
          <form method="GET" action="/mine-oppdrag" className="flex gap-2 sm:gap-3 flex-wrap">
            <input
              type="text"
              name="q"
              defaultValue={searchQuery}
              placeholder="🔍 Søk i oppdrag, kunder eller stedsnavn..."
              className="flex-1 min-w-[200px] border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
            />
            <button type="submit" className="bg-blue-700 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap text-sm">
              Søk
            </button>
            {searchQuery && (
              <Link href="/mine-oppdrag" className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition flex items-center justify-center whitespace-nowrap text-sm">
                Nullstill
              </Link>
            )}
          </form>
        </div>

        {/* SEKSJON 1: KALENDER / KOMMENDE OPPRETTEDE OPPRAG (Tildelt deg) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-gray-900">📅 Dine kommende oppdrag ({activeAssigned.length})</h2>
          </div>

          {activeAssigned.length === 0 ? (
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 text-center">
              <p className="text-sm text-gray-500 italic">Ingen aktive oppdrag i din kalender akkurat nå.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeAssigned.map(wo => (
                <Link
                  key={wo.id}
                  href={`/mine-oppdrag/${wo.id}`}
                  className="block bg-white hover:bg-blue-50/40 border-2 border-gray-200 hover:border-blue-300 p-3 sm:p-4 rounded-2xl transition shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                    <StatusBadge status={wo.status} />
                  </div>

                  <p className="text-[10px] text-gray-600 font-medium">
                    🏢 {wo.customer.name}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}
                  {wo.tags && wo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {wo.tags.map((tag: any) => (
                        <span
                          key={tag.id}
                          className="text-white px-2 py-0.5 rounded-full text-[9px] font-bold shadow-sm"
                          style={{ backgroundColor: tag.color || "#3b82f6" }}
                        >
                          🏷️ {tag.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between items-center text-[10px] pt-2 border-t border-gray-100 text-gray-500 font-medium">
                    <span className="font-bold text-gray-700 bg-gray-100 px-2 py-1 rounded-lg">
                      📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo) || "Ingen dato satt"}
                    </span>
                    <span className="font-black text-blue-600 hover:underline whitespace-nowrap">
                      Åpne oppdrag &rarr;
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* SEKSJON 2: IKKE TILDELTE OPPDRAG */}
        {unassignedWorkOrders.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900">⚠️ Ledige / Ikke tildelte oppdrag ({unassignedWorkOrders.length})</h2>
              <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-1 rounded-full">Krever tildeling / utførelse</span>
            </div>

            <div className="space-y-3">
              {unassignedWorkOrders.map(wo => (
                <Link
                  key={wo.id}
                  href={`/mine-oppdrag/${wo.id}`}
                  className="block bg-amber-50/40 hover:bg-amber-50 border-2 border-amber-200 hover:border-amber-300 p-3 sm:p-4 rounded-2xl transition shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                    <StatusBadge status={wo.status} />
                  </div>

                  <p className="text-[10px] text-gray-600 font-medium">
                    🏢 {wo.customer.name}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}

                  <div className="flex justify-between items-center text-[10px] pt-2 border-t border-amber-200 text-gray-600 font-medium">
                    <span className="font-bold bg-white px-2 py-1 rounded-lg border border-amber-200">
                      📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo) || "Ingen dato satt"}
                    </span>
                    <span className="font-black text-amber-800 hover:underline whitespace-nowrap">
                      Se og ta oppdrag &rarr;
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* SEKSJON 3: HISTORIKK OVER FULLFØRTE OPPRAG */}
        {completedAssigned.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h2 className="text-lg font-black text-gray-900">📂 Fullførte oppdrag / Historikk ({completedAssigned.length})</h2>

            <div className="space-y-3">
              {completedAssigned.map(wo => (
                <Link
                  key={wo.id}
                  href={`/mine-oppdrag/${wo.id}`}
                  className="block bg-white hover:bg-gray-50 border-2 border-gray-200 p-3 sm:p-4 rounded-2xl transition opacity-75 hover:opacity-100 shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                    <h3 className="font-bold text-gray-800 text-base">{wo.title}</h3>
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="text-[10px] text-gray-500 font-medium">
                    🏢 {wo.customer.name} • Fullført / Arkivert
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
