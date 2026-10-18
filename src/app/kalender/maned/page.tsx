import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";

// Hjelpefunksjon for å beregne ISO-ukenummer (uke 1 inneholder første torsdag i året)
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export default async function MonthCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string, year?: string }> }) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });

  const resolvedParams = await searchParams;
  const today = new Date();

  // Bestemmer hvilken måned/år som skal vises (basert på URL eller dagens dato)
  const currentYear = resolvedParams.year ? parseInt(resolvedParams.year) : today.getFullYear();
  const currentMonth = resolvedParams.month ? parseInt(resolvedParams.month) - 1 : today.getMonth();

  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);

  // Henter oppdrag kun for den valgte måneden
  const workOrders = await prisma.workOrder.findMany({
    where: {
      scheduledFor: {
        gte: firstDayOfMonth,
        lte: new Date(currentYear, currentMonth + 1, 1)
      }
    },
    include: {
      customer: true,
      technicians: true
    }
  });

  // --- LOGIKK FOR Å BYGGE KALENDER-GRIDET (MANDAG-SØNDAG) ---
  let startDayOfWeek = firstDayOfMonth.getDay();
  startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // Setter Mandag som start på uken (0)

  const daysInMonth = lastDayOfMonth.getDate();
  const weeks: any[][] = [];
  let currentWeek = Array.from({length: 7}, () => ({ day: null as number | null, date: null as Date | null, orders: [] as any[] }));

  // Fyller inn dager
  for(let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentYear, currentMonth, day);
    const dayOfWeek = (startDayOfWeek + day - 1) % 7;

    const dailyOrders = workOrders.filter(wo => {
       if (!wo.scheduledFor) return false;
       const d = new Date(wo.scheduledFor);
       return d.getDate() === day && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    currentWeek[dayOfWeek] = { day, date, orders: dailyOrders };

    // Hvis det er Søndag, eller siste dag i måneden, lagre uken og start en ny
    if (dayOfWeek === 6 || day === daysInMonth) {
      weeks.push(currentWeek);
      currentWeek = Array.from({length: 7}, () => ({ day: null, date: null, orders: [] }));
    }
  }

  // Navigasjon for neste/forrige måned
  const urlMonth = currentMonth + 1;
  const prevMonth = urlMonth === 1 ? 12 : urlMonth - 1;
  const prevYear = urlMonth === 1 ? currentYear - 1 : currentYear;
  const nextMonth = urlMonth === 12 ? 1 : urlMonth + 1;
  const nextYear = urlMonth === 12 ? currentYear + 1 : currentYear;

  const monthNames = ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"];

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
            <Link href="/oppdrag/ny" className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-lg font-bold hover:opacity-90 shadow-sm transition flex items-center gap-2 text-sm">
              ➕ Nytt oppdrag
            </Link>
          </div>
        </div>

        {/* FANER (TABS) FOR Å BYTTE VISNING - scrollable on mobile */}
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-1 bg-gray-200 p-1 rounded-xl min-w-max">
            <Link href="/kalender" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              🎛️ Ressursoversikt
            </Link>
            <Link href="/kalender/maned" className="px-4 py-2 rounded-lg text-sm font-bold bg-white shadow-sm text-gray-900 pointer-events-none whitespace-nowrap">
              📅 Måned
            </Link>
            <Link href="/kalender/uke" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              📅 Uke
            </Link>
            <Link href="/kalender/uke-2" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              📅 2 uker
            </Link>
            <Link href="/kalender/dispatch" className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition whitespace-nowrap">
              🎛️ Dispatch
            </Link>
          </div>
        </div>

        {/* MÅNEDS-NAVIGASJON */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white px-4 py-3 rounded-xl border shadow-sm">
          <div className="flex items-center gap-2">
            <Link href={`/kalender/maned?year=${prevYear}&month=${prevMonth}`} className="text-gray-500 hover:text-blue-600 font-bold text-sm p-1">&larr; Forrige</Link>
            <h2 className="text-lg font-bold text-center uppercase tracking-wide">{monthNames[currentMonth]} {currentYear}</h2>
            <Link href={`/kalender/maned?year=${nextYear}&month=${nextMonth}`} className="text-gray-500 hover:text-blue-600 font-bold text-sm p-1">Neste &rarr;</Link>
          </div>
        </div>

        {/* KALENDER GRID - horizontally scrollable on mobile */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto mt-4">
          
          {/* Uke-header (Uke nr + Mandag-Søndag) */}
          <div className="grid grid-cols-8 min-w-[700px] border-b border-gray-200 bg-gray-50">
            <div className="p-2 text-center text-[10px] font-bold text-gray-500 uppercase tracking-wider border-r last:border-r-0">
              Uke
            </div>
            {["Ma", "Ti", "On", "To", "Fr", "Lø", "Sø"].map(day => (
              <div key={day} className="p-2 text-center text-[10px] font-bold text-gray-500 uppercase tracking-wider border-r last:border-r-0">
                {day}
              </div>
            ))}
          </div>

          {/* Dager i måneden */}
          <div className="flex flex-col min-w-[700px]">
            {weeks.map((week, wIdx) => {
              const firstDay = week.find(d => d.day !== null);
              const weekNumber = firstDay ? getISOWeek(firstDay.date!) : "";
              return (
                <div key={wIdx} className="grid grid-cols-8 min-w-[700px] border-b last:border-b-0 border-gray-100">
                  {/* Ukenummer */}
                  <div className="p-2 border-r last:border-r-0 bg-gray-100 text-center">
                    <span className="text-[10px] font-bold text-gray-400">#{weekNumber}</span>
                  </div>
                  {week.map((dayObj, dIdx) => {
                    const isToday = dayObj.date?.toDateString() === today.toDateString();

                    return (
                      <div key={dIdx} className={`min-h-[120px] p-1.5 border-r last:border-r-0 ${dayObj.day ? 'bg-white' : 'bg-gray-50'} transition hover:bg-gray-50`}>
                        {dayObj.day && (
                          <>
                            <div className="text-right mb-1">
                              <span className={`inline-block text-xs font-bold rounded-full w-5 h-5 leading-5 text-center ${isToday ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600'}`}>
                                {dayObj.day}
                              </span>
                            </div>
                            
                            <div className="space-y-1">
                              {dayObj.orders.map((wo: any) => {
                                // Fargekoding på oppdrag basert på status
                                let style = "bg-gray-50 border-gray-200 text-gray-700";
                                if (wo.status === "IN_PROGRESS") style = "bg-blue-50 border-blue-200 text-blue-800";
                                else if (wo.status === "WAITING") style = "bg-orange-50 border-orange-200 text-orange-800";
                                else if (wo.status === "COMPLETED") style = "bg-green-50 border-green-200 text-green-800 opacity-60";

                                return (
                                  <Link href={`/oppdrag/${wo.id}`} key={wo.id} className={`block text-[10px] p-1 rounded border shadow-sm truncate hover:shadow ${style}`}>
                                    <div className="flex justify-between items-center mb-0.5">
                                      <span className="font-bold truncate">{wo.title}</span>
                                      {wo.technicians.length === 0 && <span className="text-[9px]" title="Mangler montør">⚠️</span>}
                                    </div>
                                    <span className="text-[9px] truncate opacity-90 block">{wo.customer.name}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
