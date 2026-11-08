import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { formatQuantity } from "@/lib/inventory";
import { PURCHASE_ORDER_STATUSES } from "@/lib/purchasing";
import { listInventory } from "@/server/inventory";
import { listPurchaseOrders, listSuppliers } from "@/server/purchasing";
import { createFromSuggestionsAction } from "./actions";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center px-4 text-sm";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("inventory.purchasing.title") };
}

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("inventory");
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");

  const resolved = await searchParams;
  const status = param(resolved.status);
  const query = param(resolved.q);
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const canManage = hasPermission(user, "equipment.manage");

  const [ordersResult, suppliersResult, inventoryResult] = await Promise.all([
    listPurchaseOrders(user, { status, q: query }),
    listSuppliers(user),
    listInventory(user),
  ]);
  if (!ordersResult.ok || !suppliersResult.ok || !inventoryResult.ok) {
    redirect("/");
  }

  const { orders } = ordersResult.data;
  const { suppliers } = suppliersResult.data;
  const { suggestions, locations } = inventoryResult.data;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href="/lager" className="text-xs font-bold underline underline-offset-4">
              {t("inventory.back")}
            </Link>
            <Link
              href="/lager/innkjop/leverandorer"
              className={INK_BUTTON}
            >
              {t("inventory.purchasing.suppliersLink")}
            </Link>
          </div>
          <p className={`${LABEL} mt-3`}>{t("inventory.purchasing.eyebrow")}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
            {t("inventory.purchasing.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
            {t("inventory.purchasing.description")}
          </p>
        </header>

        {meldt && (
          <div className="rounded-lg border border-[#a9c96a] bg-[#eef7d6] px-4 py-3 text-sm font-bold text-[#283509]">
            {t("inventory.feedback.saved")}
          </div>
        )}
        {feil && (
          <div className="rounded-lg border border-[#e7b5ae] bg-[#fbe9e7] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t("inventory.feedback.error")}
          </div>
        )}

        {canManage && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.purchasing.create.title")}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
              {t("inventory.purchasing.create.description")}
            </p>
            {suppliers.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
                {t("inventory.purchasing.create.noSuppliers")}{" "}
                <Link
                  href="/lager/innkjop/leverandorer"
                  className="font-bold underline underline-offset-4"
                >
                  {t("inventory.purchasing.suppliers.create")}
                </Link>
              </p>
            ) : suggestions.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
                {t("inventory.suggestions.empty")}
              </p>
            ) : (
              <form action={createFromSuggestionsAction} className="mt-4 grid gap-3">
                <input type="hidden" name="returnTo" value="/lager/innkjop" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-bold">
                    {t("inventory.purchasing.create.supplier")}
                    <select className={CONTROL} name="supplierId" required>
                      <option value="">{t("inventory.purchasing.create.chooseSupplier")}</option>
                      {suppliers
                        .filter((supplier) => supplier.active)
                        .map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-bold">
                    {t("inventory.purchasing.create.location")}
                    <select className={CONTROL} name="locationId" required>
                      <option value="">{t("inventory.chooseLocation")}</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-bold">
                    {t("inventory.purchasing.create.expectedAt")}
                    <input className={CONTROL} name="expectedAt" type="date" />
                  </label>
                  <label className="grid gap-1 text-xs font-bold">
                    {t("inventory.purchasing.create.notes")}
                    <input className={CONTROL} name="notes" />
                  </label>
                </div>
                <fieldset className="rounded-[10px] border border-[var(--line,#dedcd1)] p-3">
                  <legend className={`${LABEL} px-1`}>
                    {t("inventory.purchasing.create.selectItems")}
                  </legend>
                  <div className="mt-2 space-y-2">
                    {suggestions.map((item) => (
                      <label
                        key={item.id}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm hover:bg-[var(--paper,#f2efe6)]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" name="itemId" value={item.id} defaultChecked />
                          <span className="min-w-0">
                            <span className="block truncate font-bold">{item.name}</span>
                            <span className="font-mono text-xs text-[var(--muted,#62685f)]">
                              {item.sku}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-xs font-bold tabular-nums">
                          {formatQuantity(item.suggestedQuantity)} {item.unit}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button className={SIGNAL_BUTTON} type="submit">
                  {t("inventory.purchasing.create.createButton")}
                </button>
              </form>
            )}
          </section>
        )}

        <section data-purchase-orders className={CARD}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.purchasing.ordersTitle")}
            </h2>
            <form className="flex flex-wrap gap-2" action="/lager/innkjop">
              <input
                className={CONTROL}
                name="q"
                defaultValue={query}
                placeholder={t("inventory.searchPlaceholder")}
                aria-label={t("inventory.searchPlaceholder")}
              />
              <select
                className={CONTROL}
                name="status"
                defaultValue={status}
                aria-label={t("inventory.purchasing.filter.status")}
              >
                <option value="">{t("inventory.purchasing.filter.all")}</option>
                {PURCHASE_ORDER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`inventory.purchasing.status.${value.toLowerCase()}`)}
                  </option>
                ))}
              </select>
              <button className={INK_BUTTON} type="submit">
                {t("inventory.purchasing.filter.apply")}
              </button>
            </form>
          </div>

          {orders.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
              {t("inventory.purchasing.empty")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.purchasing.table.number")}</th>
                    <th className="px-2 py-2">{t("inventory.purchasing.table.supplier")}</th>
                    <th className="px-2 py-2">{t("inventory.purchasing.table.location")}</th>
                    <th className="px-2 py-2">{t("inventory.purchasing.table.status")}</th>
                    <th className="px-2 py-2">{t("inventory.purchasing.table.expectedAt")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.purchasing.table.lines")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.purchasing.table.orderedTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 font-mono text-xs font-bold">
                        <Link
                          className="underline underline-offset-4"
                          href={`/lager/innkjop/${order.id}`}
                        >
                          {order.number}
                        </Link>
                      </td>
                      <td className="px-2 py-2">{order.supplierName}</td>
                      <td className="px-2 py-2">{order.locationName}</td>
                      <td className="px-2 py-2 text-xs font-bold">
                        {t(`inventory.purchasing.status.${order.status.toLowerCase()}`)}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {formatDateLocalized(order.expectedAt, locale, undefined, "—")}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{order.lineCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatAmount(order.orderedTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.purchasing.suppliers.title")}
            </h2>
            <Link href="/lager/innkjop/leverandorer" className={INK_BUTTON}>
              {t("inventory.purchasing.suppliers.create")}
            </Link>
          </div>
          {suppliers.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">
              {t("inventory.purchasing.suppliers.empty")}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {suppliers.map((supplier) => (
                <li
                  key={supplier.id}
                  className="rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-sm"
                >
                  <span className="block font-bold">{supplier.name}</span>
                  <span className="text-xs text-[var(--muted,#62685f)]">
                    {supplier.orgNumber || supplier.email || "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
