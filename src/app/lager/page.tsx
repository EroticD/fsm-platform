import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatQuantity } from "@/lib/inventory";
import { listInventory } from "@/server/inventory";
import {
  createInventoryItemAction,
  createInventoryLocationAction,
} from "./actions";
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
  return { title: t("inventory.title") };
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("inventory");
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");

  const resolved = await searchParams;
  const query = param(resolved.q);
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const canManage = hasPermission(user, "equipment.manage");
  const result = await listInventory(user, { q: query });
  if (!result.ok) redirect("/");

  const { items, locations, suggestions } = result.data;

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("inventory.eyebrow")}
        title={t("inventory.title")}
        subtitle={t("inventory.description")}
        icon={<Icon name="folder" className="h-5 w-5" />}
        actions={
          <>
            <form className="flex gap-2" action="/lager">
              <Input
                name="q"
                defaultValue={query}
                placeholder={t("inventory.searchPlaceholder")}
                aria-label={t("inventory.searchPlaceholder")}
                className="min-w-40"
              />
              <button
                className={buttonClassName({ variant: "secondary", size: "sm" })}
                type="submit"
              >
                {t("inventory.search")}
              </button>
            </form>
            <Link
              className={buttonClassName({ variant: "secondary", size: "sm" })}
              href="/lager/innkjop"
            >
              {t("inventory.purchasing.link")}
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

      <Card as="section" className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.suggestions.title")}
          </h2>
          <span className="rounded-full border border-line px-2.5 py-1 text-xs font-bold">
            {suggestions.length}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {t("inventory.suggestions.description")}
        </p>
        {suggestions.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="alert" className="h-6 w-6" />}
            title={t("inventory.suggestions.empty")}
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("inventory.suggestions.title")}
            tabIndex={0}
          >
            <table className="office-table min-w-[32rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.item.sku")}</th>
                  <th scope="col">{t("inventory.item.name")}</th>
                  <th scope="col" className="text-right">
                    {t("inventory.item.available")}
                  </th>
                  <th scope="col" className="text-right">
                    {t("inventory.item.minLevel")}
                  </th>
                  <th scope="col" className="text-right">
                    {t("inventory.suggestions.buy")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((item) => (
                  <tr key={item.id}>
                    <td className="font-mono text-xs">{item.sku}</td>
                    <td>
                      <Link className="font-bold hover:underline" href={`/lager/varer/${item.id}`}>
                        {item.name}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">
                      {formatQuantity(item.available)} {item.unit}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatQuantity(item.minLevel)}
                    </td>
                    <td className="text-right font-bold tabular-nums text-[var(--warning-text,#7a4f0c)]">
                      {formatQuantity(item.suggestedQuantity)} {item.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card as="section" className="min-w-0 p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">{t("inventory.items.title")}</h2>
          {items.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<Icon name="folder" className="h-6 w-6" />}
              title={t("inventory.items.empty")}
            />
          ) : (
            <div
              className="mt-3 overflow-x-auto"
              role="region"
              aria-label={t("inventory.items.title")}
              tabIndex={0}
            >
              <table className="office-table min-w-[36rem]">
                <thead>
                  <tr>
                    <th scope="col">{t("inventory.item.sku")}</th>
                    <th scope="col">{t("inventory.item.name")}</th>
                    <th scope="col" className="text-right">
                      {t("inventory.item.onHand")}
                    </th>
                    <th scope="col" className="text-right">
                      {t("inventory.item.reserved")}
                    </th>
                    <th scope="col" className="text-right">
                      {t("inventory.item.available")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-mono text-xs">{item.sku}</td>
                      <td>
                        <Link className="font-bold hover:underline" href={`/lager/varer/${item.id}`}>
                          {item.name}
                        </Link>
                        {item.low && (
                          <span className="ml-2 rounded-full border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] px-2 py-0.5 text-2xs font-bold text-[var(--warning-text,#7a4f0c)]">
                            {t("inventory.item.low")}
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{formatQuantity(item.onHand)}</td>
                      <td className="text-right tabular-nums">{formatQuantity(item.reserved)}</td>
                      <td className="text-right font-bold tabular-nums">{formatQuantity(item.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManage && (
            <form
              action={createInventoryItemAction}
              className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
            >
              <h3 className="type-eyebrow text-ink sm:col-span-2">
                {t("inventory.items.create")}
              </h3>
              <input type="hidden" name="returnTo" value="/lager" />
              <Field id="inventory-sku" label={t("inventory.item.sku")} required>
                <Input id="inventory-sku" name="sku" required />
              </Field>
              <Field id="inventory-name" label={t("inventory.item.name")} required>
                <Input id="inventory-name" name="name" required />
              </Field>
              <Field id="inventory-unit" label={t("inventory.item.unit")}>
                <Input id="inventory-unit" name="unit" defaultValue="stk" />
              </Field>
              <Field id="inventory-min-level" label={t("inventory.item.minLevel")}>
                <Input
                  id="inventory-min-level"
                  name="minLevel"
                  type="number"
                  step="0.001"
                  min="0"
                />
              </Field>
              <Field
                id="inventory-description"
                label={t("inventory.item.description")}
                className="sm:col-span-2"
              >
                <Input id="inventory-description" name="description" />
              </Field>
              <button
                className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
                type="submit"
              >
                {t("inventory.items.createButton")}
              </button>
            </form>
          )}
        </Card>

        <Card as="section" className="min-w-0 p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.locations.title")}
          </h2>
          {locations.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<Icon name="map" className="h-6 w-6" />}
              title={t("inventory.locations.empty")}
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {locations.map((location) => (
                <li key={location.id}>
                  <Link
                    className={`${brandInset} flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm transition hover:bg-[var(--surface,#fffdf8)]`}
                    href={`/lager/lokasjoner/${location.id}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{location.name}</span>
                      <span className="text-xs text-muted">
                        {t(`inventory.locationType.${location.type.toLowerCase()}`)}
                        {" · "}
                        {t("inventory.locations.itemCount", { count: location.itemCount })}
                      </span>
                    </span>
                    {location.lowCount > 0 && (
                      <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] px-2 py-0.5 text-2xs font-bold text-[var(--warning-text,#7a4f0c)]">
                        {t("inventory.locations.lowCount", { count: location.lowCount })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <form
              action={createInventoryLocationAction}
              className="mt-5 grid gap-3 border-t border-line pt-4"
            >
              <h3 className="type-eyebrow text-ink">
                {t("inventory.locations.create")}
              </h3>
              <input type="hidden" name="returnTo" value="/lager" />
              <Field id="location-name" label={t("inventory.locations.name")} required>
                <Input id="location-name" name="name" required />
              </Field>
              <Field id="location-type" label={t("inventory.locations.detailTitle")}>
                <Select id="location-type" name="type" defaultValue="WAREHOUSE">
                  <option value="WAREHOUSE">{t("inventory.locationType.warehouse")}</option>
                  <option value="VAN">{t("inventory.locationType.van")}</option>
                </Select>
              </Field>
              <button
                className={buttonClassName({ variant: "primary" })}
                type="submit"
              >
                {t("inventory.locations.createButton")}
              </button>
            </form>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
