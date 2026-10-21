import Link from "next/link";
import { formatDateTime } from "@/lib/dates";

export default function AuditLogTable({ 
  logs, 
  entityType = null,
  entityId = null,
  showEntityFilter = false,
  page = 1,
  pageSize = 50,
  totalCount = 0,
  baseUrl = ""
}: { 
  logs: any[];
  entityType?: string | null;
  entityId?: string | null;
  showEntityFilter?: boolean;
  page?: number;
  pageSize?: number;
  totalCount?: number;
  baseUrl?: string;
}) {
  const totalPages = Math.ceil((totalCount || 0) / (pageSize || 50));

  // Builds a link to another page while preserving the current query string.
  const pageHref = (targetPage: number) => {
    const [path, query = ""] = baseUrl.split("?");
    const params = new URLSearchParams(query);
    params.set("page", String(targetPage));
    const search = params.toString();
    return search ? `${path}?${search}` : path || ".";
  };

  if (!logs || logs.length === 0) {
    return (
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200 text-center py-8">
        <p className="text-gray-500 italic">Ingen aktivitetslogg funnet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Tidspunkt</th>
            <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Bruker</th>
            <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Handling</th>
            {showEntityFilter && (
              <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Enhet</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {logs.map(log => (
            <tr key={log.id} className="hover:bg-gray-50 transition">
              <td className="px-4 py-3 text-[10px] text-gray-600 font-medium">
                {formatDateTime(log.createdAt)}
              </td>
              <td className="px-4 py-3 text-[10px] font-bold text-gray-900 truncate max-w-[150px]">
                {log.userName || "Ukjent"}
              </td>
              <td className="px-4 py-3 text-[10px] text-gray-800 truncate">
                {log.action}
              </td>
              {showEntityFilter && (
                <td className="px-4 py-3 text-[10px] text-gray-600 truncate max-w-[100px]">
                  {log.entityType}#{log.entityId?.slice(-6).toUpperCase()}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      
      {/* Pagination */}
      {totalCount && totalCount > pageSize && (
        <div className="border-t border-gray-200 p-4 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Side {page} av {totalPages} ({totalCount} oppføringer)
          </div>
          <div className="flex items-center gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition border border-transparent"
              >
                Forrige
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition border border-transparent"
              >
                Neste
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
