import Link from "next/link";
import Icon from "@/components/icons";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateLocalized } from "@/lib/dates";
import UnitHistory from "@/components/UnitHistory";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";
import {
  CUSTOMER_CONTROL,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_INSET,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_RISK_BUTTON,
  CUSTOMER_SIGNAL_BUTTON,
  LEGACY_SURFACE,
} from "./customerStyles";

type Product = CustomerDetailData["products"][number];
type ReportUnit = Product["reportUnits"][number];

/** Datoen for den nyeste servicen på en enhet (eller null hvis den aldri er kontrollert). */
function lastServiceDate(entries: ReportUnit[]) {
  const times = entries
    .map((entry) => entry.report.workOrder.scheduledFor ?? entry.report.createdAt)
    .filter((value): value is Date => Boolean(value))
    .map((value) => new Date(value).getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

type UnitsTabProps = {
  customerId: string;
  products: CustomerDetailData["products"];
  unitQuery: string;
  unitTotal: number;
  canManageEquipment: boolean;
  canViewReports: boolean;
  isAdmin: boolean;
  createUnit: (formData: FormData) => Promise<void>;
  updateUnit: (formData: FormData) => Promise<void>;
  deleteUnit: (formData: FormData) => Promise<void>;
};

export default async function CustomerUnitsTab({
  customerId,
  products,
  unitQuery,
  unitTotal,
  canManageEquipment,
  canViewReports,
  isAdmin,
  createUnit,
  updateUnit,
  deleteUnit,
}: UnitsTabProps) {
  const t = await getTranslations("common");
  const locale = await getLocale();

  return (
    <CustomerTabPanel
      title={
        <>
          <Icon name="wrench" className="h-4 w-4 shrink-0" />
          {t("customers.units.title")}
        </>
      }
      description={t("customers.units.description")}
    >
      <Link
        href={`/enheter?kunde=${customerId}`}
        className={`${CUSTOMER_INK_BUTTON} self-start`}
      >
        <Icon name="wrench" className="h-4 w-4 shrink-0" />
        {t("assets.list.openModule")}
        <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
      </Link>
      {/* Filtrering skjer på serveren, slik at en kunde med mange enheter
          fortsatt får en kort og rask side. */}
      <form method="GET" action="" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tab" value="utstyr" />
        <div className="relative min-w-[12rem] flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted,#62685f)]"
          />
          <input
            type="search"
            name="enhet"
            defaultValue={unitQuery}
            aria-label={t("customers.units.searchLabel")}
            placeholder={t("customers.units.searchPlaceholder")}
            className={`${CUSTOMER_CONTROL} pl-9 text-sm`}
          />
        </div>
        <button type="submit" className={CUSTOMER_INK_BUTTON}>
          {t("customers.units.search")}
        </button>
        {unitQuery && (
          <Link href="?tab=utstyr" className={CUSTOMER_INK_BUTTON}>
            {t("customers.units.resetSearch")}
          </Link>
        )}
        <span className={`text-xs font-bold ${CUSTOMER_MUTED}`}>
          {t("customers.units.showing", {
            shown: products.length,
            total: unitTotal,
          })}
        </span>
      </form>

      {/* Skjema for ny enhet – krever equipment.manage */}
      {canManageEquipment && (
        <form
          action={createUnit}
          className={`${CUSTOMER_INSET} space-y-3 p-3 sm:p-4`}
        >
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="new-unit-model" className={CUSTOMER_LABEL}>
                {t("customers.units.model")} *
              </label>
              <input
                id="new-unit-model"
                type="text"
                name="model"
                required
                placeholder={t("customers.units.modelPlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="new-unit-serial" className={CUSTOMER_LABEL}>
                {t("customers.units.serialNumber")}
              </label>
              <input
                id="new-unit-serial"
                type="text"
                name="serialNumber"
                placeholder={t("customers.units.serialPlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="new-unit-location" className={CUSTOMER_LABEL}>
                {t("customers.units.location")}
              </label>
              <input
                id="new-unit-location"
                type="text"
                name="location"
                placeholder={t("customers.units.locationPlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>
          <button type="submit" className={`${CUSTOMER_SIGNAL_BUTTON} w-full`}>
            {t("customers.units.add")}
          </button>
        </form>
      )}

      {products.length === 0 ? (
        <p className={`text-xs italic ${CUSTOMER_MUTED}`}>
          {unitQuery
            ? t("customers.units.noMatches", { query: unitQuery })
            : t("customers.units.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {products.map((unit) => (
            <article
              key={unit.id}
              id={`unit-${unit.id}`}
              className={`${CUSTOMER_INSET} scroll-mt-24 p-3`}
            >
              <div className="flex items-start justify-between gap-3">
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <span className="text-sm font-bold text-[var(--ink,#101310)]">
                      {unit.model}
                    </span>
                    <span className={`mt-0.5 block text-xs ${CUSTOMER_MUTED}`}>
                      {unit.serialNumber
                        ? t("customers.units.serial", {
                            serial: unit.serialNumber,
                          })
                        : t("customers.units.withoutSerial")}
                      {unit.location ? ` • ${unit.location}` : ""}
                    </span>
                    {canViewReports && (
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        {unit._count.reportUnits === 0 ? (
                          <span
                            className={`inline-flex items-center gap-1 ${CUSTOMER_MUTED}`}
                          >
                            <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                            {t("customers.units.neverChecked")}
                          </span>
                        ) : (
                          <span className="inline-flex flex-wrap items-center gap-1 font-bold text-[var(--ink,#101310)]">
                            <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                            {t("customers.units.serviceCount", {
                              count: unit._count.reportUnits,
                            })}
                            <span aria-hidden>•</span>
                            {t("customers.units.lastService", {
                              date: formatDateLocalized(
                                lastServiceDate(unit.reportUnits),
                                locale,
                                undefined,
                                t("customers.units.noDate"),
                              ),
                            })}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${CUSTOMER_MUTED}`}
                        >
                          <Icon
                            name="chevronDown"
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          {t("customers.units.showHistory")}
                        </span>
                      </span>
                    )}
                  </summary>

                  {canViewReports && (
                    <div className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3">
                      <p
                        className={`mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] ${CUSTOMER_MUTED}`}
                      >
                        <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                        {t("customers.units.serviceHistory", {
                          count: unit._count.reportUnits,
                        })}
                      </p>
                      {unit._count.reportUnits > unit.reportUnits.length && (
                        <p className={`mb-2 text-xs ${CUSTOMER_MUTED}`}>
                          {t("customers.units.showingRecent", {
                            shown: unit.reportUnits.length,
                            total: unit._count.reportUnits,
                          })}
                        </p>
                      )}
                      <div className={LEGACY_SURFACE}>
                        <UnitHistory entries={unit.reportUnits} />
                      </div>
                    </div>
                  )}

                  {canManageEquipment && (
                    <details className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3">
                      <summary
                        className={`flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] [&::-webkit-details-marker]:hidden ${CUSTOMER_MUTED}`}
                      >
                        <Icon name="edit" className="h-3.5 w-3.5 shrink-0" />
                        {t("customers.units.editUnit")}
                      </summary>

                      <form
                        action={updateUnit}
                        className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
                      >
                        <input
                          type="hidden"
                          name="customerId"
                          value={customerId}
                        />
                        <input type="hidden" name="id" value={unit.id} />
                        <div>
                          <label
                            htmlFor={`unit-${unit.id}-model`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.units.model")} *
                          </label>
                          <input
                            id={`unit-${unit.id}-model`}
                            type="text"
                            name="model"
                            required
                            defaultValue={unit.model}
                            className={`${CUSTOMER_CONTROL} text-sm`}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`unit-${unit.id}-serial`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.units.serialNumber")}
                          </label>
                          <input
                            id={`unit-${unit.id}-serial`}
                            type="text"
                            name="serialNumber"
                            defaultValue={unit.serialNumber || ""}
                            className={`${CUSTOMER_CONTROL} text-sm`}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`unit-${unit.id}-location`}
                            className={CUSTOMER_LABEL}
                          >
                            {t("customers.units.location")}
                          </label>
                          <input
                            id={`unit-${unit.id}-location`}
                            type="text"
                            name="location"
                            defaultValue={unit.location || ""}
                            className={`${CUSTOMER_CONTROL} text-sm`}
                          />
                        </div>
                        <div className="flex justify-end sm:col-span-3">
                          <button
                            type="submit"
                            className={CUSTOMER_SIGNAL_BUTTON}
                          >
                            {t("customers.units.save")}
                          </button>
                        </div>
                      </form>
                    </details>
                  )}
                </details>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Link
                    href={`/enheter/${unit.id}`}
                    className={CUSTOMER_INK_BUTTON}
                  >
                    {t("customers.units.openUnit")}
                    <Icon name="arrowRight" className="h-3.5 w-3.5 shrink-0" />
                  </Link>

                  {isAdmin && (
                    <ConfirmSubmitForm
                      action={deleteUnit}
                      confirmMessage={t("customers.units.deleteConfirm", {
                        model: unit.model,
                      })}
                      confirmLabel={t("delete")}
                      danger
                      className="inline-flex"
                    >
                      <input
                        type="hidden"
                        name="customerId"
                        value={customerId}
                      />
                      <input type="hidden" name="id" value={unit.id} />
                      <button
                        type="submit"
                        aria-label={`${t("customers.units.delete")}: ${unit.model}`}
                        title={t("customers.units.delete")}
                        className={`${CUSTOMER_RISK_BUTTON} min-w-11 px-2`}
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </ConfirmSubmitForm>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </CustomerTabPanel>
  );
}
