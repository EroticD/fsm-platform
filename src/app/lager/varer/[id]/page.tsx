import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateTimeLocalized } from "@/lib/dates";
import { formatQuantity } from "@/lib/inventory";
import { getInventoryItem } from "@/server/inventory";
import {
  adjustStockAction,
  consumeReservationAction,
  releaseReservationAction,
  reserveStockAction,
  updateInventoryItemAction,
} from "../../actions";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("common");
  const { id } = await params;
  return { title: `${t("inventory.item.title")} ${id}` };
}

export default async function InventoryItemPage({
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
  const canWork = hasPermission(user, "workorders.update") || canManage;

  const { id } = await params;
  const resolved = await searchParams;
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const result = await getInventoryItem(user, id);
  if (!result.ok) notFound();
  const { item, levels, movements, reservations } = result.data;
  const returnTo = `/lager/varer/${item.id}`;

  return (
    <PageShell>
      <PageHeader
        eyebrow={item.sku}
        title={item.name}
        subtitle={item.description || t("inventory.item.noDescription")}
        icon={<Icon name="folder" className="h-5 w-5" />}
        actions={
          <>
            <Link
              href="/lager"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("inventory.back")}
            </Link>
            <div className={`${brandInset} px-4 py-2 text-right`}>
              <p className="type-eyebrow text-muted">{t("inventory.item.minLevel")}</p>
              <p className="text-xl font-black tabular-nums">
                {formatQuantity(item.minLevel)} {item.unit}
              </p>
            </div>
          </>
        }
      />

      {meldt && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("inventory.feedback.saved")}
        </p>
      )}
      <ErrorBanner message={feil ? t("inventory.feedback.error") : undefined} />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">{t("inventory.stock.levels")}</h2>
          {levels.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<Icon name="map" className="h-6 w-6" />}
              title={t("inventory.stock.noLevels")}
            />
          ) : (
            <div
              className="mt-3 overflow-x-auto"
              role="region"
              aria-label={t("inventory.stock.levels")}
              tabIndex={0}
            >
              <table className="office-table">
                <thead>
                  <tr>
                    <th scope="col">{t("inventory.location")}</th>
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
                    <tr key={level.locationId}>
                      <td>
                        <Link className="font-bold hover:underline" href={`/lager/lokasjoner/${level.locationId}`}>
                          {level.locationName}
                        </Link>
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

        {canManage && (
          <Card as="section" className="p-4 sm:p-5">
            <h2 className="type-eyebrow text-ink">{t("inventory.adjust.title")}</h2>
            <p className="mt-1 text-xs text-muted">
              {t("inventory.adjust.description")}
            </p>
            <form action={adjustStockAction} className="mt-3 grid gap-2">
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="itemId" value={item.id} />
              <Field id="adjust-location" label={t("inventory.location")} required>
                <Select id="adjust-location" name="locationId" required>
                  <option value="">{t("inventory.chooseLocation")}</option>
                  {levels.map((level) => (
                    <option key={level.locationId} value={level.locationId}>
                      {level.locationName}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field id="adjust-type" label={t("inventory.movements.type")}>
                  <Select id="adjust-type" name="type" defaultValue="IN">
                    <option value="IN">{t("inventory.adjust.types.in")}</option>
                    <option value="OUT">{t("inventory.adjust.types.out")}</option>
                    <option value="ADJUST">{t("inventory.adjust.types.adjust")}</option>
                  </Select>
                </Field>
                <Field id="adjust-quantity" label={t("inventory.adjust.quantity")} required>
                  <Input
                    id="adjust-quantity"
                    name="quantity"
                    type="number"
                    step="0.001"
                    required
                  />
                </Field>
              </div>
              <Field id="adjust-reason" label={t("inventory.adjust.reason")}>
                <Input id="adjust-reason" name="reason" />
              </Field>
              <button
                className={buttonClassName({ variant: "primary" })}
                type="submit"
              >
                {t("inventory.adjust.button")}
              </button>
            </form>
          </Card>
        )}
      </div>

      {canWork && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">{t("inventory.reserve.title")}</h2>
          <p className="mt-1 text-xs text-muted">
            {t("inventory.reserve.description")}
          </p>
          <form action={reserveStockAction} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="itemId" value={item.id} />
            <Field id="reserve-location" label={t("inventory.location")} required>
              <Select id="reserve-location" name="locationId" required>
                <option value="">{t("inventory.chooseLocation")}</option>
                {levels.map((level) => (
                  <option key={level.locationId} value={level.locationId}>
                    {level.locationName} ({formatQuantity(level.available)})
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="reserve-quantity" label={t("inventory.reserve.quantity")} required>
              <Input
                id="reserve-quantity"
                name="quantity"
                type="number"
                step="0.001"
                min="0.001"
                required
              />
            </Field>
            <Field id="reserve-work-order" label={t("inventory.reserve.workOrderId")} required>
              <Input id="reserve-work-order" name="workOrderId" required />
            </Field>
            <Field id="reserve-note" label={t("inventory.reserve.note")}>
              <Input id="reserve-note" name="note" />
            </Field>
            <button
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              type="submit"
            >
              {t("inventory.reserve.button")}
            </button>
          </form>
        </Card>
      )}

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">
          {t("inventory.reservations.title")}
        </h2>
        {reservations.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="clipboard" className="h-6 w-6" />}
            title={t("inventory.reservations.empty")}
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("inventory.reservations.title")}
            tabIndex={0}
          >
            <table className="office-table min-w-[38rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.location")}</th>
                  <th scope="col" className="text-right">
                    {t("inventory.reserve.quantity")}
                  </th>
                  <th scope="col">{t("inventory.status")}</th>
                  <th scope="col">{t("inventory.workOrder")}</th>
                  <th scope="col">{t("inventory.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td>{reservation.locationName}</td>
                    <td className="text-right tabular-nums">{formatQuantity(reservation.quantity)}</td>
                    <td className="text-xs font-bold">{reservation.status}</td>
                    <td>
                      {reservation.workOrderId ? (
                        <Link className="underline underline-offset-2" href={`/lager/oppdrag/${reservation.workOrderId}`}>
                          {t("inventory.openWorkOrder")}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {reservation.status === "ACTIVE" && canWork && (
                        <div className="flex flex-wrap gap-2">
                          <form action={releaseReservationAction}>
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="reservationId" value={reservation.id} />
                            <input type="hidden" name="workOrderId" value={reservation.workOrderId ?? ""} />
                            <button
                              className={buttonClassName({ variant: "secondary", size: "sm" })}
                              type="submit"
                            >
                              {t("inventory.reservations.release")}
                            </button>
                          </form>
                          <form action={consumeReservationAction}>
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="reservationId" value={reservation.id} />
                            <input type="hidden" name="workOrderId" value={reservation.workOrderId ?? ""} />
                            <button
                              className={buttonClassName({ variant: "primary", size: "sm" })}
                              type="submit"
                            >
                              {t("inventory.reservations.consume")}
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
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
            <table className="office-table min-w-[36rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.movements.at")}</th>
                  <th scope="col">{t("inventory.movements.type")}</th>
                  <th scope="col" className="text-right">
                    {t("inventory.movements.quantity")}
                  </th>
                  <th scope="col">{t("inventory.location")}</th>
                  <th scope="col">{t("inventory.movements.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="text-xs">{formatDateTimeLocalized(movement.createdAt, locale)}</td>
                    <td className="font-bold">{movement.type}</td>
                    <td className="text-right tabular-nums">{formatQuantity(movement.quantity)}</td>
                    <td>{movement.locationName}</td>
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
          <h2 className="type-eyebrow text-ink">{t("inventory.item.edit")}</h2>
          <form action={updateInventoryItemAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field id="item-sku" label={t("inventory.item.sku")} required>
              <Input id="item-sku" name="sku" defaultValue={item.sku} required />
            </Field>
            <Field id="item-name" label={t("inventory.item.name")} required>
              <Input id="item-name" name="name" defaultValue={item.name} required />
            </Field>
            <Field id="item-unit" label={t("inventory.item.unit")} required>
              <Input id="item-unit" name="unit" defaultValue={item.unit} required />
            </Field>
            <Field id="item-min-level" label={t("inventory.item.minLevel")}>
              <Input
                id="item-min-level"
                name="minLevel"
                type="number"
                step="0.001"
                min="0"
                defaultValue={item.minLevel}
              />
            </Field>
            <Field
              id="item-description"
              label={t("inventory.item.description")}
              className="sm:col-span-2"
            >
              <Input id="item-description" name="description" defaultValue={item.description ?? ""} />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                name="active"
                value="true"
                defaultChecked={item.active}
                className="h-5 w-5 rounded border-line"
              />
              {t("inventory.item.active")}
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
