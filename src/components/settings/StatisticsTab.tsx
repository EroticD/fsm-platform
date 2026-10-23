import Link from "next/link";
import type { getStatistics } from "@/server/settings";

type StatisticsData = Extract<
  Awaited<ReturnType<typeof getStatistics>>,
  { ok: true }
>["data"];

type StatisticsTabProps = {
  data: StatisticsData;
  dateFrom: string;
  dateTo: string;
  statusFilter: string;
  customerFilter: string;
  technicianFilter: string;
};

export default function StatisticsTab({
  data,
  dateFrom,
  dateTo,
  statusFilter,
  customerFilter,
  technicianFilter,
}: StatisticsTabProps) {
  const {
    statsCustomers,
    statsTechnicians,
    totalWorkOrders,
    byStatus,
    byTechnician,
    byCustomer,
    monthlyTrend,
  } = data;

  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
      <h2 className="text-xl font-bold text-gray-900 mb-6">📊 Statistikk</h2>
      <p className="text-gray-500 text-sm mb-6">Oppdragsstatistikk og filtrering.</p>

      {/* FILTER */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
        <form method="GET" className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <input
            type="date"
            name="dateFrom"
            placeholder="Fra dato"
            defaultValue={dateFrom}
            className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          />
          <input
            type="date"
            name="dateTo"
            placeholder="Til dato"
            defaultValue={dateTo}
            className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          />
          <select
            name="status"
            defaultValue={statusFilter || ""}
            className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          >
            <option value="">Alle statuser</option>
            <option value="PLANNED">Planlagt</option>
            <option value="IN_PROGRESS">Påbegynt</option>
            <option value="WAITING">Venter</option>
            <option value="COMPLETED">Fullført</option>
            <option value="CANCELLED">Kansellert</option>
            <option value="OPEN">Åpen</option>
            <option value="PENDING">Planlagt (PENDING)</option>
          </select>
          <select
            name="customer"
            defaultValue={customerFilter || ""}
            className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          >
            <option value="">Alle kunder</option>
            {statsCustomers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
          <select
            name="technician"
            defaultValue={technicianFilter || ""}
            className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          >
            <option value="">Alle montører</option>
            {statsTechnicians.map((technician) => (
              <option key={technician.id} value={technician.id}>{technician.name}</option>
            ))}
          </select>
          <button type="submit" className="bg-gray-900 text-white px-4 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
            Filtrer
          </button>
          {(dateFrom || dateTo || statusFilter || customerFilter || technicianFilter) && (
            <Link href="?tab=statistikk" className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition whitespace-nowrap">
              Nullstill
            </Link>
          )}
        </form>
      </div>

      {/* STATISTIKK KORT */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Totalt oppdrag</p>
          <p className="text-3xl font-black text-gray-900">{totalWorkOrders}</p>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Planlagt</p>
          <p className="text-3xl font-black text-yellow-600">{byStatus.PLANNED || 0}</p>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Påbegynt</p>
          <p className="text-3xl font-black text-blue-600">{byStatus.IN_PROGRESS || 0}</p>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Fullført</p>
          <p className="text-3xl font-black text-green-600">{byStatus.COMPLETED || 0}</p>
        </div>
      </div>

      {/* MÅNEDLIG TREND */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 mb-6">
        <h3 className="font-bold text-gray-900 mb-4">Månedlig trend</h3>
        <div className="flex items-end gap-2 h-40">
          {Object.entries(monthlyTrend as Record<string, number>)
            .sort()
            .slice(-6)
            .map(([month, count]: [string, number]) => {
              const maxCount = Math.max(...Object.values(monthlyTrend));
              const height = maxCount > 0 ? Math.max(10, (count / maxCount) * 100) : 10;
              return (
                <div key={month} className="flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-blue-600 rounded-t-sm"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[10px] text-gray-500">{month.slice(5)}</span>
                  <span className="text-[10px] font-bold text-gray-900">{count}</span>
                </div>
              );
            })}
        </div>
        <p className="text-[10px] text-gray-500 mt-2 text-right">
          Siste 6 måneder med data
        </p>
      </div>

      {/* PER MONTØR */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 mb-6">
        <h3 className="font-bold text-gray-900 mb-4">Per montør</h3>
        <div className="space-y-2">
          {Object.entries(byTechnician as Record<string, number>)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <div key={name} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                <span className="text-sm font-medium text-gray-900">{name}</span>
                <span className="text-sm font-bold text-gray-700">{count} oppdrag</span>
              </div>
            ))}
          {Object.keys(byTechnician).length === 0 && (
            <p className="text-sm text-gray-500 italic text-center py-4">Ingen data</p>
          )}
        </div>
      </div>

      {/* PER KUNDE */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200">
        <h3 className="font-bold text-gray-900 mb-4">Per kunde</h3>
        <div className="space-y-2">
          {Object.entries(byCustomer as Record<string, number>)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => (
              <div key={name} className="flex justify-between items-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                <span className="text-sm font-medium text-gray-900 truncate max-w-xs">{name}</span>
                <span className="text-sm font-bold text-gray-700">{count} oppdrag</span>
              </div>
            ))}
          {Object.keys(byCustomer).length === 0 && (
            <p className="text-sm text-gray-500 italic text-center py-4">Ingen data</p>
          )}
        </div>
      </div>
    </div>
  );
}
