import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import Pagination, { paginationLabels } from "@/components/Pagination";
import EmptyState from "@/components/EmptyState";
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
  DRAFT:
    "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[#3d372b]",
  ACTIVE:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  PAUSED: "border-[#e4c98f] bg-[#fdf5e4] text-[#6b4808]",
  EXPIRED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  TERMINATED: "border-[#c9c0ac] bg-[#efeee8] text-[#4a473e]",
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

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader
          title={t("contractsPage.title")}
          subtitle={t("contractsPage.subtitle")}
          icon={<Icon name="file" className="h-5 w-5" />}
          actions={
            <Link
              href="/kunder"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]"
            >
              <Icon name="building" className="h-4 w-4" />
              {t("contractsPage.customers")}
            </Link>
          }
        />

        <div className="office-card space-y-3 p-3 sm:p-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label
                htmlFor="contracts-search"
                className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]"
              >
                {t("contractsPage.search")}
              </label>
              <input
                id="contracts-search"
                name="q"
                defaultValue={query}
                placeholder={t("contractsPage.searchPlaceholder")}
                className="min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="contracts-status"
                className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]"
              >
                {t("contractsPage.filterStatus")}
              </label>
              <select
                id="contracts-status"
                name="status"
                defaultValue={status ?? ""}
                className="min-h-11 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
              >
                <option value="">{t("contractsPage.allStatuses")}</option>
                {CONTRACT_STATUS_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                name="utlop"
                value="snart"
                defaultChecked={expiring}
                className="h-5 w-5"
              />
              {t("contractsPage.expiringSoon")}
            </label>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]"
            >
              <Icon name="search" className="h-4 w-4" />
              {t("search")}
            </button>
            {status || expiring || query ? (
              <Link
                href="/avtaler"
                className="inline-flex min-h-11 items-center px-2 text-xs font-bold underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
              >
                {t("reset")}
              </Link>
            ) : null}
          </form>
        </div>

        {contracts.length === 0 ? (
          <EmptyState
            title={t("contractsPage.emptyTitle")}
            description={t("contractsPage.emptyDescription")}
          />
        ) : (
          <div className="space-y-2">
            {contracts.map((contract) => (
              <article
                key={contract.id}
                className="office-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/kunder/${contract.customer.id}?tab=avtaler`}
                      className="text-sm font-black underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                    >
                      {contract.title}
                    </Link>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${
                        STATUS_TONE[contract.status] ?? STATUS_TONE.PAUSED
                      }`}
                    >
                      {statusLabel(contract.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                    {contract.customer.name}
                    {contract.contractNumber
                      ? ` · ${contract.contractNumber}`
                      : ""}
                    {" · "}
                    {contract.department.name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-[var(--muted,#62685f)]">
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
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold"
                  >
                    <Icon name="file" className="h-4 w-4" />
                    {t("contractsPage.pdf")}
                  </a>
                  <Link
                    href={`/kunder/${contract.customer.id}?tab=avtaler`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]"
                  >
                    {t("contractsPage.edit")}
                    <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </article>
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
      </div>
    </div>
  );
}
