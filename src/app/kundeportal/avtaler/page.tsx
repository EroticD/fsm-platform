import { getTranslations, getLocale } from "next-intl/server";
import { formatDateLocalized } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import { getPortalContracts } from "@/server/portal-expansion";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;

  if (!context.access.capabilities.canViewContracts) {
    return (
      <PortalShell
        active="avtaler"
        customer={context.customer}
        userName={context.user.name ?? context.user.email ?? ""}
      >
        <section className={brandCard}>
          <h2 className="text-lg font-extrabold">
            {t("portal.expansion.contracts.title")}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.contracts.forbidden")}
          </p>
        </section>
      </PortalShell>
    );
  }

  const result = await getPortalContracts(context.user, {
    page: parsePage(params.side),
  });

  return (
    <PortalShell
      active="avtaler"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t("portal.expansion.contracts.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("portal.expansion.contracts.intro")}
        </p>

        {!result.ok ? (
          <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.contracts.forbidden")}
          </p>
        ) : result.data.items.length === 0 ? (
          <p className="mt-4 text-sm italic text-[var(--muted,#62685f)]">
            {t("portal.expansion.contracts.empty")}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {result.data.items.map((contract) => (
              <li key={contract.id} className={`${brandInset} min-w-0 p-3`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold">
                      {contract.title}
                    </p>
                    <p className="text-xs text-[var(--muted,#62685f)]">
                      {contract.contractNumber
                        ? t("portal.expansion.contracts.number", {
                            number: contract.contractNumber,
                          })
                        : t("portal.expansion.contracts.noNumber")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold">
                    {t(`portal.expansion.contracts.statuses.${contract.status}`)}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-xs leading-5 text-[var(--muted,#62685f)]">
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-bold">
                      {t("portal.expansion.contracts.periodLabel")}:
                    </dt>
                    <dd>
                      {formatDateLocalized(contract.startDate, locale)} –{" "}
                      {contract.endDate
                        ? formatDateLocalized(contract.endDate, locale)
                        : t("portal.expansion.contracts.openEnded")}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-bold">
                      {t("portal.expansion.contracts.intervalLabel")}:
                    </dt>
                    <dd>
                      {t("portal.expansion.contracts.months", {
                        count: contract.intervalMonths,
                      })}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-bold">
                      {t("portal.expansion.contracts.nextServiceLabel")}:
                    </dt>
                    <dd>
                      {formatDateLocalized(contract.nextServiceDate, locale)}
                    </dd>
                  </div>
                  {contract.slaPolicyName && (
                    <div className="flex flex-wrap gap-x-1.5">
                      <dt className="font-bold">
                        {t("portal.expansion.contracts.slaLabel")}:
                      </dt>
                      <dd>{contract.slaPolicyName}</dd>
                    </div>
                  )}
                </dl>
                {contract.lines.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-[var(--line,#dedcd1)] pt-2 text-xs leading-5">
                    {contract.lines.map((line) => (
                      <li key={line.id} className="text-[var(--muted,#62685f)]">
                        <span className="font-bold text-[var(--ink,#101310)]">
                          {line.productModel ||
                            t("portal.expansion.contracts.allEquipment")}
                        </span>
                        {line.scope ? ` · ${line.scope}` : ""}
                        {line.visitsPerYear
                          ? ` · ${t("portal.expansion.contracts.visits", {
                              count: line.visitsPerYear,
                            })}`
                          : ""}
                        {line.responseMinutes
                          ? ` · ${t("portal.expansion.contracts.response", {
                              minutes: line.responseMinutes,
                            })}`
                          : ""}
                        {line.resolutionMinutes
                          ? ` · ${t("portal.expansion.contracts.resolution", {
                              minutes: line.resolutionMinutes,
                            })}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {result.ok && (
          <Pagination
            page={result.data.page}
            totalPages={result.data.totalPages}
            hrefFor={(page) =>
              `/kundeportal/avtaler${page > 1 ? `?side=${page}` : ""}`
            }
            labels={paginationLabels(t)}
            className="pt-3"
          />
        )}
      </section>
    </PortalShell>
  );
}
