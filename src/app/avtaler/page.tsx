import { requireModulePage } from "@/lib/module-guards";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Pagination, { paginationLabels } from "@/components/Pagination";
import EmptyState from "@/components/EmptyState";
import Card from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import {
  isContractStatus,
  listContracts,
  type ContractStatusValue,
} from "@/server/contracts";
import { CONTRACT_STATUS_FILTERS } from "./filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("contractsPage.title") };
}

const PAGE_SIZE = 25;

const STATUS_TONE: Record<string, string> = {
  DRAFT: "border-line bg-paper text-ink",
  ACTIVE: "border-ink bg-signal text-ink",
  PAUSED:
    "border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] text-[var(--warning-text,#7a4f0c)]",
  EXPIRED:
    "border-[color-mix(in_srgb,var(--risk-text,#b42318)_22%,transparent)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]",
  TERMINATED: "border-line bg-surface text-muted",
};

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    utlop?: string;
    q?: string;
    side?: string;
  }>;
}) {
  await requireModulePage("contracts");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (
    !hasPermission(user, "contracts.view") &&
    !hasPermission(user, "contracts.manage")
  ) {
    redirect("/");
  }

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const status: ContractStatusValue | null =
    params.status && isContractStatus(params.status) ? params.status : null;
  const expiring = params.utlop === "snart";
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.side ?? "1") || 1);

  const result = await listContracts(user, {
    status,
    expiringDays: expiring ? 60 : null,
    query,
    page,
    pageSize: PAGE_SIZE,
  });
  if (!result.ok) redirect("/");

  const { contracts, total } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statusLabel = (value: string) => {
    switch (value) {
      case "DRAFT":
        return t("contractsPage.status.draft");
      case "ACTIVE":
        return t("contractsPage.status.active");
      case "PAUSED":
        return t("contractsPage.status.paused");
      case "EXPIRED":
        return t("contractsPage.status.expired");
      case "TERMINATED":
        return t("contractsPage.status.terminated");
      default:
        return value;
    }
  };

  const hrefWith = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (expiring) next.set("utlop", "snart");
    if (query) next.set("q", query);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return text ? `/avtaler?${text}` : "/avtaler";
  };

  const hasActiveFilters = Boolean(status || expiring || query);
  // Ved treffløse filtre skal brukeren få nullstilt dem, ikke onboarding-teksten.
  const resetHref = hrefWith({
    status: null,
    q: null,
    utlop: null,
    side: null,
  });

  return (
    <PageShell>
      <PageHeader
        title={t("contractsPage.title")}
        subtitle={t("contractsPage.subtitle")}
        icon={<Icon name="file" className="h-5 w-5" />}
        actions={
          <Link
            href="/kunder"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="building" className="h-4 w-4" />
            {t("contractsPage.customers")}
          </Link>
        }
      />

      <Card as="section" className="space-y-3 p-3 sm:p-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Field
            id="contracts-search"
            label={t("contractsPage.search")}
            className="min-w-56 flex-1"
          >
            <Input
              id="contracts-search"
              name="q"
              defaultValue={query}
              placeholder={t("contractsPage.searchPlaceholder")}
            />
          </Field>
          <Field id="contracts-status" label={t("contractsPage.filterStatus")}>
            <Select
              id="contracts-status"
              name="status"
              defaultValue={status ?? ""}
            >
              <option value="">{t("contractsPage.allStatuses")}</option>
              {CONTRACT_STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              name="utlop"
              value="snart"
              defaultChecked={expiring}
              className="h-5 w-5 rounded border-line"
            />
            {t("contractsPage.expiringSoon")}
          </label>
          <button
            type="submit"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="search" className="h-4 w-4" />
            {t("search")}
          </button>
          {status || expiring || query ? (
            <Link
              href="/avtaler"
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              {t("contractsPage.resetFilters")}
            </Link>
          ) : null}
        </form>
      </Card>

      {contracts.length === 0 ? (
        <EmptyState
          title={
            hasActiveFilters
              ? t("contractsPage.emptyFilteredTitle")
              : t("contractsPage.emptyTitle")
          }
          description={
            hasActiveFilters
              ? t("contractsPage.emptyFilteredDescription")
              : t("contractsPage.emptyDescription")
          }
          action={
            hasActiveFilters ? (
              <Link
                href={resetHref}
                className={buttonClassName({ variant: "primary", size: "sm" })}
              >
                {t("contractsPage.resetFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {contracts.map((contract) => (
            <Card
              key={contract.id}
              as="article"
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/kunder/${contract.customer.id}?tab=avtaler`}
                    className="text-sm font-black text-ink underline decoration-signal decoration-2 underline-offset-4"
                  >
                    {contract.title}
                  </Link>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-2xs font-black uppercase ${
                      STATUS_TONE[contract.status] ?? STATUS_TONE.PAUSED
                    }`}
                  >
                    {statusLabel(contract.status)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {contract.customer.name}
                  {contract.contractNumber
                    ? ` · ${contract.contractNumber}`
                    : ""}
                  {" · "}
                  {contract.department.name}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                  <span>
                    {t("contractsPage.period", {
                      start: formatDateLocalized(
                        contract.startDate,
                        locale,
                        undefined,
                        "–",
                      ),
                      end: contract.endDate
                        ? formatDateLocalized(
                            contract.endDate,
                            locale,
                            undefined,
                            "–",
                          )
                        : t("contractsPage.noEndDate"),
                    })}
                  </span>
                  {contract.slaPolicy ? (
                    <span>
                      {t("contractsPage.sla", {
                        name: contract.slaPolicy.name,
                      })}
                    </span>
                  ) : null}
                  <span>
                    {t("contractsPage.linesAndOrders", {
                      lines: contract._count.lines,
                      orders: contract._count.workOrders,
                    })}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <a
                  href={`/api/avtaler/${contract.id}/pdf?locale=${locale}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName({ variant: "secondary", size: "sm" })}
                >
                  <Icon name="file" className="h-4 w-4" />
                  {t("contractsPage.pdf")}
                </a>
                <Link
                  href={`/kunder/${contract.customer.id}?tab=avtaler`}
                  className={buttonClassName({ variant: "primary", size: "sm" })}
                >
                  {t("contractsPage.edit")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {total > PAGE_SIZE ? (
        <Pagination
          page={Math.min(page, totalPages)}
          totalPages={totalPages}
          hrefFor={(nextPage) =>
            hrefWith({ side: nextPage > 1 ? String(nextPage) : null })
          }
          labels={paginationLabels(t)}
        />
      ) : null}
    </PageShell>
  );
}
