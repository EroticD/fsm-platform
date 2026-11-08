import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import PrintButton from "@/components/billing/PrintButton";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { getQuote } from "@/server/quotes";

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModulePage("quotes");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const { id } = await params;
  const result = await getQuote(user, id);
  if (!result.ok) notFound();
  const quote = result.data;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const branding = await prisma.branding.findFirst({
    select: { companyName: true, logoUrl: true },
  });
  const customerName = quote.customer?.name ?? quote.customerName ?? t("quotes.list.noCustomer");

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] px-3 py-6 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Link
            href={`/tilbud/${quote.id}`}
            className="inline-flex min-h-11 items-center rounded-[10px] border border-[var(--line,#dedcd1)] px-4 text-xs font-bold"
          >
            {t("quotes.print.back")}
          </Link>
          <PrintButton label={t("quotes.print.print")} />
        </div>

        <article className="rounded-2xl border border-[var(--line,#dedcd1)] bg-white p-6 text-[#101310] shadow-sm print:border-0 print:shadow-none sm:p-10">
          <header className="flex flex-col justify-between gap-4 border-b-2 border-[#101310] pb-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#62685f]">
                {t("quotes.print.document")}
              </p>
              <h1 className="mt-1 text-2xl font-black">{quote.title}</h1>
              <p className="mt-1 text-sm">
                {quote.quoteNumber ?? t("quotes.detail.noNumber")} · {t("quotes.detail.version", { version: quote.version })}
              </p>
              {branding?.logoUrl ? (
                // Logoen er en vanlig, offentlig lagret fil, ikke brukerinnhold.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logoUrl}
                  alt={branding.companyName ?? t("quotes.print.companyFallback")}
                  className="mt-3 h-10 w-auto"
                />
              ) : null}
              <p className="mt-1 text-sm font-bold">
                {branding?.companyName ?? t("quotes.print.companyFallback")}
              </p>
            </div>
            <div className="text-sm sm:text-right">
              <p className="font-bold">{customerName}</p>
              {quote.customer?.orgNumber ? <p>{t("quotes.print.orgNumber")}: {quote.customer.orgNumber}</p> : null}
              {quote.customer?.address ? <p>{quote.customer.address}</p> : null}
              {quote.customer?.postalCode || quote.customer?.city ? (
                <p>{[quote.customer.postalCode, quote.customer.city].filter(Boolean).join(" ")}</p>
              ) : null}
              {quote.contact ? (
                <p className="mt-2">
                  {quote.contact.name}
                  {quote.contact.email ? ` · ${quote.contact.email}` : ""}
                  {quote.contact.phone ? ` · ${quote.contact.phone}` : ""}
                </p>
              ) : null}
            </div>
          </header>

          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("quotes.print.issueDate")}</dt>
              <dd>{formatDateLocalized(quote.createdAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("quotes.detail.validUntil")}</dt>
              <dd>{quote.validUntil ? formatDateLocalized(quote.validUntil, locale) : t("quotes.detail.noDate")}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("quotes.print.department")}</dt>
              <dd>{quote.department.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("quotes.print.status")}</dt>
              <dd>{t(`quotes.status.${quote.status}`)}</dd>
            </div>
          </dl>

          <table className="mt-6 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#101310] text-xs uppercase text-[#62685f]">
                <th className="pb-2">{t("quotes.lines.description")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.quantity")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.unitPrice")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.vatRate")}</th>
                <th className="pb-2 text-right">{t("quotes.lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.id} className="border-b border-[#dedcd1]">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">{line.quantity.toFixed(2)} {line.unit}</td>
                  <td className="py-2 text-right">{formatAmount(line.unitPrice, quote.currency)}</td>
                  <td className="py-2 text-right">{line.vatRate.toFixed(2)} %</td>
                  <td className="py-2 text-right">{formatAmount(line.lineTotal, quote.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>{t("quotes.detail.subtotal")}</dt><dd>{formatAmount(quote.subtotal, quote.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("quotes.detail.vat", { rate: quote.vatRate.toFixed(2) })}</dt><dd>{formatAmount(quote.vatTotal, quote.currency)}</dd></div>
            <div className="flex justify-between border-t border-[#101310] pt-1 text-base font-black"><dt>{t("quotes.detail.total")}</dt><dd>{formatAmount(quote.total, quote.currency)}</dd></div>
          </dl>

          <footer className="mt-8 border-t border-[#dedcd1] pt-3 text-xs leading-5 text-[#62685f]">
            {quote.notes ? (
              <>
                <p className="font-bold text-[#101310]">{t("quotes.print.notes")}</p>
                <p className="mt-1 whitespace-pre-wrap">{quote.notes}</p>
              </>
            ) : null}
            <p className="mt-2">
              {t("quotes.print.terms", {
                date: quote.validUntil ? formatDateLocalized(quote.validUntil, locale) : t("quotes.detail.noDate"),
              })}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
