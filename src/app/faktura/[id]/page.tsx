import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import ErrorBanner from "@/components/ErrorBanner";
import SubmitButton from "@/components/SubmitButton";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { paymentProviderInfo } from "@/lib/payments/provider";
import { accountingProviderInfo } from "@/lib/accounting/provider";
import { getAccountingSettings } from "@/server/accounting";
import { getInvoice } from "@/server/invoices";
import {
  createPaymentLinkAction,
  registerCreditNoteAction,
  registerPaymentAction,
  sendInvoiceAction,
  syncInvoiceAccountingAction,
} from "../actions";
import { resetAccountingSyncAction } from "../accounting-actions";

const TONE: Record<string, string> = {
  DRAFT: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
  SENT: "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  PARTIALLY_PAID: "border-[#e4c98f] bg-[#fdf5e4] text-[#6b4808]",
  PAID: "border-[#b6d7a6] bg-[#edf8e8] text-[#255d17]",
  OVERDUE: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  CREDITED: "border-[#c9c0ac] bg-[#efeee8] text-[#4a473e]",
};

const CARD = "office-card min-w-0 p-4 sm:p-5";
const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    sent?: string;
    payment?: string;
    credit?: string;
    paymentLink?: string;
    accounting?: string;
  }>;
}) {
  await requireModulePage("invoicing");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const { id } = await params;
  const query = await searchParams;
  const result = await getInvoice(user, id);
  if (!result.ok) notFound();
  const invoice = result.data;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const canManage = hasPermission(user, "customers.manage");
  const payable = ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status);
  const creditable =
    payable &&
    invoice.outstanding != null &&
    Number(invoice.outstanding.toString()) > 0;
  const paymentInfo = paymentProviderInfo();
  const accountingInfo = accountingProviderInfo();
  const accountingSettings = canManage ? await getAccountingSettings() : null;
  const accountingSync = invoice.accountingSyncs[0] ?? null;
  const errorMessages: Record<string, string> = {
    forbidden: t("invoicing.errors.forbidden"),
    invalid: t("invoicing.errors.invalid"),
    not_found: t("invoicing.errors.notFound"),
    conflict: t("invoicing.errors.conflict"),
    "invoice.locked": t("invoicing.errors.locked"),
    "invoice.notDraft": t("invoicing.errors.notDraft"),
    "invoice.notPayable": t("invoicing.errors.notPayable"),
    "invoice.notCreditable": t("invoicing.errors.notCreditable"),
    "invoice.amountTooHigh": t("invoicing.errors.amountTooHigh"),
    "invoice.duplicateNumber": t("invoicing.errors.duplicateNumber"),
    "payments.disabled": t("invoicing.payment.disabled"),
    "payments.unsupportedCurrency": t("invoicing.payment.unsupportedCurrency"),
    "payments.providerError": t("invoicing.payment.providerError"),
    "payments.rateLimited": t("invoicing.payment.rateLimited"),
    "accounting.disabled": t("invoicing.accounting.disabled"),
    "accounting.notConfigured": t("invoicing.accounting.notConfigured"),
    "accounting.syncFailed": t("invoicing.accounting.syncFailed"),
    "accounting.concurrent": t("invoicing.accounting.concurrent"),
  };
  const errorMessage = query.error
    ? (errorMessages[query.error] ?? t("invoicing.errors.generic"))
    : null;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${TONE[invoice.status] ?? TONE.DRAFT}`}>
                {t(`invoicing.status.${invoice.status}`)}
              </span>
              <span>{invoice.customer.name}</span>
            </span>
          }
          icon={<Icon name="file" className="h-5 w-5" />}
          actions={
            <>
              <Link href="/faktura" className={BUTTON}>
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("invoicing.detail.back")}
              </Link>
              <Link href={`/faktura/${invoice.id}/skriv`} className={BUTTON}>
                <Icon name="file" className="h-4 w-4" />
                {t("invoicing.detail.print")}
              </Link>
            </>
          }
        />

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
        {query.sent ? (
          <p role="status" className="rounded-xl border border-[#b6d7a6] bg-[#edf8e8] px-4 py-3 text-sm font-bold text-[#255d17]">
            {t("invoicing.detail.sent")}
          </p>
        ) : null}
        {query.payment ? (
          <p role="status" className="rounded-xl border border-[#b6d7a6] bg-[#edf8e8] px-4 py-3 text-sm font-bold text-[#255d17]">
            {query.payment === "duplicate" ? t("invoicing.detail.duplicatePayment") : t("invoicing.detail.paymentSaved")}
          </p>
        ) : null}
        {query.credit ? (
          <p role="status" className="rounded-xl border border-[#e4c98f] bg-[#fdf5e4] px-4 py-3 text-sm font-bold text-[#6b4808]">
            {t("invoicing.detail.creditSaved")}
          </p>
        ) : null}
        {query.paymentLink ? (
          <p role="status" className="rounded-xl border border-[#b6d7a6] bg-[#edf8e8] px-4 py-3 text-sm font-bold text-[#255d17]">
            {t("invoicing.payment.linkCreated")}
          </p>
        ) : null}
        {query.accounting ? (
          <p role="status" className="rounded-xl border border-[#b6d7a6] bg-[#edf8e8] px-4 py-3 text-sm font-bold text-[#255d17]">
            {query.accounting === "already"
              ? t("invoicing.accounting.alreadySynced")
              : query.accounting === "exported"
                ? t("invoicing.accounting.exported")
                : query.accounting === "reset"
                  ? t("invoicing.accounting.reset")
                  : t("invoicing.accounting.synced")}
          </p>
        ) : null}

        <section className={CARD}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("invoicing.detail.customer")}</dt>
              <dd className="font-bold">{invoice.customer.name}</dd>
              <dd className="text-xs text-[var(--muted,#62685f)]">
                {invoice.customer.orgNumber ? `${t("invoicing.detail.orgNumber")}: ${invoice.customer.orgNumber}` : ""}
                {invoice.customer.customerNumber ? ` · ${invoice.customer.customerNumber}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("invoicing.detail.dates")}</dt>
              <dd>{t("invoicing.form.issueDate")}: {invoice.issueDate ? formatDateLocalized(invoice.issueDate, locale) : t("invoicing.list.noDate")}</dd>
              <dd>{t("invoicing.form.dueDate")}: {invoice.dueDate ? formatDateLocalized(invoice.dueDate, locale) : t("invoicing.list.noDate")}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("invoicing.detail.department")}</dt>
              <dd>{invoice.department.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("invoicing.detail.links")}</dt>
              <dd>
                {invoice.workOrder ? (
                  <Link href={`/oppdrag/${invoice.workOrder.id}`} className="underline">
                    {invoice.workOrder.reference} · {invoice.workOrder.title}
                  </Link>
                ) : t("invoicing.detail.noWorkOrder")}
              </dd>
              {invoice.quote ? (
                <dd><Link href={`/tilbud/${invoice.quote.id}`} className="underline">{invoice.quote.quoteNumber ?? invoice.quote.title}</Link></dd>
              ) : null}
              {invoice.report ? (
                <dd>{invoice.report.reportNumber ?? invoice.report.name ?? t("invoicing.detail.report")}</dd>
              ) : null}
            </div>
            {invoice.contact ? (
              <div>
                <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("invoicing.detail.contact")}</dt>
                <dd>{invoice.contact.name}</dd>
                {invoice.contact.email ? <dd className="text-xs">{invoice.contact.email}</dd> : null}
              </div>
            ) : null}
          </dl>
        </section>

        <section className={CARD}>
          <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">{t("invoicing.detail.lines")}</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-[var(--muted,#62685f)]">
                <th className="pb-2">{t("invoicing.lines.description")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.quantity")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.unitPrice")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.vatRate")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-t border-[var(--line,#dedcd1)]">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">{line.quantity.toFixed(2)} {line.unit}</td>
                  <td className="py-2 text-right">{formatAmount(line.unitPrice, invoice.currency)}</td>
                  <td className="py-2 text-right">{line.vatRate.toFixed(2)} %</td>
                  <td className="py-2 text-right font-bold">{formatAmount(line.lineTotal, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>{t("invoicing.detail.subtotal")}</dt><dd>{formatAmount(invoice.subtotal, invoice.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("invoicing.detail.vat")}</dt><dd>{formatAmount(invoice.vatTotal, invoice.currency)}</dd></div>
            <div className="flex justify-between border-t border-[var(--ink,#101310)] pt-1 font-black"><dt>{t("invoicing.detail.total")}</dt><dd>{formatAmount(invoice.total, invoice.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("invoicing.detail.paid")}</dt><dd>{formatAmount(invoice.paidTotal, invoice.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("invoicing.detail.credited")}</dt><dd>{formatAmount(invoice.creditedTotal, invoice.currency)}</dd></div>
            <div className="flex justify-between text-base font-black"><dt>{t("invoicing.detail.outstanding")}</dt><dd>{formatAmount(invoice.outstanding, invoice.currency)}</dd></div>
          </dl>
          {invoice.notes ? <div className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--paper,#f2efe6)] p-3 text-sm">{invoice.notes}</div> : null}
        </section>

        {canManage && invoice.status === "DRAFT" ? (
          <section className={CARD}>
            <div className="flex flex-wrap gap-2">
              <Link href={`/faktura/${invoice.id}/rediger`} className={BUTTON}>
                <Icon name="edit" className="h-4 w-4" />
                {t("invoicing.detail.edit")}
              </Link>
              <form action={sendInvoiceAction}>
                <input type="hidden" name="id" value={invoice.id} />
                <SubmitButton className={PRIMARY} pendingLabel={t("invoicing.detail.sending")}>
                  <Icon name="mail" className="h-4 w-4" />
                  {t("invoicing.detail.send")}
                </SubmitButton>
              </form>
            </div>
            <p className="mt-2 text-xs text-[var(--muted,#62685f)]">{t("invoicing.detail.sendHint")}</p>
          </section>
        ) : null}

        {canManage && payable ? (
          <section className={CARD}>
            <h2 className="text-lg font-extrabold">{t("invoicing.payment.title")}</h2>
            {paymentInfo.configured && paymentInfo.provider ? (
              <>
                <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
                  {t("invoicing.payment.hint", {
                    provider: t(`invoicing.payment.providers.${paymentInfo.provider}`),
                  })}
                </p>
                {invoice.paymentLinkUrl && invoice.paymentStatus === "PENDING" ? (
                  <div className="mt-3 rounded-xl border border-[var(--line,#dedcd1)] p-3">
                    <p className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
                      {t("invoicing.payment.statusLabel")}
                    </p>
                    <p className="text-sm font-bold">
                      {t(`invoicing.payment.status.${invoice.paymentStatus}`)}
                    </p>
                    <a
                      href={invoice.paymentLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${BUTTON} mt-2`}
                    >
                      {t("invoicing.payment.openLink")}
                    </a>
                  </div>
                ) : null}
                <form action={createPaymentLinkAction} className="mt-3">
                  <input type="hidden" name="id" value={invoice.id} />
                  <SubmitButton
                    className={PRIMARY}
                    pendingLabel={t("invoicing.payment.creating")}
                  >
                    <Icon name="mail" className="h-4 w-4" />
                    {invoice.paymentLinkUrl
                      ? t("invoicing.payment.recreateLink")
                      : t("invoicing.payment.createLink")}
                  </SubmitButton>
                </form>
              </>
            ) : (
              <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
                {t("invoicing.payment.notConfigured")}
              </p>
            )}
          </section>
        ) : null}

        {canManage ? (
          <section className={CARD}>
            <h2 className="text-lg font-extrabold">{t("invoicing.accounting.title")}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
              {t("invoicing.accounting.provider", {
                provider: t(`invoicing.accounting.providers.${accountingInfo.provider}`),
              })}
              {" · "}
              {accountingSettings?.enabled
                ? t("invoicing.accounting.enabled")
                : t("invoicing.accounting.disabledState")}
            </p>
            {accountingSync ? (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  <span className="font-bold">{t("invoicing.accounting.statusLabel")}: </span>
                  {t(`invoicing.accounting.status.${accountingSync.status}`)}
                </p>
                {accountingSync.externalInvoiceNumber ? (
                  <p>
                    <span className="font-bold">{t("invoicing.accounting.externalNumber")}: </span>
                    {accountingSync.externalInvoiceNumber}
                  </p>
                ) : null}
                {accountingSync.lastAttemptAt ? (
                  <p className="text-xs text-[var(--muted,#62685f)]">
                    {t("invoicing.accounting.lastAttempt", {
                      date: formatDateLocalized(accountingSync.lastAttemptAt, locale),
                    })}
                  </p>
                ) : null}
                {accountingSync.lastError ? (
                  <p className="text-xs font-bold text-[var(--risk-text,#b42318)]">
                    {t("invoicing.accounting.lastError")}: {accountingSync.lastError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-[var(--muted,#62685f)]">
                {t("invoicing.accounting.neverSynced")}
              </p>
            )}
            {!accountingSettings?.enabled ? (
              <p className="mt-3 text-xs leading-5 text-[var(--muted,#62685f)]">
                {t("invoicing.accounting.enableHint")}
              </p>
            ) : invoice.status !== "DRAFT" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={syncInvoiceAccountingAction}>
                  <input type="hidden" name="id" value={invoice.id} />
                  <SubmitButton
                    className={BUTTON}
                    pendingLabel={t("invoicing.accounting.syncing")}
                  >
                    <Icon name="sync" className="h-4 w-4" />
                    {accountingSync?.status === "FAILED"
                      ? t("invoicing.accounting.retry")
                      : t("invoicing.accounting.sync")}
                  </SubmitButton>
                </form>
                {user.role === "ADMIN" && accountingSync?.status === "FAILED" ? (
                  <form action={resetAccountingSyncAction}>
                    <input type="hidden" name="id" value={invoice.id} />
                    <SubmitButton
                      className={BUTTON}
                      pendingLabel={t("invoicing.accounting.syncing")}
                    >
                      {t("invoicing.accounting.resetAction")}
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-[var(--muted,#62685f)]">
                {t("invoicing.accounting.draftHint")}
              </p>
            )}
          </section>
        ) : null}

        {canManage && payable ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={CARD}>
              <h2 className="text-lg font-extrabold">{t("invoicing.detail.paymentTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">{t("invoicing.detail.paymentHint")}</p>
              <form action={registerPaymentAction} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={invoice.id} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.amount")}</span>
                  <input name="amount" type="number" min="0.01" step="0.01" defaultValue={invoice.outstanding?.toFixed(2) ?? ""} required className={INPUT} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.paidAt")}</span>
                  <input name="paidAt" type="date" className={INPUT} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.method")}</span>
                  <select name="method" className={INPUT} defaultValue="BANK_TRANSFER">
                    <option value="BANK_TRANSFER">{t("invoicing.methods.BANK_TRANSFER")}</option>
                    <option value="CASH">{t("invoicing.methods.CASH")}</option>
                    <option value="OTHER">{t("invoicing.methods.OTHER")}</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.reference")}</span>
                  <input name="reference" maxLength={500} className={INPUT} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.note")}</span>
                  <textarea name="note" rows={2} maxLength={2000} className={INPUT} />
                </label>
                <SubmitButton className={`${PRIMARY} w-full`} pendingLabel={t("invoicing.detail.saving")}>
                  <Icon name="check" className="h-4 w-4" />
                  {t("invoicing.detail.registerPayment")}
                </SubmitButton>
              </form>
            </section>

            {creditable ? (
              <section className={CARD}>
                <h2 className="text-lg font-extrabold">{t("invoicing.detail.creditTitle")}</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">{t("invoicing.detail.creditHint")}</p>
                <form action={registerCreditNoteAction} className="mt-3 space-y-3">
                  <input type="hidden" name="id" value={invoice.id} />
                  <label>
                    <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.creditAmount")}</span>
                    <input name="amount" type="number" min="0.01" step="0.01" max={invoice.outstanding?.toFixed(2) ?? ""} required className={INPUT} />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.creditDate")}</span>
                    <input name="issuedAt" type="date" className={INPUT} />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-bold">{t("invoicing.detail.creditReason")}</span>
                    <textarea name="reason" rows={3} maxLength={2000} className={INPUT} />
                  </label>
                  <SubmitButton className={`${BUTTON} w-full`} pendingLabel={t("invoicing.detail.saving")}>
                    {t("invoicing.detail.registerCredit")}
                  </SubmitButton>
                </form>
              </section>
            ) : null}
          </div>
        ) : null}

        {invoice.payments.length > 0 ? (
          <section className={CARD}>
            <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">{t("invoicing.detail.payments")}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {invoice.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line,#dedcd1)] pt-2">
                  <span>
                    <strong>{formatAmount(payment.amount, invoice.currency)}</strong>
                    {" · "}
                    {t(`invoicing.methods.${payment.method}`)}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </span>
                  <span className="text-xs text-[var(--muted,#62685f)]">{formatDateLocalized(payment.paidAt, locale)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {invoice.creditNotes.length > 0 ? (
          <section className={CARD}>
            <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">{t("invoicing.detail.creditNotes")}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {invoice.creditNotes.map((credit) => (
                <li key={credit.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line,#dedcd1)] pt-2">
                  <span>
                    <strong>{credit.creditNoteNumber}</strong>
                    {" · "}
                    {formatAmount(credit.total, invoice.currency)}
                    {credit.reason ? ` · ${credit.reason}` : ""}
                  </span>
                  <span className="text-xs text-[var(--muted,#62685f)]">{formatDateLocalized(credit.issuedAt, locale)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
