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
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import { brandInset } from "@/components/ui/brandStyles";
import Icon from "@/components/icons";

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
    <PageShell>
      <PageHeader
        eyebrow={t("inventory.purchasing.eyebrow")}
        title={t("inventory.purchasing.title")}
        subtitle={t("inventory.purchasing.description")}
        icon={<Icon name="file" className="h-5 w-5" />}
        actions={
          <>
            <Link
              href="/lager"
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("inventory.back")}
            </Link>
            <Link
              href="/lager/innkjop/leverandorer"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {t("inventory.purchasing.suppliersLink")}
            </Link>
          </>
        }
      />

      {meldt && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("inventory.feedback.saved")}
        </p>
      )}
      <ErrorBanner message={feil ? t("inventory.feedback.error") : undefined} />

      {canManage && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.purchasing.create.title")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {t("inventory.purchasing.create.description")}
          </p>
          {suppliers.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<Icon name="building" className="h-6 w-6" />}
              title={t("inventory.purchasing.create.noSuppliers")}
              action={
                <Link
                  href="/lager/innkjop/leverandorer"
                  className={buttonClassName({ variant: "primary", size: "sm" })}
                >
                  {t("inventory.purchasing.suppliers.create")}
                </Link>
              }
            />
          ) : suggestions.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<Icon name="alert" className="h-6 w-6" />}
              title={t("inventory.suggestions.empty")}
            />
          ) : (
            <form action={createFromSuggestionsAction} className="mt-4 grid gap-3">
              <input type="hidden" name="returnTo" value="/lager/innkjop" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id="purchase-supplier"
                  label={t("inventory.purchasing.create.supplier")}
                  required
                >
                  <Select id="purchase-supplier" name="supplierId" required>
                    <option value="">{t("inventory.purchasing.create.chooseSupplier")}</option>
                    {suppliers
                      .filter((supplier) => supplier.active)
                      .map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field
                  id="purchase-location"
                  label={t("inventory.purchasing.create.location")}
                  required
                >
                  <Select id="purchase-location" name="locationId" required>
                    <option value="">{t("inventory.chooseLocation")}</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  id="purchase-expected"
                  label={t("inventory.purchasing.create.expectedAt")}
                >
                  <Input id="purchase-expected" name="expectedAt" type="date" />
                </Field>
                <Field
                  id="purchase-notes"
                  label={t("inventory.purchasing.create.notes")}
                >
                  <Input id="purchase-notes" name="notes" />
                </Field>
              </div>
              <fieldset className="rounded-xl border border-line p-3">
                <legend className="type-eyebrow px-1 text-ink">
                  {t("inventory.purchasing.create.selectItems")}
                </legend>
                <div className="mt-2 space-y-2">
                  {suggestions.map((item) => (
                    <label
                      key={item.id}
                      className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm transition hover:bg-paper"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input type="checkbox" name="itemId" value={item.id} defaultChecked />
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{item.name}</span>
                          <span className="font-mono text-xs text-muted">
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
              <button
                className={buttonClassName({ variant: "primary" })}
                type="submit"
              >
                {t("inventory.purchasing.create.createButton")}
              </button>
            </form>
          )}
        </Card>
      )}

      <Card as="section" data-purchase-orders className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.purchasing.ordersTitle")}
          </h2>
          <form className="flex flex-wrap items-end gap-2" action="/lager/innkjop">
            <Input
              name="q"
              defaultValue={query}
              placeholder={t("inventory.searchPlaceholder")}
              aria-label={t("inventory.searchPlaceholder")}
              className="w-auto min-w-40"
            />
            <Select
              name="status"
              defaultValue={status}
              aria-label={t("inventory.purchasing.filter.status")}
              className="w-auto"
            >
              <option value="">{t("inventory.purchasing.filter.all")}</option>
              {PURCHASE_ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`inventory.purchasing.status.${value.toLowerCase()}`)}
                </option>
              ))}
            </Select>
            <button
              className={buttonClassName({ variant: "secondary", size: "sm" })}
              type="submit"
            >
              {t("inventory.purchasing.filter.apply")}
            </button>
          </form>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="file" className="h-6 w-6" />}
            title={t("inventory.purchasing.empty")}
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("inventory.purchasing.ordersTitle")}
            tabIndex={0}
          >
            <table className="office-table min-w-[44rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.purchasing.table.number")}</th>
                  <th scope="col">{t("inventory.purchasing.table.supplier")}</th>
                  <th scope="col">{t("inventory.purchasing.table.location")}</th>
                  <th scope="col">{t("inventory.purchasing.table.status")}</th>
                  <th scope="col">{t("inventory.purchasing.table.expectedAt")}</th>
                  <th scope="col" className="text-right">
                    {t("inventory.purchasing.table.lines")}
                  </th>
                  <th scope="col" className="text-right">
                    {t("inventory.purchasing.table.orderedTotal")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="font-mono text-xs font-bold">
                      <Link
                        className="underline underline-offset-4"
                        href={`/lager/innkjop/${order.id}`}
                      >
                        {order.number}
                      </Link>
                    </td>
                    <td>{order.supplierName}</td>
                    <td>{order.locationName}</td>
                    <td className="text-xs font-bold">
                      {t(`inventory.purchasing.status.${order.status.toLowerCase()}`)}
                    </td>
                    <td className="text-xs">
                      {formatDateLocalized(order.expectedAt, locale, undefined, "—")}
                    </td>
                    <td className="text-right tabular-nums">{order.lineCount}</td>
                    <td className="text-right tabular-nums">
                      {formatAmount(order.orderedTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card as="section" className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.purchasing.suppliers.title")}
          </h2>
          <Link
            href="/lager/innkjop/leverandorer"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            {t("inventory.purchasing.suppliers.create")}
          </Link>
        </div>
        {suppliers.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {t("inventory.purchasing.suppliers.empty")}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className={`${brandInset} px-3 py-2 text-sm`}>
                <span className="block font-bold">{supplier.name}</span>
                <span className="text-xs text-muted">
                  {supplier.orgNumber || supplier.email || "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}
