import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { brandInset } from "@/components/ui/brandStyles";
import { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import StatusBadge from "@/components/StatusBadge";
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
    <PageShell size="narrow">
      <PageHeader
        title={invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={invoice.status}
              label={t(`invoicing.status.${invoice.status}`)}
            />
            <span>{invoice.customer.name}</span>
          </span>
        }
        icon={<Icon name="file" className="h-5 w-5" />}
        actions={
          <>
            <Link
              href="/faktura"
              className={buttonClassName({ variant: "secondary" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("invoicing.detail.back")}
            </Link>
            <Link
              href={`/faktura/${invoice.id}/skriv`}
              className={buttonClassName({ variant: "secondary" })}
            >
              <Icon name="file" className="h-4 w-4" />
              {t("invoicing.detail.print")}
            </Link>
          </>
        }
      />

      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      {query.sent ? (
        <p role="status" className="rounded-2xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-5 py-4 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("invoicing.detail.sent")}
        </p>
      ) : null}
      {query.payment ? (
        <p role="status" className="rounded-2xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-5 py-4 text-sm font-bold text-[var(--success-text,#283509)]">
          {query.payment === "duplicate" ? t("invoicing.detail.duplicatePayment") : t("invoicing.detail.paymentSaved")}
        </p>
      ) : null}
      {query.credit ? (
        <p role="status" className="rounded-2xl border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_28%,transparent)] bg-[var(--warning-surface,#fdf5e4)] px-5 py-4 text-sm font-bold text-[var(--warning-text,#7a4f0c)]">
          {t("invoicing.detail.creditSaved")}
        </p>
      ) : null}
      {query.paymentLink ? (
        <p role="status" className="rounded-2xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-5 py-4 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("invoicing.payment.linkCreated")}
        </p>
      ) : null}
      {query.accounting ? (
        <p role="status" className="rounded-2xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-5 py-4 text-sm font-bold text-[var(--success-text,#283509)]">
          {query.accounting === "already"
            ? t("invoicing.accounting.alreadySynced")
            : query.accounting === "exported"
              ? t("invoicing.accounting.exported")
              : query.accounting === "reset"
                ? t("invoicing.accounting.reset")
                : t("invoicing.accounting.synced")}
        </p>
      ) : null}

      <Card as="section" className="p-4 sm:p-5">
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
      </Card>

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">{t("invoicing.detail.lines")}</h2>
        <div
          className="mt-3 overflow-x-auto"
          role="region"
          aria-label={t("invoicing.detail.lines")}
          tabIndex={0}
        >
          <table className="office-table">
            <caption className="sr-only">{t("invoicing.detail.lines")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("invoicing.lines.description")}</th>
                <th scope="col" className="text-right">{t("invoicing.lines.quantity")}</th>
                <th scope="col" className="text-right">{t("invoicing.lines.unitPrice")}</th>
                <th scope="col" className="text-right">{t("invoicing.lines.vatRate")}</th>
                <th scope="col" className="text-right">{t("invoicing.lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td className="text-right">{line.quantity.toFixed(2)} {line.unit}</td>
                  <td className="text-right">{formatAmount(line.unitPrice, invoice.currency)}</td>
                  <td className="text-right">{line.vatRate.toFixed(2)} %</td>
                  <td className="text-right font-bold">{formatAmount(line.lineTotal, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>{t("invoicing.detail.subtotal")}</dt><dd>{formatAmount(invoice.subtotal, invoice.currency)}</dd></div>
          <div className="flex justify-between"><dt>{t("invoicing.detail.vat")}</dt><dd>{formatAmount(invoice.vatTotal, invoice.currency)}</dd></div>
          <div className="flex justify-between border-t border-[var(--ink,#101310)] pt-1 font-black"><dt>{t("invoicing.detail.total")}</dt><dd>{formatAmount(invoice.total, invoice.currency)}</dd></div>
          <div className="flex justify-between"><dt>{t("invoicing.detail.paid")}</dt><dd>{formatAmount(invoice.paidTotal, invoice.currency)}</dd></div>
          <div className="flex justify-between"><dt>{t("invoicing.detail.credited")}</dt><dd>{formatAmount(invoice.creditedTotal, invoice.currency)}</dd></div>
          <div className="flex justify-between text-base font-black"><dt>{t("invoicing.detail.outstanding")}</dt><dd>{formatAmount(invoice.outstanding, invoice.currency)}</dd></div>
        </dl>
        {invoice.notes ? (
          <div className={`${brandInset} mt-4 whitespace-pre-wrap p-3 text-sm`}>
            {invoice.notes}
          </div>
        ) : null}
      </Card>

      {canManage && invoice.status === "DRAFT" ? (
        <Card as="section" className="p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            <Link href={`/faktura/${invoice.id}/rediger`} className={buttonClassName({ variant: "secondary" })}>
              <Icon name="edit" className="h-4 w-4" />
              {t("invoicing.detail.edit")}
            </Link>
            <form action={sendInvoiceAction}>
              <input type="hidden" name="id" value={invoice.id} />
              <SubmitButton className={buttonClassName({ variant: "primary" })} pendingLabel={t("invoicing.detail.sending")}>
                <Icon name="mail" className="h-4 w-4" />
                {t("invoicing.detail.send")}
              </SubmitButton>
            </form>
          </div>
          <p className="mt-2 text-xs text-[var(--muted,#62685f)]">{t("invoicing.detail.sendHint")}</p>
        </Card>
      ) : null}

      {canManage && payable ? (
        <Card as="section" data-payment-panel className="p-4 sm:p-5">
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
                    className={`${buttonClassName({ variant: "secondary" })} mt-2`}
                  >
                    {t("invoicing.payment.openLink")}
                  </a>
                </div>
              ) : null}
              <form action={createPaymentLinkAction} className="mt-3">
                <input type="hidden" name="id" value={invoice.id} />
                <SubmitButton
                  className={buttonClassName({ variant: "primary" })}
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
        </Card>
      ) : null}

      {canManage ? (
        <Card as="section" className="p-4 sm:p-5">
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
                  className={buttonClassName({ variant: "secondary" })}
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
                    className={buttonClassName({ variant: "secondary" })}
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
        </Card>
      ) : null}

      {canManage && payable ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card as="section" className="p-4 sm:p-5">
            <h2 className="text-lg font-extrabold">{t("invoicing.detail.paymentTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">{t("invoicing.detail.paymentHint")}</p>
            <form action={registerPaymentAction} className="mt-3 space-y-3">
              <input type="hidden" name="id" value={invoice.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <Field label={t("invoicing.detail.amount")} required>
                <Input name="amount" type="number" min="0.01" step="0.01" defaultValue={invoice.outstanding?.toFixed(2) ?? ""} required />
              </Field>
              <Field label={t("invoicing.detail.paidAt")}>
                <Input name="paidAt" type="date" />
              </Field>
              <Field label={t("invoicing.detail.method")}>
                <Select name="method" defaultValue="BANK_TRANSFER">
                  <option value="BANK_TRANSFER">{t("invoicing.methods.BANK_TRANSFER")}</option>
                  <option value="CASH">{t("invoicing.methods.CASH")}</option>
                  <option value="OTHER">{t("invoicing.methods.OTHER")}</option>
                </Select>
              </Field>
              <Field label={t("invoicing.detail.reference")}>
                <Input name="reference" maxLength={500} />
              </Field>
              <Field label={t("invoicing.detail.note")}>
                <Textarea name="note" rows={2} maxLength={2000} />
              </Field>
              <SubmitButton className={`${buttonClassName({ variant: "primary" })} w-full`} pendingLabel={t("invoicing.detail.saving")}>
                <Icon name="check" className="h-4 w-4" />
                {t("invoicing.detail.registerPayment")}
              </SubmitButton>
            </form>
          </Card>

          {creditable ? (
            <Card as="section" className="p-4 sm:p-5">
              <h2 className="text-lg font-extrabold">{t("invoicing.detail.creditTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">{t("invoicing.detail.creditHint")}</p>
              <form action={registerCreditNoteAction} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={invoice.id} />
                <Field label={t("invoicing.detail.creditAmount")} required>
                  <Input name="amount" type="number" min="0.01" step="0.01" max={invoice.outstanding?.toFixed(2) ?? ""} required />
                </Field>
                <Field label={t("invoicing.detail.creditDate")}>
                  <Input name="issuedAt" type="date" />
                </Field>
                <Field label={t("invoicing.detail.creditReason")}>
                  <Textarea name="reason" rows={3} maxLength={2000} />
                </Field>
                <SubmitButton className={`${buttonClassName({ variant: "secondary" })} w-full`} pendingLabel={t("invoicing.detail.saving")}>
                  {t("invoicing.detail.registerCredit")}
                </SubmitButton>
              </form>
            </Card>
          ) : null}
        </div>
      ) : null}

      {invoice.payments.length > 0 ? (
        <Card as="section" className="p-4 sm:p-5">
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
        </Card>
      ) : null}

      {invoice.creditNotes.length > 0 ? (
        <Card as="section" className="p-4 sm:p-5">
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
        </Card>
      ) : null}
    </PageShell>
  );
}
