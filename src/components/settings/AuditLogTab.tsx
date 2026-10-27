import Link from "next/link";
import { getTranslations } from "next-intl/server";
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

export default async function AuditLogTab({
  logs,
  total,
  page,
  pageSize,
  search,
  dateFrom,
  dateTo,
}: AuditLogTabProps) {
  const t = await getTranslations("common");
  // Bevar alle aktive filtre når man blar, og kod verdiene riktig.
  const baseParams = new URLSearchParams({ tab: "auditlog" });
  if (search) baseParams.set("search", search);
  if (dateFrom) baseParams.set("dateFrom", dateFrom);
  if (dateTo) baseParams.set("dateTo", dateTo);
  const baseUrl = `/innstillinger?${baseParams.toString()}`;

  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
      <h2 className="text-xl font-bold text-gray-900 mb-6">📋 {t("settings.auditLog.title")}</h2>
      <p className="text-gray-500 text-sm mb-6">{t("settings.auditLog.desc")}</p>

      {/* FILTER OG SØK */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
        <form method="GET" className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <input type="hidden" name="tab" value="auditlog" />
          <input
            type="text"
            name="search"
            placeholder={t("settings.auditLog.searchPlaceholder")}
            defaultValue={search}
            className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          />
          <input
            type="date"
            name="dateFrom"
            placeholder={t("settings.auditLog.fromDate")}
            defaultValue={dateFrom}
            className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          />
          <input
            type="date"
            name="dateTo"
            placeholder={t("settings.auditLog.toDate")}
            defaultValue={dateTo}
            className="border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
          />
          <button type="submit" className="bg-gray-900 text-white px-4 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
            {t("settings.auditLog.search")}
          </button>
          {(search || dateFrom || dateTo) && (
            <Link href="?tab=auditlog" className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition whitespace-nowrap">
              {t("settings.auditLog.reset")}
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
