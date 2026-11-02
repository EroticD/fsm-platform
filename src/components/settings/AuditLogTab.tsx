import Link from "next/link";
import { getTranslations } from "next-intl/server";
import AuditLogTable from "@/components/AuditLogTable";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import type { AuditLog } from "@prisma/client";
import type { AuditHoldView } from "@/server/audit-retention";

type AuditLogTabProps = {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  dateFrom: string;
  dateTo: string;
  canManageAudit?: boolean;
  retentionDays?: number | null;
  holds?: AuditHoldView[];
  departmentId?: string | null;
  message?: string | null;
  saveRetention?: (formData: FormData) => Promise<void>;
  setHold?: (formData: FormData) => Promise<void>;
  releaseHold?: (formData: FormData) => Promise<void>;
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
  canManageAudit = false,
  retentionDays = null,
  holds = [],
  departmentId = null,
  message = null,
  saveRetention,
  setHold,
  releaseHold,
}: AuditLogTabProps) {
  const t = await getTranslations("common");
  // Bevar alle aktive filtre når man blar, og kod verdiene riktig.
  const baseParams = new URLSearchParams({ tab: "auditlog" });
  if (search) baseParams.set("search", search);
  if (dateFrom) baseParams.set("dateFrom", dateFrom);
  if (dateTo) baseParams.set("dateTo", dateTo);
  const baseUrl = `/innstillinger?${baseParams.toString()}`;

  const exportParams = new URLSearchParams();
  if (dateFrom) exportParams.set("fra", dateFrom);
  if (dateTo) exportParams.set("til", dateTo);
  if (departmentId) exportParams.set("avdeling", departmentId);
  const exportUrl = `/api/innstillinger/audit/eksport${
    exportParams.size ? `?${exportParams.toString()}` : ""
  }`;

  return (
    <section className="office-card space-y-5 p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
        <Icon name="note" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
        <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("settings.auditLog.title")}
        </h2>
      </div>
      <p className="text-sm text-[var(--muted,#62685f)]">
        {t("settings.auditLog.desc")}
      </p>

      {message && (
        <p
          role="status"
          className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-sm font-bold text-[var(--ink,#101310)]"
        >
          {message === "ok:retention"
            ? t("settings.auditLog.retentionSaved")
            : message === "ok:hold"
              ? t("settings.auditLog.holdSaved")
              : message === "ok:hold-released"
                ? t("settings.auditLog.holdReleased")
                : t("settings.auditLog.holdError")}
        </p>
      )}

      {canManageAudit && (
        <div className="space-y-4 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4">
          <div>
            <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
              {t("settings.auditLog.retentionTitle")}
            </h3>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.auditLog.retentionDesc")}
            </p>
            {saveRetention && (
              <form
                action={saveRetention}
                className="mt-3 flex flex-wrap items-end gap-2"
              >
                <label className="flex flex-col gap-1 text-xs font-bold text-[var(--ink,#101310)]">
                  {t("settings.auditLog.retentionDays")}
                  <input
                    type="number"
                    name="retentionDays"
                    min={0}
                    max={3650}
                    defaultValue={retentionDays ?? 365}
                    className={FIELD}
                  />
                </label>
                <button type="submit" className={SIGNAL_BUTTON}>
                  {t("settings.auditLog.save")}
                </button>
              </form>
            )}
          </div>

          <div className="border-t border-[var(--line,#dedcd1)] pt-3">
            <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
              {t("settings.auditLog.exportTitle")}
            </h3>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.auditLog.exportDesc")}
            </p>
            <a href={exportUrl} className={`${INK_BUTTON} mt-3`}>
              <Icon name="file" className="h-4 w-4" />
              {t("settings.auditLog.exportButton")}
            </a>
          </div>

          {setHold && (
            <div className="border-t border-[var(--line,#dedcd1)] pt-3">
              <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
                {t("settings.auditLog.holdTitle")}
              </h3>
              <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                {t("settings.auditLog.holdDesc")}
              </p>
              <form
                action={setHold}
                className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
              >
                <input
                  type="text"
                  name="auditLogId"
                  required
                  placeholder={t("settings.auditLog.holdLogId")}
                  className={FIELD}
                />
                <input
                  type="text"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  placeholder={t("settings.auditLog.holdReason")}
                  className={FIELD}
                />
                <button type="submit" className={SIGNAL_BUTTON}>
                  {t("settings.auditLog.holdSet")}
                </button>
              </form>
              {holds.length > 0 && releaseHold && (
                <ul className="mt-3 space-y-2">
                  {holds.map((hold) => (
                    <li
                      key={hold.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-xs"
                    >
                      <span className="min-w-0 break-words text-[var(--ink,#101310)]">
                        <strong>
                          {hold.auditLogId ??
                            `${hold.entityType}#${hold.entityId}`}
                        </strong>
                        {" – "}
                        {hold.reason}
                      </span>
                      <form action={releaseHold}>
                        <input type="hidden" name="holdId" value={hold.id} />
                        <button type="submit" className={INK_BUTTON}>
                          {t("settings.auditLog.holdRelease")}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* FILTER OG SØK */}
      <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:p-4">
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
