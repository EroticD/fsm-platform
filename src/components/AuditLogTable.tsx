import Link from "next/link";
import type { AuditLog } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { formatDateTime, formatDateTimeLocalized } from "@/lib/dates";
import { describeAuditAction, type AuditTranslator } from "@/lib/audit-actions";
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
      <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-6 text-center">
        <p className="flex justify-center text-[var(--muted,#62685f)]" aria-hidden="true">
          <Icon
            name={stalePage ? "search" : "note"}
            className="h-8 w-8"
          />
        </p>
        <p className="mt-2 font-extrabold text-[var(--ink,#101310)]">
          {stalePage
            ? t("components.auditLog.emptyPageTitle")
            : t("components.auditLog.empty")}
        </p>
        {stalePage && (
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted,#62685f)]">
            {t("components.auditLog.emptyPageDescription")}
          </p>
        )}
        {stalePage && (
          <Link
            href={pageHref(totalPages)}
            className="signal-button mt-4 text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]"
          >
            {t("components.auditLog.goToLastPage")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]">
      <div
        className="overflow-x-auto"
        role="region"
        aria-label={t("components.auditLog.tableLabel")}
        tabIndex={0}
      >
        <table className="office-table hidden sm:table">
          <caption className="sr-only">
            {t("components.auditLog.caption")}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("components.auditLog.time")}</th>
              <th scope="col">{t("components.auditLog.user")}</th>
              <th scope="col">{t("components.auditLog.action")}</th>
              {showEntityFilter && (
                <th scope="col">{t("components.auditLog.entity")}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <th
                  scope="row"
                  className="whitespace-nowrap text-left text-xs font-medium text-[var(--muted,#62685f)]"
                >
                  <time dateTime={formatDateTime(log.createdAt)}>
                    {formatDateTimeLocalized(log.createdAt, locale)}
                  </time>
                </th>
                <td className="max-w-[150px] truncate text-xs font-bold text-[var(--ink,#101310)]">
                  {log.userName || t("components.auditLog.unknownUser")}
                </td>
                <td className="truncate text-xs text-[var(--ink,#101310)]">
                  {describeAuditAction(log.action, translate) ?? log.action}
                </td>
                {showEntityFilter && (
                  <td className="max-w-[100px] truncate text-xs text-[var(--muted,#62685f)]">
                    {log.entityType}#{log.entityId?.slice(-6).toUpperCase()}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* På mobil blir tabellen en stablet kortliste, slik at handling og
            tidspunkt aldri klippes av en smal kolonne. */}
        <ul className="divide-y divide-[var(--line,#dedcd1)] sm:hidden">
          {logs.map((log) => (
            <li key={log.id} className="space-y-1.5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs font-bold text-[var(--ink,#101310)]">
                  {log.userName || t("components.auditLog.unknownUser")}
                </p>
                <time
                  dateTime={formatDateTime(log.createdAt)}
                  className="text-xs font-medium text-[var(--muted,#62685f)]"
                >
                  {formatDateTimeLocalized(log.createdAt, locale)}
                </time>
              </div>
              <p className="break-words text-sm text-[var(--ink,#101310)]">
                {describeAuditAction(log.action, translate) ?? log.action}
              </p>
              {showEntityFilter && (
                <p className="break-words text-xs text-[var(--muted,#62685f)]">
                  {log.entityType}#{log.entityId?.slice(-6).toUpperCase()}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {totalCount > safePageSize && (
        <div className="border-t border-[var(--line,#dedcd1)] p-4">
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
