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
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { listQuotes, QUOTE_STATUSES, isQuoteStatus } from "@/server/quotes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("quotes.list.title") };
}

const PAGE_SIZE = 25;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; side?: string; error?: string; versioned?: string }>;
}) {
  await requireModulePage("quotes");
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
  const status = params.status && isQuoteStatus(params.status) ? params.status : null;
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.side ?? "1") || 1);
  const result = await listQuotes(user, { status, query, page, pageSize: PAGE_SIZE });
  if (!result.ok) redirect("/");

  const canManage = hasPermission(user, "customers.manage");
  const { quotes, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusLabel = (value: string) => t(`quotes.status.${value}`);

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
    "token.expired",
    "token.used",
  ]);
  const errorMessage = params.error
    ? t(`quotes.errors.${errorKeys.has(params.error) ? params.error : "generic"}`)
    : null;

  const hrefWith = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (query) next.set("q", query);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return text ? `/tilbud?${text}` : "/tilbud";
  };

  return (
    <PageShell>
      <PageHeader
        title={t("quotes.list.title")}
        subtitle={t("quotes.list.subtitle")}
        icon={<Icon name="file" className="h-5 w-5" />}
        actions={
          canManage ? (
            <Link
              href="/tilbud/ny"
              className={buttonClassName({ variant: "primary" })}
            >
              <Icon name="plus" className="h-4 w-4" />
              {t("quotes.list.new")}
            </Link>
          ) : null
        }
      />

      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      {params.versioned ? (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("quotes.list.versioned")}
        </p>
      ) : null}

      <Card className="p-3 sm:p-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1">
            <span className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]">
              {t("quotes.list.search")}
            </span>
            <input
              name="q"
              defaultValue={query}
              placeholder={t("quotes.list.searchPlaceholder")}
              className="min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]">
              {t("quotes.list.status")}
            </span>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
            >
              <option value="">{t("quotes.list.allStatuses")}</option>
              {QUOTE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className={buttonClassName({ variant: "secondary" })}
          >
            <Icon name="search" className="h-4 w-4" />
            {t("search")}
          </button>
          {status || query ? (
            <Link
              href="/tilbud"
              className={buttonClassName({ variant: "ghost" })}
            >
              {t("reset")}
            </Link>
          ) : null}
        </form>
      </Card>

      {quotes.length === 0 ? (
        <EmptyState title={t("quotes.list.emptyTitle")} description={t("quotes.list.emptyDescription")} />
      ) : (
        <div data-quotes-list className="space-y-2">
          {quotes.map((quote) => (
            <Card
              as="article"
              key={quote.id}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tilbud/${quote.id}`}
                    className="type-ui underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                  >
                    {quote.title}
                  </Link>
                  <StatusBadge
                    status={quote.status}
                    label={statusLabel(quote.status)}
                  />
                </div>
                <p className="type-meta mt-0.5 text-[var(--muted,#62685f)]">
                  {quote.quoteNumber ?? t("quotes.list.noNumber")} · {quote.customer?.name ?? t("quotes.list.noCustomer")}
                  {quote.validUntil ? ` · ${t("quotes.list.validUntil", { date: formatDateLocalized(quote.validUntil, locale) })}` : ""}
                  {" · "}
                  {t("quotes.list.version", { version: quote.version })}
                </p>
              </div>
              <div className="text-right">
                <p className="type-ui">{formatAmount(quote.total, "NOK")}</p>
                <p className="type-meta text-[var(--muted,#62685f)]">
                  {t("quotes.list.updated", { date: formatDateLocalized(quote.updatedAt, locale) })}
                </p>
                <Link
                  href={`/tilbud/${quote.id}/skriv`}
                  className={`${buttonClassName({ variant: "ghost", size: "sm" })} mt-1`}
                >
                  <Icon name="file" className="h-4 w-4" />
                  {t("quotes.print.action")}
                </Link>
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
