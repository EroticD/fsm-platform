import Link from "next/link";
import { getTranslations } from "next-intl/server";
import AuditLogTable from "@/components/AuditLogTable";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
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

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

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
    <section className="office-card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
        <Icon name="note" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
        <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("settings.auditLog.title")}
        </h2>
      </div>
      <p className="mb-5 text-sm text-[var(--muted,#62685f)]">
        {t("settings.auditLog.desc")}
      </p>

      {/* FILTER OG SØK */}
      <div className="mb-5 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4">
        <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input type="hidden" name="tab" value="auditlog" />
          <input
            type="text"
            name="search"
            placeholder={t("settings.auditLog.searchPlaceholder")}
            defaultValue={search}
            className={`${FIELD} flex-1`}
          />
          <input
            type="date"
            name="dateFrom"
            placeholder={t("settings.auditLog.fromDate")}
            defaultValue={dateFrom}
            className={FIELD}
          />
          <input
            type="date"
            name="dateTo"
            placeholder={t("settings.auditLog.toDate")}
            defaultValue={dateTo}
            className={FIELD}
          />
          <button type="submit" className={`${SIGNAL_BUTTON} whitespace-nowrap`}>
            {t("settings.auditLog.search")}
          </button>
          {(search || dateFrom || dateTo) && (
            <Link href="?tab=auditlog" className={`${INK_BUTTON} whitespace-nowrap`}>
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
    </section>
  );
}
