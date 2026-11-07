import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import Pagination, { paginationLabels } from "@/components/Pagination";
import ErrorBanner from "@/components/ErrorBanner";
import SubmitButton from "@/components/SubmitButton";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { listInvoices, INVOICE_STATUSES, isInvoiceStatus } from "@/server/invoices";
import { markOverdueAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("invoicing.list.title") };
}

const PAGE_SIZE = 25;

const TONE: Record<string, string> = {
  DRAFT: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
  SENT: "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  PARTIALLY_PAID: "border-[#e4c98f] bg-[#fdf5e4] text-[#6b4808]",
  PAID: "border-[#b6d7a6] bg-[#edf8e8] text-[#255d17]",
  OVERDUE: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  CREDITED: "border-[#c9c0ac] bg-[#efeee8] text-[#4a473e]",
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    forfalt?: string;
    side?: string;
    error?: string;
    overdueSweep?: string;
  }>;
}) {
  await requireModulePage("invoicing");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (
    !hasPermission(user, "customers.view") &&
    !hasPermission(user, "customers.manage") &&
    !hasPermission(user, "workorders.view")
  ) {
    redirect("/");
  }

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const status = params.status && isInvoiceStatus(params.status) ? params.status : null;
  const overdue = params.forfalt === "1";
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.side ?? "1") || 1);
  const result = await listInvoices(user, { status, overdue, query, page, pageSize: PAGE_SIZE });
  if (!result.ok) redirect("/");

  const canManage = hasPermission(user, "customers.manage");
  const { invoices, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusLabel = (value: string) => t(`invoicing.status.${value}`);
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
  };
  const errorMessage = params.error
    ? (errorMessages[params.error] ?? t("invoicing.errors.generic"))
    : null;

  const hrefWith = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (overdue) next.set("forfalt", "1");
    if (query) next.set("q", query);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return text ? `/faktura?${text}` : "/faktura";
  };
  const exportQuery = new URLSearchParams();
  if (status) exportQuery.set("status", status);
  if (overdue) exportQuery.set("overdue", "1");
  if (query) exportQuery.set("q", query);
  const exportHref = `/api/faktura/eksport${exportQuery.size ? `?${exportQuery.toString()}` : ""}`;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          title={t("invoicing.list.title")}
          subtitle={t("invoicing.list.subtitle")}
          icon={<Icon name="file" className="h-5 w-5" />}
          actions={
            <>
              {canManage ? (
                <Link href={exportHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold">
                  <Icon name="file" className="h-4 w-4" />
                  {t("invoicing.list.export")}
                </Link>
              ) : null}
              {canManage ? (
                <Link href="/faktura/ny" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]">
                  <Icon name="plus" className="h-4 w-4" />
                  {t("invoicing.list.new")}
                </Link>
              ) : null}
              {user.role === "ADMIN" ? (
                <Link href="/faktura/innstillinger" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-xs font-bold">
                  <Icon name="settings" className="h-4 w-4" />
                  {t("invoicing.list.settings")}
                </Link>
              ) : null}
            </>
          }
        />

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
        {params.overdueSweep ? (
          <p className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 py-3 text-sm font-bold">
            {t("invoicing.list.overdueSweep", { count: Number(params.overdueSweep) || 0 })}
          </p>
        ) : null}

        <form method="get" className="office-card flex flex-wrap items-end gap-2 p-3 sm:p-4">
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
              {t("invoicing.list.search")}
            </span>
            <input
              name="q"
              defaultValue={query}
              placeholder={t("invoicing.list.searchPlaceholder")}
              className="min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
              {t("invoicing.list.status")}
            </span>
            <select name="status" defaultValue={status ?? ""} className="min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm">
              <option value="">{t("invoicing.list.allStatuses")}</option>
              {INVOICE_STATUSES.map((value) => (
                <option key={value} value={value}>{statusLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input type="checkbox" name="forfalt" value="1" defaultChecked={overdue} className="h-5 w-5" />
            {t("invoicing.list.overdue")}
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]">
            <Icon name="search" className="h-4 w-4" />
            {t("search")}
          </button>
          {status || overdue || query ? (
            <Link href="/faktura" className="inline-flex min-h-11 items-center px-2 text-xs font-bold underline">{t("reset")}</Link>
          ) : null}
        </form>

        {user.role === "ADMIN" ? (
          <form action={markOverdueAction} className="flex justify-end">
            <SubmitButton className="inline-flex min-h-10 items-center rounded-[10px] border border-[var(--line,#dedcd1)] px-3 text-xs font-bold" pendingLabel={t("invoicing.list.sweeping")}>
              {t("invoicing.list.sweep")}
            </SubmitButton>
          </form>
        ) : null}

        {invoices.length === 0 ? (
          <EmptyState title={t("invoicing.list.emptyTitle")} description={t("invoicing.list.emptyDescription")} />
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <article key={invoice.id} className="office-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/faktura/${invoice.id}`} className="text-sm font-black underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4">
                      {invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}
                    </Link>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${TONE[invoice.status] ?? TONE.DRAFT}`}>
                      {statusLabel(invoice.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                    {invoice.customer.name}
                    {" · "}
                    {invoice.issueDate ? formatDateLocalized(invoice.issueDate, locale) : t("invoicing.list.noDate")}
                    {invoice.dueDate ? ` · ${t("invoicing.list.due", { date: formatDateLocalized(invoice.dueDate, locale) })}` : ""}
                    {invoice.lines[0]?.description ? ` · ${invoice.lines[0].description}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black">{formatAmount(invoice.total, invoice.currency)}</p>
                  <p className="text-xs text-[var(--muted,#62685f)]">
                    {t("invoicing.list.outstanding", { amount: formatAmount(invoice.outstanding, invoice.currency) })}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          hrefFor={(target) => hrefWith({ side: target > 1 ? String(target) : null })}
          labels={paginationLabels(t)}
        />
      </div>
    </div>
  );
}
