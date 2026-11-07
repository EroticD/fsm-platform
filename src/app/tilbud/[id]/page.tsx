import Link from "next/link";
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
import { getQuote } from "@/server/quotes";
import {
  cloneQuoteAction,
  convertQuoteAction,
  createQuoteVersionAction,
  reissueQuoteTokenAction,
  sendQuoteAction,
} from "../actions";

const TONE: Record<string, string> = {
  DRAFT: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
  SENT: "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  ACCEPTED: "border-[#b6d7a6] bg-[#edf8e8] text-[#255d17]",
  REJECTED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  EXPIRED: "border-[#c9c0ac] bg-[#efeee8] text-[#4a473e]",
};

const CARD = "office-card min-w-0 p-4 sm:p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]";

export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; token?: string; sent?: string }>;
}) {
  await requireModulePage("quotes");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const { id } = await params;
  const queryParams = await searchParams;
  const result = await getQuote(user, id);
  if (!result.ok) notFound();
  const quote = result.data;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const canManage = hasPermission(user, "customers.manage");
  const canConvert = canManage && hasPermission(user, "workorders.create");
  const errorKeys = new Set([
    "forbidden",
    "invalid",
    "not_found",
    "conflict",
    "quote.locked",
    "quote.expired",
    "quote.notDraft",
    "quote.notSent",
    "quote.notAccepted",
    "quote.conversionRace",
    "token.expired",
    "token.used",
  ]);
  const errorMessage = queryParams.error
    ? t(`quotes.errors.${errorKeys.has(queryParams.error) ? queryParams.error : "generic"}`)
    : null;
  const token = queryParams.token;
  const approvalPath = token ? `/tilbud/godkjenn/${encodeURIComponent(token)}` : null;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={quote.title}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <span>{quote.quoteNumber ?? t("quotes.detail.noNumber")}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${TONE[quote.status] ?? TONE.DRAFT}`}>
                {t(`quotes.status.${quote.status}`)}
              </span>
              <span>{t("quotes.detail.version", { version: quote.version })}</span>
            </span>
          }
          icon={<Icon name="file" className="h-5 w-5" />}
          actions={
            <Link href="/tilbud" className={BUTTON}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("quotes.detail.back")}
            </Link>
          }
        />

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
        {queryParams.sent && approvalPath ? (
          <section className="rounded-xl border border-[var(--ink,#101310)] bg-[var(--paper,#f2efe6)] p-4">
            <h2 className="text-sm font-black">{t("quotes.detail.linkTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
              {t("quotes.detail.linkHint")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={approvalPath ?? ""}
                className="min-h-11 min-w-64 flex-1 rounded-xl border border-[var(--line,#dedcd1)] bg-white px-3 text-xs"
                aria-label={t("quotes.detail.linkTitle")}
              />
              <Link href={approvalPath ?? "#"} className={PRIMARY}>
                {t("quotes.detail.openLink")}
              </Link>
            </div>
          </section>
        ) : null}

        <section className={CARD}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                {t("quotes.detail.customer")}
              </dt>
              <dd className="font-bold">{quote.customer?.name ?? quote.customerName ?? t("quotes.list.noCustomer")}</dd>
              {quote.customer ? (
                <dd className="text-xs text-[var(--muted,#62685f)]">
                  <Link href={`/kunder/${quote.customer.id}`} className="underline">
                    {quote.customer.customerNumber ?? t("quotes.detail.openCustomer")}
                  </Link>
                </dd>
              ) : null}
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                {t("quotes.detail.contact")}
              </dt>
              <dd>{quote.contact?.name ?? t("quotes.detail.noContact")}</dd>
              {quote.contact?.email ? <dd className="text-xs">{quote.contact.email}</dd> : null}
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                {t("quotes.detail.validUntil")}
              </dt>
              <dd>{quote.validUntil ? formatDateLocalized(quote.validUntil, locale) : t("quotes.detail.noDate")}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                {t("quotes.detail.department")}
              </dt>
              <dd>{quote.department.name}</dd>
            </div>
            {quote.workOrder ? (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                  {t("quotes.detail.workOrder")}
                </dt>
                <dd>
                  <Link href={`/oppdrag/${quote.workOrder.id}`} className="underline">
                    {quote.workOrder.reference} · {quote.workOrder.title}
                  </Link>
                </dd>
              </div>
            ) : null}
            {quote.contract ? (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                  {t("quotes.detail.contract")}
                </dt>
                <dd>{quote.contract.title}</dd>
              </div>
            ) : null}
            {quote.product ? (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                  {t("quotes.detail.equipment")}
                </dt>
                <dd>
                  {quote.product.model}
                  {quote.product.serialNumber ? ` · ${quote.product.serialNumber}` : ""}
                </dd>
              </div>
            ) : null}
            {quote.convertedWorkOrderId ? (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                  {t("quotes.detail.converted")}
                </dt>
                <dd>
                  <Link href={`/oppdrag/${quote.convertedWorkOrderId}`} className="font-bold underline">
                    {t("quotes.detail.openWorkOrder")}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className={CARD}>
          <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
            {t("quotes.detail.lines")}
          </h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-[var(--muted,#62685f)]">
                <th className="pb-2">{t("quotes.lines.description")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.quantity")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.unitPrice")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.vatRate")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.id} className="border-t border-[var(--line,#dedcd1)]">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">{line.quantity.toFixed(2)} {line.unit}</td>
                  <td className="py-2 text-right">{formatAmount(line.unitPrice)}</td>
                  <td className="py-2 text-right">{line.vatRate.toFixed(2)} %</td>
                  <td className="py-2 text-right font-bold">{formatAmount(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>{t("quotes.detail.subtotal")}</dt><dd>{formatAmount(quote.subtotal)}</dd></div>
            <div className="flex justify-between"><dt>{t("quotes.detail.vat", { rate: quote.vatRate.toFixed(2) })}</dt><dd>{formatAmount(quote.vatTotal)}</dd></div>
            <div className="flex justify-between border-t border-[var(--ink,#101310)] pt-1 text-base font-black"><dt>{t("quotes.detail.total")}</dt><dd>{formatAmount(quote.total)}</dd></div>
          </dl>
          {quote.notes ? (
            <div className="mt-4 rounded-xl bg-[var(--paper,#f2efe6)] p-3 text-sm whitespace-pre-wrap">{quote.notes}</div>
          ) : null}
        </section>

        {canManage ? (
          <section className={CARD}>
            <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
              {t("quotes.detail.actions")}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {quote.status === "DRAFT" ? (
                <>
                  <Link href={`/tilbud/${quote.id}/rediger`} className={BUTTON}>
                    <Icon name="edit" className="h-4 w-4" />
                    {t("quotes.detail.edit")}
                  </Link>
                  <form action={sendQuoteAction}>
                    <input type="hidden" name="id" value={quote.id} />
                    <SubmitButton className={PRIMARY} pendingLabel={t("quotes.detail.sending")}>
                      <Icon name="mail" className="h-4 w-4" />
                      {t("quotes.detail.send")}
                    </SubmitButton>
                  </form>
                  <form action={createQuoteVersionAction}>
                    <input type="hidden" name="id" value={quote.id} />
                    <SubmitButton className={BUTTON} pendingLabel={t("quotes.form.saving")}>
                      {t("quotes.detail.saveVersion")}
                    </SubmitButton>
                  </form>
                </>
              ) : null}
              {quote.status === "SENT" ? (
                <form action={reissueQuoteTokenAction}>
                  <input type="hidden" name="id" value={quote.id} />
                  <SubmitButton className={BUTTON} pendingLabel={t("quotes.detail.sending")}>
                    <Icon name="mail" className="h-4 w-4" />
                    {t("quotes.detail.newLink")}
                  </SubmitButton>
                </form>
              ) : null}
              {quote.status === "ACCEPTED" && canConvert && !quote.convertedWorkOrderId ? (
                <form action={convertQuoteAction}>
                  <input type="hidden" name="id" value={quote.id} />
                  <SubmitButton className={PRIMARY} pendingLabel={t("quotes.detail.converting")}>
                    <Icon name="clipboard" className="h-4 w-4" />
                    {t("quotes.detail.convert")}
                  </SubmitButton>
                </form>
              ) : null}
              <form action={cloneQuoteAction}>
                <input type="hidden" name="id" value={quote.id} />
                <SubmitButton className={BUTTON} pendingLabel={t("quotes.form.saving")}>
                  <Icon name="file" className="h-4 w-4" />
                  {t("quotes.detail.clone")}
                </SubmitButton>
              </form>
            </div>
          </section>
        ) : null}

        <section className={CARD}>
          <h2 className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
            {t("quotes.detail.history")}
          </h2>
          {quote.versions.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">{t("quotes.detail.noHistory")}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {quote.versions.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line,#dedcd1)] pt-2">
                  <span className="font-bold">{t("quotes.detail.version", { version: version.version })} · {t(`quotes.status.${version.status}`)}</span>
                  <span className="text-xs text-[var(--muted,#62685f)]">
                    {formatDateLocalized(version.createdAt, locale)} · {formatAmount(version.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {quote.rejectedReason ? (
            <p className="mt-3 rounded-xl bg-[#fbe9e7] p-3 text-sm text-[#8a1f12]">
              {t("quotes.detail.rejectedReason", { reason: quote.rejectedReason })}
            </p>
          ) : null}
          {quote.invoices.length > 0 ? (
            <div className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3">
              <p className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("quotes.detail.invoices")}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {quote.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link href={`/faktura/${invoice.id}`} className="underline">
                      {invoice.invoiceNumber ?? t("quotes.detail.draftInvoice")} · {formatAmount(invoice.total)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
