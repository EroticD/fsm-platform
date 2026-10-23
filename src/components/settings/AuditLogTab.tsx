import Link from "next/link";
import AuditLogTable from "@/components/AuditLogTable";
import type { AuditLog } from "@prisma/client";

type AuditLogTabProps = {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  dateFrom: string;
  dateTo: string;
};

export default function AuditLogTab({
  logs,
  total,
  page,
  pageSize,
  search,
  dateFrom,
  dateTo,
}: AuditLogTabProps) {
  const baseUrl = `/innstillinger?tab=auditlog${search ? `&search=${search}` : ""}${dateFrom ? `&dateFrom=${dateFrom}` : ""}${dateTo ? `&dateTo=${dateTo}` : ""}`;

  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
      <h2 className="text-xl font-bold text-gray-900 mb-6">📋 Systemaktivitetslogg</h2>
      <p className="text-gray-500 text-sm mb-6">Alle systemhendelser og brukeraktiviteter.</p>

      {/* FILTER OG SØK */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
        <form method="GET" className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <input
            type="text"
            name="search"
            placeholder="Søk i aktivitetslogg..."
            defaultValue={search}
            className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          />
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
          <button type="submit" className="bg-gray-900 text-white px-4 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
            Søk
          </button>
          {(search || dateFrom || dateTo) && (
            <Link href="?tab=auditlog" className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition whitespace-nowrap">
              Nullstill
            </Link>
          )}
        </form>
      </div>

      <AuditLogTable
        logs={logs}
        showEntityFilter
        page={page}
        pageSize={pageSize}
        totalCount={total}
        baseUrl={baseUrl}
      />
    </div>
  );
}
