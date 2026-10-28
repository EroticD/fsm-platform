import Link from "next/link";
import type { AuditLog } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime, formatDateTimeLocalized } from "@/lib/dates";
import { describeAuditAction, type AuditTranslator } from "@/lib/audit-actions";
import EmptyState from "@/components/EmptyState";
import Pagination, {
  clampPage,
  paginationLabels,
} from "@/components/Pagination";

export default async function AuditLogTable({
  logs,
  showEntityFilter = false,
  page = 1,
  pageSize = 50,
  totalCount = 0,
  baseUrl = "",
}: {
  logs: AuditLog[];
  entityType?: string | null;
  entityId?: string | null;
  showEntityFilter?: boolean;
  page?: number;
  pageSize?: number;
  totalCount?: number;
  baseUrl?: string;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const translate = t as unknown as AuditTranslator;
  const safePageSize = Math.max(1, pageSize || 50);
  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / safePageSize));
  const currentPage = clampPage(page, totalPages);

  // Builds a link to another page while preserving the current query string.
  const pageHref = (targetPage: number) => {
    const [path, query = ""] = baseUrl.split("?");
    const params = new URLSearchParams(query);
    params.set("page", String(targetPage));
    const search = params.toString();
    return search ? `${path}?${search}` : path || ".";
  };

  if (!logs || logs.length === 0) {
    // En gammel lenke kan peke forbi siste side. Da er listen tom selv om
    // loggen har oppføringer – vis en vei tilbake i stedet for tom side.
    const stalePage = Boolean(totalCount) && page > totalPages;

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <EmptyState
          icon={stalePage ? "🔎" : "📋"}
          title={
            stalePage
              ? t("components.auditLog.emptyPageTitle")
              : t("components.auditLog.empty")
          }
          description={
            stalePage
              ? t("components.auditLog.emptyPageDescription")
              : undefined
          }
          action={
            stalePage ? (
              <Link
                href={pageHref(totalPages)}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                {t("components.auditLog.goToLastPage")}
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div
        className="overflow-x-auto"
        role="region"
        aria-label={t("components.auditLog.tableLabel")}
        tabIndex={0}
      >
        <table className="hidden w-full text-left text-sm sm:table">
          <caption className="sr-only">
            {t("components.auditLog.caption")}
          </caption>
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500"
              >
                {t("components.auditLog.time")}
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500"
              >
                {t("components.auditLog.user")}
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500"
              >
                {t("components.auditLog.action")}
              </th>
              {showEntityFilter && (
                <th
                  scope="col"
                  className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-500"
                >
                  {t("components.auditLog.entity")}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map((log) => (
              <tr key={log.id} className="transition hover:bg-gray-50">
                <th
                  scope="row"
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-600"
                >
                  <time dateTime={formatDateTime(log.createdAt)}>
                    {formatDateTimeLocalized(log.createdAt, locale)}
                  </time>
                </th>
                <td className="max-w-[150px] truncate px-4 py-3 text-xs font-bold text-gray-900">
                  {log.userName || t("components.auditLog.unknownUser")}
                </td>
                <td className="truncate px-4 py-3 text-xs text-gray-800">
                  {describeAuditAction(log.action, translate) ?? log.action}
                </td>
                {showEntityFilter && (
                  <td className="max-w-[100px] truncate px-4 py-3 text-xs text-gray-600">
                    {log.entityType}#{log.entityId?.slice(-6).toUpperCase()}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* På mobil blir tabellen en stablet kortliste, slik at handling og
            tidspunkt aldri klippes av en smal kolonne. */}
        <ul className="divide-y divide-gray-100 sm:hidden">
          {logs.map((log) => (
            <li key={log.id} className="space-y-1.5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-bold text-gray-900">
                  {log.userName || t("components.auditLog.unknownUser")}
                </p>
                <time
                  dateTime={formatDateTime(log.createdAt)}
                  className="text-xs font-medium text-gray-600"
                >
                  {formatDateTimeLocalized(log.createdAt, locale)}
                </time>
              </div>
              <p className="break-words text-sm text-gray-800">
                {describeAuditAction(log.action, translate) ?? log.action}
              </p>
              {showEntityFilter && (
                <p className="break-words text-xs text-gray-600">
                  {log.entityType}#{log.entityId?.slice(-6).toUpperCase()}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {totalCount > safePageSize && (
        <div className="border-t border-gray-200 p-4">
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            hrefFor={pageHref}
            labels={paginationLabels(t)}
            summary={t("components.auditLog.page", {
              page: currentPage,
              totalPages,
              total: totalCount,
            })}
          />
        </div>
      )}
    </div>
  );
}
