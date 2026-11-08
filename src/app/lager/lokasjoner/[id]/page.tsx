import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateTimeLocalized } from "@/lib/dates";
import { formatQuantity } from "@/lib/inventory";
import { getInventoryLocation } from "@/server/inventory";
import { updateInventoryLocationAction } from "../../actions";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { Field, Input } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import Icon from "@/components/icons";

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("common");
  const { id } = await params;
  return { title: `${t("inventory.locations.detailTitle")} ${id}` };
}

export default async function InventoryLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("inventory");
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");
  const canManage = hasPermission(user, "equipment.manage");

  const { id } = await params;
  const resolved = await searchParams;
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const result = await getInventoryLocation(user, id);
  if (!result.ok) notFound();
  const { location, levels, movements } = result.data;
  const returnTo = `/lager/lokasjoner/${location.id}`;

  return (
    <PageShell>
      <PageHeader
        eyebrow={t(`inventory.locationType.${location.type.toLowerCase()}`)}
        title={location.name}
        icon={<Icon name="map" className="h-5 w-5" />}
        actions={
          <Link
            href="/lager"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("inventory.back")}
          </Link>
        }
      />

      {meldt && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("inventory.feedback.saved")}
        </p>
      )}
      <ErrorBanner message={feil ? t("inventory.feedback.error") : undefined} />

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">{t("inventory.stock.levels")}</h2>
        {levels.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="folder" className="h-6 w-6" />}
            title={t("inventory.stock.noLevels")}
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("inventory.stock.levels")}
            tabIndex={0}
          >
            <table className="office-table min-w-[34rem]">
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
                {levels.map((level) => (
                  <tr key={level.itemId}>
                    <td className="font-mono text-xs">{level.sku}</td>
                    <td>
                      <Link className="font-bold hover:underline" href={`/lager/varer/${level.itemId}`}>
                        {level.name}
                      </Link>
                      {level.low && (
                        <span className="ml-2 rounded-full border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] px-2 py-0.5 text-2xs font-bold text-[var(--warning-text,#7a4f0c)]">
                          {t("inventory.item.low")}
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{formatQuantity(level.quantity)}</td>
                    <td className="text-right tabular-nums">{formatQuantity(level.reserved)}</td>
                    <td className="text-right font-bold tabular-nums">{formatQuantity(level.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">
          {t("inventory.movements.title")}
        </h2>
        {movements.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="clock" className="h-6 w-6" />}
            title={t("inventory.movements.empty")}
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("inventory.movements.title")}
            tabIndex={0}
          >
            <table className="office-table min-w-[34rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.movements.at")}</th>
                  <th scope="col">{t("inventory.movements.type")}</th>
                  <th scope="col">{t("inventory.item.name")}</th>
                  <th scope="col" className="text-right">
                    {t("inventory.movements.quantity")}
                  </th>
                  <th scope="col">{t("inventory.movements.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="text-xs">{formatDateTimeLocalized(movement.createdAt, locale)}</td>
                    <td className="font-bold">{movement.type}</td>
                    <td>{movement.itemName}</td>
                    <td className="text-right tabular-nums">{formatQuantity(movement.quantity)}</td>
                    <td className="text-xs">{movement.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.locations.edit")}
          </h2>
          <form action={updateInventoryLocationAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={location.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field id="location-name" label={t("inventory.locations.name")} required>
              <Input id="location-name" name="name" defaultValue={location.name} required />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                name="isActive"
                value="true"
                defaultChecked={location.isActive}
                className="h-5 w-5 rounded border-line"
              />
              {t("inventory.locations.active")}
            </label>
            <button
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              type="submit"
            >
              {t("inventory.item.save")}
            </button>
          </form>
        </Card>
      )}
    </PageShell>
  );
}
