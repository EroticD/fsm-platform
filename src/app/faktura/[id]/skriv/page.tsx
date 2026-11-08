import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import PrintButton from "@/components/billing/PrintButton";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { getInvoice } from "@/server/invoices";

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModulePage("invoicing");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const { id } = await params;
  const result = await getInvoice(user, id);
  if (!result.ok) notFound();
  const invoice = result.data;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const branding = await prisma.branding.findFirst({ select: { companyName: true } });

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] px-3 py-6 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Link href={`/faktura/${invoice.id}`} className="inline-flex min-h-11 items-center rounded-[10px] border border-[var(--line,#dedcd1)] px-4 text-xs font-bold">
            {t("invoicing.print.back")}
          </Link>
          <PrintButton label={t("invoicing.print.print")} />
        </div>

        <article className="rounded-2xl border border-[var(--line,#dedcd1)] bg-white p-6 text-[#101310] shadow-sm print:border-0 print:shadow-none sm:p-10">
          <header className="flex flex-col justify-between gap-4 border-b-2 border-[#101310] pb-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#62685f]">{t("invoicing.print.document")}</p>
              <h1 className="mt-1 text-2xl font-black">{invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}</h1>
              <p className="mt-1 text-sm">{branding?.companyName ?? t("invoicing.print.companyFallback")}</p>
            </div>
            <div className="text-sm sm:text-right">
              <p className="font-bold">{invoice.customer.name}</p>
              {invoice.customer.orgNumber ? <p>{t("invoicing.detail.orgNumber")}: {invoice.customer.orgNumber}</p> : null}
              {invoice.customer.address ? <p>{invoice.customer.address}</p> : null}
              {invoice.customer.postalCode || invoice.customer.city ? (
                <p>{[invoice.customer.postalCode, invoice.customer.city].filter(Boolean).join(" ")}</p>
              ) : null}
            </div>
          </header>

          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("invoicing.form.issueDate")}</dt>
              <dd>{invoice.issueDate ? formatDateLocalized(invoice.issueDate, locale) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("invoicing.form.dueDate")}</dt>
              <dd>{invoice.dueDate ? formatDateLocalized(invoice.dueDate, locale) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("invoicing.detail.links")}</dt>
              <dd>{invoice.workOrder?.reference ?? invoice.quote?.quoteNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-[#62685f]">{t("invoicing.detail.status")}</dt>
              <dd>{t(`invoicing.status.${invoice.status}`)}</dd>
            </div>
          </dl>

          <table className="mt-6 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#101310] text-xs uppercase text-[#62685f]">
                <th className="pb-2">{t("invoicing.lines.description")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.quantity")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.unitPrice")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.vatRate")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-b border-[#dedcd1]">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">{line.quantity.toFixed(2)} {line.unit}</td>
                  <td className="py-2 text-right">{formatAmount(line.unitPrice, invoice.currency)}</td>
                  <td className="py-2 text-right">{line.vatRate.toFixed(2)} %</td>
                  <td className="py-2 text-right">{formatAmount(line.lineTotal, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>{t("invoicing.detail.subtotal")}</dt><dd>{formatAmount(invoice.subtotal, invoice.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("invoicing.detail.vat")}</dt><dd>{formatAmount(invoice.vatTotal, invoice.currency)}</dd></div>
            <div className="flex justify-between border-t border-[#101310] pt-1 text-base font-black"><dt>{t("invoicing.detail.total")}</dt><dd>{formatAmount(invoice.total, invoice.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("invoicing.detail.paid")}</dt><dd>{formatAmount(invoice.paidTotal, invoice.currency)}</dd></div>
            <div className="flex justify-between"><dt>{t("invoicing.detail.credited")}</dt><dd>{formatAmount(invoice.creditedTotal, invoice.currency)}</dd></div>
            <div className="flex justify-between text-base font-black"><dt>{t("invoicing.detail.outstanding")}</dt><dd>{formatAmount(invoice.outstanding, invoice.currency)}</dd></div>
          </dl>

          <footer className="mt-8 border-t border-[#dedcd1] pt-3 text-xs leading-5 text-[#62685f]">
            <p className="font-bold text-[#101310]">{t("invoicing.print.paymentTitle")}</p>
            <p>{t("invoicing.print.paymentHint", { reference: invoice.invoiceNumber ?? invoice.id })}</p>
            {invoice.notes ? <p className="mt-2 whitespace-pre-wrap">{invoice.notes}</p> : null}
          </footer>
        </article>
      </div>
    </div>
  );
}
