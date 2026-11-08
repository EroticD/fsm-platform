import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { buttonClassName } from "@/components/ui/Button";
import EmptyState from "@/components/EmptyState";
import StatusBadge from "@/components/StatusBadge";
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
    <PageShell>
      <PageHeader
        title={t("invoicing.list.title")}
        subtitle={t("invoicing.list.subtitle")}
        icon={<Icon name="file" className="h-5 w-5" />}
        actions={
          <>
            {canManage ? (
              <Link
                href={exportHref}
                className={buttonClassName({ variant: "secondary" })}
              >
                <Icon name="file" className="h-4 w-4" />
                {t("invoicing.list.export")}
              </Link>
            ) : null}
            {canManage ? (
              <Link
                href="/faktura/ny"
                className={buttonClassName({ variant: "primary" })}
              >
                <Icon name="plus" className="h-4 w-4" />
                {t("invoicing.list.new")}
              </Link>
            ) : null}
            {user.role === "ADMIN" ? (
              <Link
                href="/faktura/innstillinger"
                className={buttonClassName({ variant: "secondary" })}
              >
                <Icon name="settings" className="h-4 w-4" />
                {t("invoicing.list.settings")}
              </Link>
            ) : null}
          </>
        }
      />

      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      {params.overdueSweep ? (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("invoicing.list.overdueSweep", { count: Number(params.overdueSweep) || 0 })}
        </p>
      ) : null}

      <Card className="p-3 sm:p-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1">
            <span className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]">
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
            <span className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]">
              {t("invoicing.list.status")}
            </span>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
            >
              <option value="">{t("invoicing.list.allStatuses")}</option>
              {INVOICE_STATUSES.map((value) => (
                <option key={value} value={value}>{statusLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="type-ui flex min-h-11 items-center gap-2 text-[var(--ink,#101310)]">
            <input type="checkbox" name="forfalt" value="1" defaultChecked={overdue} className="h-5 w-5" />
            {t("invoicing.list.overdue")}
          </label>
          <button
            type="submit"
            className={buttonClassName({ variant: "secondary" })}
          >
            <Icon name="search" className="h-4 w-4" />
            {t("search")}
          </button>
          {status || overdue || query ? (
            <Link
              href="/faktura"
              className={buttonClassName({ variant: "ghost" })}
            >
              {t("reset")}
            </Link>
          ) : null}
        </form>
      </Card>

      {user.role === "ADMIN" ? (
        <form action={markOverdueAction} className="flex justify-end">
          <SubmitButton
            className={buttonClassName({ variant: "secondary", size: "sm" })}
            pendingLabel={t("invoicing.list.sweeping")}
          >
            {t("invoicing.list.sweep")}
          </SubmitButton>
        </form>
      ) : null}

      {invoices.length === 0 ? (
        <EmptyState title={t("invoicing.list.emptyTitle")} description={t("invoicing.list.emptyDescription")} />
      ) : (
        <div className="space-y-2">
          {invoices.map((invoice) => (
            <Card
              as="article"
              key={invoice.id}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/faktura/${invoice.id}`} className="type-ui underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4">
                    {invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}
                  </Link>
                  <StatusBadge
                    status={invoice.status}
                    label={statusLabel(invoice.status)}
                  />
                </div>
                <p className="type-meta mt-0.5 text-[var(--muted,#62685f)]">
                  {invoice.customer.name}
                  {" · "}
                  {invoice.issueDate ? formatDateLocalized(invoice.issueDate, locale) : t("invoicing.list.noDate")}
                  {invoice.dueDate ? ` · ${t("invoicing.list.due", { date: formatDateLocalized(invoice.dueDate, locale) })}` : ""}
                  {invoice.lines[0]?.description ? ` · ${invoice.lines[0].description}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="type-ui">{formatAmount(invoice.total, invoice.currency)}</p>
                <p className="type-meta text-[var(--muted,#62685f)]">
                  {t("invoicing.list.outstanding", { amount: formatAmount(invoice.outstanding, invoice.currency) })}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        hrefFor={(target) => hrefWith({ side: target > 1 ? String(target) : null })}
        labels={paginationLabels(t)}
      />
    </PageShell>
  );
}
