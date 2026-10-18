import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import FullCalendarClient from "@/app/kalender/FullCalendarClient";

type EventData = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
};

export default async function WeekCalendarPage() {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (user?.role === "TECHNICIAN") redirect("/mine-oppdrag");

  // Hent oppdrag i en bred datoøk (6 måneder bakover og fremover)
  // slik at FullCalendar kan navigere mellom uker uten å hente nye data
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthsAhead = new Date();
  sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      scheduledFor: {
        gte: sixMonthsAgo,
        lte: sixMonthsAhead,
      },
    },
    include: {
      customer: true,
      technicians: true,
    },
    orderBy: {
      scheduledFor: 'asc',
    },
  });

  const events: EventData[] = workOrders.map(wo => ({
    id: wo.id,
    title: wo.title,
    start: wo.scheduledFor ? wo.scheduledFor.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    allDay: true,
  }));

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex justify-between items-center border-b border-gray-300 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">📅 Ukekalender</h1>
            <p className="text-gray-600 mt-1">Ukevisning med ukenumre. Dra oppdrag for å endre dato.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/kalender" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition">
              &larr; Hjem
            </Link>
            <Link href="/oppdrag/ny" className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-sm transition flex items-center gap-2">
              ➕ Nytt oppdrag
            </Link>
          </div>
        </div>

        {/* FANER (TABS) */}
        <div className="flex gap-1 bg-gray-200 p-1 rounded-xl w-max">
          <Link href="/kalender" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            🎛️ Ressursoversikt
          </Link>
          <Link href="/kalender/maned" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            📅 Måned
          </Link>
          <Link href="/kalender/uke" className="px-5 py-2 rounded-lg text-sm font-bold bg-white shadow-sm text-gray-900 pointer-events-none">
            📅 Uke
          </Link>
          <Link href="/kalender/uke-2" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            📅 2 uker
          </Link>
          <Link href="/kalender/dispatch" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            🎛️ Dispatch
          </Link>
        </div>

        {/* KALENDER */}
        <FullCalendarClient
          events={events}
          view="dayGridWeek"
          weekNumbers={true}
        />

      </div>
    </div>
  );
}
