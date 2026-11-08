import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateTimeLocalized } from "@/lib/dates";
import { formatQuantity } from "@/lib/inventory";
import { listWorkOrderParts } from "@/server/inventory";
import {
  consumeReservationAction,
  consumeVisitReservationsAction,
  releaseReservationAction,
  reserveStockAction,
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
  return { title: `${t("inventory.workOrderParts.title")} ${id}` };
}

export default async function WorkOrderPartsPage({
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
  const canWork =
    hasPermission(user, "workorders.update") ||
    hasPermission(user, "equipment.manage");

  const { id } = await params;
  const resolved = await searchParams;
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const result = await listWorkOrderParts(user, id);
  if (!result.ok) notFound();
  const { workOrder, reservations, locations, items, visits } = result.data;
  const returnTo = `/lager/oppdrag/${workOrder.id}`;

  return (
    <PageShell>
      <PageHeader
        eyebrow={workOrder.reference}
        title={t("inventory.workOrderParts.title")}
        subtitle={workOrder.title}
        icon={<Icon name="clipboard" className="h-5 w-5" />}
        actions={
          <Link
            href={`/oppdrag/${workOrder.id}`}
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("inventory.workOrderParts.backToWorkOrder")}
          </Link>
        }
      />

      {meldt && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("inventory.feedback.saved")}
        </p>
      )}
      <ErrorBanner message={feil ? t("inventory.feedback.error") : undefined} />

      {canWork && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">{t("inventory.reserve.title")}</h2>
          <form action={reserveStockAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="workOrderId" value={workOrder.id} />
            <Field id="parts-item" label={t("inventory.item.name")} required>
              <Select id="parts-item" name="itemId" required>
                <option value="">{t("inventory.reserve.chooseItem")}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="parts-location" label={t("inventory.location")} required>
              <Select id="parts-location" name="locationId" required>
                <option value="">{t("inventory.chooseLocation")}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="parts-quantity" label={t("inventory.reserve.quantity")} required>
              <Input
                id="parts-quantity"
                name="quantity"
                type="number"
                step="0.001"
                min="0.001"
                required
              />
            </Field>
            <Field id="parts-visit" label={t("inventory.workOrder")}>
              <Select id="parts-visit" name="visitId" defaultValue="">
                <option value="">{t("inventory.reserve.noVisit")}</option>
                {visits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {`#${visit.sequence + 1} · ${formatDateTimeLocalized(visit.startsAt, locale)} · ${visit.status}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="parts-note"
              label={t("inventory.reserve.note")}
              className="sm:col-span-2"
            >
              <Input id="parts-note" name="note" />
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
            <table className="office-table min-w-[40rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.item.name")}</th>
                  <th scope="col">{t("inventory.location")}</th>
                  <th scope="col" className="text-right">
                    {t("inventory.reserve.quantity")}
                  </th>
                  <th scope="col">{t("inventory.status")}</th>
                  <th scope="col">{t("inventory.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => (
                  <tr key={reservation.id}>
                    <td>
                      <Link className="font-bold hover:underline" href={`/lager/varer/${reservation.itemId}`}>
                        {reservation.sku} · {reservation.name}
                      </Link>
                    </td>
                    <td>{reservation.locationName}</td>
                    <td className="text-right tabular-nums">
                      {formatQuantity(reservation.quantity)} {reservation.unit}
                    </td>
                    <td className="text-xs font-bold">{reservation.status}</td>
                    <td>
                      {reservation.status === "ACTIVE" && canWork && (
                        <div className="flex flex-wrap gap-2">
                          <form action={releaseReservationAction}>
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="reservationId" value={reservation.id} />
                            <input type="hidden" name="workOrderId" value={workOrder.id} />
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
                            <input type="hidden" name="workOrderId" value={workOrder.id} />
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

      {canWork && visits.length > 0 && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.workOrderParts.consumeVisit")}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t("inventory.workOrderParts.consumeVisitDescription")}
          </p>
          <ul className="mt-3 space-y-2">
            {visits.map((visit) => (
              <li key={visit.id} className={`${brandInset} flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm`}>
                <span>
                  {`#${visit.sequence + 1} · ${formatDateTimeLocalized(visit.startsAt, locale)} · ${visit.status}`}
                </span>
                <form action={consumeVisitReservationsAction} className="flex items-center gap-2">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="visitId" value={visit.id} />
                  <input type="hidden" name="workOrderId" value={workOrder.id} />
                  <button
                    className={buttonClassName({ variant: "secondary", size: "sm" })}
                    type="submit"
                  >
                    {t("inventory.workOrderParts.consumeAll")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageShell>
  );
}
