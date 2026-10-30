import { getTranslations, getLocale } from "next-intl/server";
import { formatDateLocalized } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import { getPortalEquipment } from "@/server/portal-expansion";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;

  if (!context.access.capabilities.canViewEquipment) {
    return (
      <PortalShell
        active="utstyr"
        customer={context.customer}
        userName={context.user.name ?? context.user.email ?? ""}
      >
        <section className={brandCard}>
          <h2 className="text-lg font-extrabold">
            {t("portal.expansion.equipment.title")}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.equipment.forbidden")}
          </p>
        </section>
      </PortalShell>
    );
  }

  const result = await getPortalEquipment(context.user, {
    page: parsePage(params.side),
  });

  return (
    <PortalShell
      active="utstyr"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t("portal.expansion.equipment.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("portal.expansion.equipment.intro")}
        </p>

        {!result.ok ? (
          <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.equipment.forbidden")}
          </p>
        ) : result.data.items.length === 0 ? (
          <p className="mt-4 text-sm italic text-[var(--muted,#62685f)]">
            {t("portal.expansion.equipment.empty")}
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {result.data.items.map((item) => (
              <li key={item.id} className={`${brandInset} min-w-0 p-3`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold">{item.model}</p>
                    <p className="text-xs text-[var(--muted,#62685f)]">
                      {item.serialNumber
                        ? t("portal.expansion.equipment.serial", {
                            serial: item.serialNumber,
                          })
                        : t("portal.expansion.equipment.noSerial")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold">
                    {t(`portal.expansion.equipment.statuses.${item.status}`)}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-xs leading-5 text-[var(--muted,#62685f)]">
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-bold">
                      {t("portal.expansion.equipment.siteLabel")}:
                    </dt>
                    <dd>
                      {item.siteName ||
                        item.location ||
                        t("portal.expansion.equipment.noSite")}
                    </dd>
                  </div>
                  {item.categoryName && (
                    <div className="flex flex-wrap gap-x-1.5">
                      <dt className="font-bold">
                        {t("portal.expansion.equipment.categoryLabel")}:
                      </dt>
                      <dd>{item.categoryName}</dd>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-1.5">
                    <dt className="font-bold">
                      {t("portal.expansion.equipment.warrantyLabel")}:
                    </dt>
                    <dd>
                      {item.warrantyUntil
                        ? formatDateLocalized(item.warrantyUntil, locale)
                        : t("portal.expansion.equipment.noWarranty")}
                    </dd>
                  </div>
                  {item.lastReading && (
                    <div className="flex flex-wrap gap-x-1.5">
                      <dt className="font-bold">
                        {t("portal.expansion.equipment.lastReadingLabel")}:
                      </dt>
                      <dd>
                        {t("portal.expansion.equipment.lastReading", {
                          value: item.lastReading.value,
                          unit: item.meterUnit ?? "",
                          date: formatDateLocalized(
                            item.lastReading.readAt,
                            locale,
                          ),
                        })}
                      </dd>
                    </div>
                  )}
                  {item.activePlanCount > 0 && (
                    <div className="flex flex-wrap gap-x-1.5">
                      <dt className="font-bold">
                        {t("portal.expansion.equipment.plansLabel")}:
                      </dt>
                      <dd>
                        {t("portal.expansion.equipment.planCount", {
                          count: item.activePlanCount,
                        })}
                      </dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}

        {result.ok && (
          <Pagination
            page={result.data.page}
            totalPages={result.data.totalPages}
            hrefFor={(page) =>
              `/kundeportal/utstyr${page > 1 ? `?side=${page}` : ""}`
            }
            labels={paginationLabels(t)}
            className="pt-3"
          />
        )}
      </section>
    </PortalShell>
  );
}
