import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import Icon from "@/components/icons";
import ErrorBanner from "@/components/ErrorBanner";
import SubmitButton from "@/components/SubmitButton";
import { requireModulePage } from "@/lib/module-guards";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { getQuoteByToken } from "@/server/quotes";
import { acceptQuoteAction, rejectQuoteAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("quotes.approval.title") };
}

const CARD = "rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 sm:p-6";
const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-surface px-3 py-2 text-sm";

export default async function QuoteApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string; error?: string }>;
}) {
  await requireModulePage("quotes");
  const { token } = await params;
  const query = await searchParams;
  const result = await getQuoteByToken(token);
  if (!result.ok) notFound();
  const quote = result.data;
  const t = await getTranslations("common");
  const locale = await getLocale();

  const tokenExpired = quote.tokenExpired;
  const canDecide = quote.canDecide;
  const errorKeys = new Set(["forbidden", "invalid", "not_found", "conflict", "token.expired", "token.used", "quote.expired"]);
  const errorMessage = query.error
    ? t(`quotes.approval.errors.${errorKeys.has(query.error) ? query.error : "generic"}`)
    : null;

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] px-3 py-6 text-[var(--ink,#101310)] sm:px-6">
      <main className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-2xl bg-[var(--ink,#101310)] px-5 py-5 text-[var(--paper,#f2efe6)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#cfc8b9]">
            {t("quotes.approval.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{quote.title}</h1>
          <p className="mt-1 text-sm text-[#ded8ca]">
            {quote.quoteNumber ?? t("quotes.detail.noNumber")}
            {quote.customerName ? ` · ${quote.customerName}` : ""}
          </p>
        </header>

        {query.result === "accepted" || quote.status === "ACCEPTED" ? (
          <p role="status" className="rounded-xl border border-[#b6d7a6] bg-[#edf8e8] px-4 py-3 text-sm font-bold text-[#255d17]">
            {t("quotes.approval.accepted")}
          </p>
        ) : null}
        {query.result === "rejected" || quote.status === "REJECTED" ? (
          <p role="status" className="rounded-xl border border-[#e7b5ae] bg-[var(--risk-surface,#fdf4f2)] px-4 py-3 text-sm font-bold text-[#8a1f12]">
            {t("quotes.approval.rejected")}
          </p>
        ) : null}
        {quote.status === "EXPIRED" || tokenExpired ? (
          <p role="status" className="rounded-xl border border-[#c9c0ac] bg-[#efeee8] px-4 py-3 text-sm font-bold">
            {t("quotes.approval.expired")}
          </p>
        ) : null}
        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        <section className={CARD}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("quotes.approval.validUntil")}</dt>
              <dd>{quote.validUntil ? formatDateLocalized(quote.validUntil, locale) : t("quotes.detail.noDate")}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">{t("quotes.approval.contact")}</dt>
              <dd>{quote.contactName ?? t("quotes.detail.noContact")}</dd>
            </div>
          </dl>

          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-[var(--muted,#62685f)]">
                <th className="pb-2">{t("quotes.lines.description")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.quantity")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.id} className="border-t border-[var(--line,#dedcd1)]">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">{line.quantity.toFixed(2)} {line.unit}</td>
                  <td className="py-2 text-right font-bold">{formatAmount(line.lineTotal, quote.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>{t("quotes.detail.subtotal")}</dt><dd>{formatAmount(quote.subtotal, quote.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("quotes.detail.vatTotal")}</dt><dd>{formatAmount(quote.vatTotal, quote.currency)}</dd></div>
            <div className="flex justify-between border-t border-[var(--ink,#101310)] pt-1 text-base font-black"><dt>{t("quotes.detail.total")}</dt><dd>{formatAmount(quote.total, quote.currency)}</dd></div>
          </dl>
          {quote.notes ? (
            <div className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--paper,#f2efe6)] p-3 text-sm">{quote.notes}</div>
          ) : null}
        </section>

        {canDecide ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <section className={CARD}>
              <h2 className="text-lg font-extrabold">{t("quotes.approval.acceptTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">{t("quotes.approval.acceptHint")}</p>
              <form action={acceptQuoteAction} className="mt-3 space-y-3">
                <input type="hidden" name="token" value={token} />
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("quotes.approval.name")}</span>
                  <input name="name" required maxLength={200} className={INPUT} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("quotes.approval.comment")}</span>
                  <textarea name="comment" rows={2} className={INPUT} maxLength={2000} />
                </label>
                <SubmitButton
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]"
                  pendingLabel={t("quotes.approval.accepting")}
                >
                  <Icon name="check" className="h-4 w-4" />
                  {t("quotes.approval.accept")}
                </SubmitButton>
              </form>
            </section>
            <section className={CARD}>
              <h2 className="text-lg font-extrabold">{t("quotes.approval.rejectTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">{t("quotes.approval.rejectHint")}</p>
              <form action={rejectQuoteAction} className="mt-3 space-y-3">
                <input type="hidden" name="token" value={token} />
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("quotes.approval.name")}</span>
                  <input name="name" required maxLength={200} className={INPUT} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold">{t("quotes.approval.reason")}</span>
                  <textarea name="reason" required rows={2} className={INPUT} maxLength={2000} />
                </label>
                <SubmitButton
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--risk,#b42318)] px-3 py-2 text-xs font-bold text-[var(--risk,#b42318)]"
                  pendingLabel={t("quotes.approval.rejecting")}
                >
                  <Icon name="close" className="h-4 w-4" />
                  {t("quotes.approval.reject")}
                </SubmitButton>
              </form>
            </section>
          </div>
        ) : null}

        <p className="text-center text-xs text-[var(--muted,#62685f)]">
          <Link href="/" className="underline">{t("quotes.approval.home")}</Link>
        </p>
      </main>
    </div>
  );
}
