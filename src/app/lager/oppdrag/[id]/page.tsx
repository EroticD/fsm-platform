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

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-10 items-center justify-center px-3 text-xs font-bold";
const INK_BUTTON =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

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
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className={CARD}>
          <Link href={`/oppdrag/${workOrder.id}`} className="text-xs font-bold underline underline-offset-4">
            {t("inventory.workOrderParts.backToWorkOrder")}
          </Link>
          <p className={`${LABEL} mt-2`}>{workOrder.reference}</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {t("inventory.workOrderParts.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted,#62685f)]">{workOrder.title}</p>
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

        {canWork && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.reserve.title")}
            </h2>
            <form action={reserveStockAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="workOrderId" value={workOrder.id} />
              <select className={CONTROL} name="itemId" required>
                <option value="">{t("inventory.reserve.chooseItem")}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name}
                  </option>
                ))}
              </select>
              <select className={CONTROL} name="locationId" required>
                <option value="">{t("inventory.chooseLocation")}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <input className={CONTROL} name="quantity" type="number" step="0.001" min="0.001" placeholder={t("inventory.reserve.quantity")} required />
              <select className={CONTROL} name="visitId" defaultValue="">
                <option value="">{t("inventory.reserve.noVisit")}</option>
                {visits.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {`#${visit.sequence + 1} · ${formatDateTimeLocalized(visit.startsAt, locale)} · ${visit.status}`}
                  </option>
                ))}
              </select>
              <input className={`${CONTROL} sm:col-span-2`} name="note" placeholder={t("inventory.reserve.note")} />
              <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                {t("inventory.reserve.button")}
              </button>
            </form>
          </section>
        )}

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("inventory.reservations.title")}
          </h2>
          {reservations.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">
              {t("inventory.reservations.empty")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.item.name")}</th>
                    <th className="px-2 py-2">{t("inventory.location")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.reserve.quantity")}</th>
                    <th className="px-2 py-2">{t("inventory.status")}</th>
                    <th className="px-2 py-2">{t("inventory.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((reservation) => (
                    <tr key={reservation.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2">
                        <Link className="font-bold hover:underline" href={`/lager/varer/${reservation.itemId}`}>
                          {reservation.sku} · {reservation.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2">{reservation.locationName}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantity(reservation.quantity)} {reservation.unit}
                      </td>
                      <td className="px-2 py-2 text-xs font-bold">{reservation.status}</td>
                      <td className="px-2 py-2">
                        {reservation.status === "ACTIVE" && canWork && (
                          <div className="flex flex-wrap gap-2">
                            <form action={releaseReservationAction}>
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <input type="hidden" name="reservationId" value={reservation.id} />
                              <input type="hidden" name="workOrderId" value={workOrder.id} />
                              <button className={INK_BUTTON} type="submit">
                                {t("inventory.reservations.release")}
                              </button>
                            </form>
                            <form action={consumeReservationAction}>
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <input type="hidden" name="reservationId" value={reservation.id} />
                              <input type="hidden" name="workOrderId" value={workOrder.id} />
                              <button className={SIGNAL_BUTTON} type="submit">
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
        </section>

        {canWork && visits.length > 0 && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.workOrderParts.consumeVisit")}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("inventory.workOrderParts.consumeVisitDescription")}
            </p>
            <ul className="mt-3 space-y-2">
              {visits.map((visit) => (
                <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-sm">
                  <span>
                    {`#${visit.sequence + 1} · ${formatDateTimeLocalized(visit.startsAt, locale)} · ${visit.status}`}
                  </span>
                  <form action={consumeVisitReservationsAction} className="flex items-center gap-2">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="visitId" value={visit.id} />
                    <input type="hidden" name="workOrderId" value={workOrder.id} />
                    <button className={INK_BUTTON} type="submit">
                      {t("inventory.workOrderParts.consumeAll")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
