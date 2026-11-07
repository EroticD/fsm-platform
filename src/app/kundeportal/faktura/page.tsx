import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import PortalShell from "@/components/portal/PortalShell";
import Pagination, { paginationLabels } from "@/components/Pagination";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import { requireModulePage } from "@/lib/module-guards";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { parsePage } from "@/lib/pagination";
import { getPortalInvoices } from "@/server/invoices";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  await requireModulePage("invoicing");
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const result = await getPortalInvoices(context.user, { page: parsePage(params.side) });

  return (
    <PortalShell
      active="oversikt"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">{t("portal.invoices.title")}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">{t("portal.invoices.intro")}</p>

        {!result.ok ? (
          <p className="mt-4 text-sm text-[var(--muted,#62685f)]">{t("portal.invoices.forbidden")}</p>
        ) : result.data.invoices.length === 0 ? (
          <p className="mt-4 text-sm italic text-[var(--muted,#62685f)]">{t("portal.invoices.empty")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {result.data.invoices.map((invoice) => (
              <li key={invoice.id} className={`${brandInset} min-w-0 p-3`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/kundeportal/faktura/${invoice.id}`} className="break-words text-sm font-bold underline decoration-2 underline-offset-4">
                      {invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}
                    </Link>
                    <p className="text-xs text-[var(--muted,#62685f)]">
                      {invoice.issueDate ? formatDateLocalized(invoice.issueDate, locale) : t("invoicing.list.noDate")}
                      {invoice.dueDate ? ` · ${t("invoicing.list.due", { date: formatDateLocalized(invoice.dueDate, locale) })}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold">
                    {t(`invoicing.status.${invoice.status}`)}
                  </span>
                </div>
                <dl className="mt-2 grid gap-1 text-xs leading-5 text-[var(--muted,#62685f)] sm:grid-cols-3">
                  <div className="flex gap-1"><dt className="font-bold">{t("portal.invoices.total")}:</dt><dd>{formatAmount(invoice.total, invoice.currency)}</dd></div>
                  <div className="flex gap-1"><dt className="font-bold">{t("portal.invoices.paid")}:</dt><dd>{formatAmount(invoice.paidTotal, invoice.currency)}</dd></div>
                  <div className="flex gap-1"><dt className="font-bold">{t("portal.invoices.outstanding")}:</dt><dd className="font-bold text-[var(--ink,#101310)]">{formatAmount(invoice.outstanding, invoice.currency)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}

        {result.ok ? (
          <Pagination
            page={result.data.page}
            totalPages={result.data.totalPages}
            hrefFor={(page) => `/kundeportal/faktura${page > 1 ? `?side=${page}` : ""}`}
            labels={paginationLabels(t)}
            className="pt-3"
          />
        ) : null}
        <p className="mt-4 border-t border-[var(--line,#dedcd1)] pt-3 text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("portal.invoices.manualPayment")}
        </p>
      </section>
    </PortalShell>
  );
}
