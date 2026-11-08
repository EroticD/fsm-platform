import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import SubmitButton from "@/components/SubmitButton";
import { getCurrentUser } from "@/lib/session";
import { getAccountingAdminView } from "@/server/accounting";
import {
  testAccountingConnectionAction,
  updateAccountingSettingsAction,
} from "@/app/faktura/accounting-actions";

/**
 * Administratorpanel for regnskapssynk.
 *
 * Komponenten er bevisst ikke koblet inn i innstillingstabbene i denne
 * endringen. Hovedagenten kan rendre `<AccountingSettings />` der den skal
 * ligge. Den henter status selv, skjuler seg for ikke-administratorer og
 * eksponerer aldri hemmeligheter.
 */
export default async function AccountingSettings() {
  const user = await getCurrentUser();
  if (!user) return null;
  const result = await getAccountingAdminView(user);
  if (!result.ok) return null;
  const view = result.data;
  const t = await getTranslations("common");

  return (
    <section
      data-accounting-settings
      className="office-card space-y-4 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold">{t("invoicing.accounting.settingsTitle")}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("invoicing.accounting.settingsHint")}
          </p>
        </div>
        <span className="rounded-full border border-[var(--line,#dedcd1)] px-2.5 py-1 text-xs font-bold">
          {t(`invoicing.accounting.providers.${view.info.provider}`)}
        </span>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
            {t("invoicing.accounting.connection")}
          </dt>
          <dd>
            {view.info.configured
              ? t("invoicing.accounting.configured")
              : t("invoicing.accounting.notConfigured")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
            {t("invoicing.accounting.mode")}
          </dt>
          <dd>
            {view.info.mode === "export"
              ? t("invoicing.accounting.modeExport")
              : t("invoicing.accounting.modeApi")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
            {t("invoicing.accounting.lastTest")}
          </dt>
          <dd>
            {view.settings.lastTestedAt
              ? view.settings.lastTestOk
                ? t("invoicing.accounting.lastTestOk")
                : t("invoicing.accounting.lastTestFailed")
              : t("invoicing.accounting.never")}
            {view.settings.lastTestError ? (
              <span className="block text-xs font-bold text-[var(--risk-text,#b42318)]">
                {view.settings.lastTestError}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
            {t("invoicing.accounting.lastSync")}
          </dt>
          <dd>
            {view.settings.lastSyncAt
              ? view.settings.lastSyncAt.toISOString().slice(0, 10)
              : t("invoicing.accounting.never")}
            {view.settings.lastSyncError ? (
              <span className="block text-xs font-bold text-[var(--risk-text,#b42318)]">
                {view.settings.lastSyncError}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <form action={updateAccountingSettingsAction}>
          <input type="hidden" name="enabled" value={view.settings.enabled ? "false" : "true"} />
          <SubmitButton
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold"
            pendingLabel={t("invoicing.accounting.saving")}
          >
            {view.settings.enabled
              ? t("invoicing.accounting.disable")
              : t("invoicing.accounting.enable")}
          </SubmitButton>
        </form>
        <form action={testAccountingConnectionAction}>
          <SubmitButton
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]"
            pendingLabel={t("invoicing.accounting.testing")}
          >
            <Icon name="sync" className="h-4 w-4" />
            {t("invoicing.accounting.test")}
          </SubmitButton>
        </form>
      </div>

      <div>
        <h3 className="text-xs font-black uppercase tracking-[0.12em]">
          {t("invoicing.accounting.recentTitle")}
        </h3>
        {view.recent.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
            {t("invoicing.accounting.noSyncs")}
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {view.recent.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-2 border-t border-[var(--line,#dedcd1)] pt-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/faktura/${row.invoice.id}`}
                    className="font-bold underline decoration-2 underline-offset-4"
                  >
                    {row.invoice.invoiceNumber ?? row.invoice.id}
                  </Link>
                  <span className="text-[var(--muted,#62685f)]"> · {row.invoice.customerName}</span>
                  {row.lastError ? (
                    <p className="text-xs font-bold text-[var(--risk-text,#b42318)]">
                      {row.lastError}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] px-2 py-0.5 text-2xs font-bold">
                  {t(`invoicing.accounting.status.${row.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[var(--muted,#62685f)]">
          {t("invoicing.accounting.failedCount", { count: view.failedCount })}
        </p>
      </div>
    </section>
  );
}
