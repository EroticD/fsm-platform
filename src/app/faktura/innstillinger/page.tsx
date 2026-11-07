import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import ErrorBanner from "@/components/ErrorBanner";
import SubmitButton from "@/components/SubmitButton";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getBillingSettings } from "@/server/invoices";
import { updateBillingSettingsAction } from "../actions";

const LABEL = "mb-1 block text-xs font-bold uppercase tracking-[0.12em]";
const INPUT = "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm";

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireModulePage("invoicing");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (user.role !== "ADMIN" || !hasPermission(user, "settings.manage")) redirect("/faktura");
  const t = await getTranslations("common");
  const params = await searchParams;
  const settings = await getBillingSettings();

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title={t("invoicing.settings.title")}
          subtitle={t("invoicing.settings.subtitle")}
          icon={<Icon name="settings" className="h-5 w-5" />}
          actions={
            <Link href="/faktura" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold">
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("invoicing.settings.back")}
            </Link>
          }
        />
        {params.saved ? (
          <p role="status" className="rounded-xl border border-[#b6d7a6] bg-[#edf8e8] px-4 py-3 text-sm font-bold text-[#255d17]">
            {t("invoicing.settings.saved")}
          </p>
        ) : null}
        {params.error ? <ErrorBanner message={t("invoicing.errors.generic")} /> : null}

        <form action={updateBillingSettingsAction} className="office-card space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={LABEL}>{t("invoicing.settings.vatRate")}</span>
              <input name="vatRate" type="number" min="0" max="100" step="0.01" defaultValue={settings.vatRate.toFixed(2)} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>{t("invoicing.settings.dueDays")}</span>
              <input name="invoiceDueDays" type="number" min="0" max="365" defaultValue={settings.invoiceDueDays} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>{t("invoicing.settings.validityDays")}</span>
              <input name="quoteValidityDays" type="number" min="1" max="3650" defaultValue={settings.quoteValidityDays} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>{t("invoicing.settings.tokenTtl")}</span>
              <input name="approvalTokenTtlHours" type="number" min="1" max="720" defaultValue={settings.approvalTokenTtlHours} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>{t("invoicing.settings.invoicePrefix")}</span>
              <input name="invoicePrefix" maxLength={20} defaultValue={settings.invoicePrefix} className={INPUT} />
            </label>
            <label>
              <span className={LABEL}>{t("invoicing.settings.creditPrefix")}</span>
              <input name="creditNotePrefix" maxLength={20} defaultValue={settings.creditNotePrefix} className={INPUT} />
            </label>
          </div>
          <p className="text-xs leading-5 text-[var(--muted,#62685f)]">{t("invoicing.settings.hint")}</p>
          <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("invoicing.settings.nextNumber", {
              invoice: settings.nextInvoiceNumber,
              credit: settings.nextCreditNoteNumber,
            })}
          </p>
          <SubmitButton className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-4 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]" pendingLabel={t("invoicing.settings.saving")}>
            <Icon name="check" className="h-4 w-4" />
            {t("invoicing.settings.submit")}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
