import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import { requireModulePage } from "@/lib/module-guards";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { paymentProviderInfo } from "@/lib/payments/provider";
import { getPortalInvoice } from "@/server/invoices";
import { PortalNoAccess, loadPortalPage } from "../../portal-page";

export default async function PortalInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModulePage("invoicing");
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const { id } = await params;
  const result = await getPortalInvoice(context.user, id);
  if (!result.ok) notFound();
  const invoice = result.data;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const paymentInfo = paymentProviderInfo();
  const canPay =
    paymentInfo.configured &&
    paymentInfo.provider === invoice.paymentProvider &&
    Boolean(invoice.paymentLinkUrl) &&
    invoice.paymentStatus === "PENDING" &&
    Number(invoice.outstanding.toString()) > 0;

  return (
    <PortalShell active="oversikt" customer={context.customer} userName={context.user.name ?? context.user.email ?? ""}>
      <section className={`${brandCard} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">
              {invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}
            </h2>
            <p className="text-xs text-[var(--muted,#62685f)]">
              {invoice.issueDate ? formatDateLocalized(invoice.issueDate, locale) : t("invoicing.list.noDate")}
              {invoice.dueDate ? ` · ${t("invoicing.list.due", { date: formatDateLocalized(invoice.dueDate, locale) })}` : ""}
            </p>
          </div>
          <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold">
            {t(`invoicing.status.${invoice.status}`)}
          </span>
        </div>

        <div className={`${brandInset} mt-4 p-3`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-[var(--muted,#62685f)]">
                <th className="pb-2">{t("invoicing.lines.description")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.quantity")}</th>
                <th className="pb-2 text-right">{t("invoicing.lines.total")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-t border-[var(--line,#dedcd1)]">
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 text-right">{line.quantity.toFixed(2)} {line.unit}</td>
                  <td className="py-2 text-right font-bold">{formatAmount(line.lineTotal, invoice.currency)}</td>
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

        {canPay && invoice.paymentLinkUrl ? (
          <div className="mt-4 rounded-xl border border-[var(--ink,#101310)] p-3">
            <a
              href={invoice.paymentLinkUrl}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[var(--ink,#101310)] px-4 py-2 text-sm font-bold text-[var(--paper,#f2efe6)]"
            >
              {t("portal.invoices.pay")}
            </a>
            <p className="mt-2 text-xs leading-5 text-[var(--muted,#62685f)]">
              {t("portal.invoices.payHint")}
            </p>
          </div>
        ) : null}
        <p className="mt-4 rounded-xl bg-[var(--paper,#f2efe6)] p-3 text-xs leading-5 text-[var(--muted,#62685f)]">
          {canPay
            ? t("portal.invoices.paymentPending")
            : t("portal.invoices.manualPayment", { reference: invoice.invoiceNumber ?? invoice.id })}
        </p>
        {invoice.notes ? <p className="mt-3 whitespace-pre-wrap text-sm">{invoice.notes}</p> : null}
        <p className="mt-4 text-xs">
          <Link href="/kundeportal/faktura" className="underline">{t("portal.invoices.back")}</Link>
        </p>
      </section>
    </PortalShell>
  );
}
