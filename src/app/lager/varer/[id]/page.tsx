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
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={CARD}>
          <Link href="/lager" className="text-xs font-bold underline underline-offset-4">
            {t("inventory.back")}
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={LABEL}>{item.sku}</p>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{item.name}</h1>
              <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                {item.description || t("inventory.item.noDescription")}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line,#dedcd1)] px-4 py-3 text-right">
              <p className={LABEL}>{t("inventory.item.minLevel")}</p>
              <p className="text-xl font-black tabular-nums">
                {formatQuantity(item.minLevel)} {item.unit}
              </p>
            </div>
          </div>
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

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.stock.levels")}
            </h2>
            {levels.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
                {t("inventory.stock.noLevels")}
              </p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.location")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.onHand")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.reserved")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.available")}</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((level) => (
                    <tr key={level.locationId} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2">
                        <Link className="font-bold hover:underline" href={`/lager/lokasjoner/${level.locationId}`}>
                          {level.locationName}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(level.quantity)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(level.reserved)}</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{formatQuantity(level.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {canManage && (
            <section className={CARD}>
              <h2 className="text-sm font-black uppercase tracking-[0.12em]">
                {t("inventory.adjust.title")}
              </h2>
              <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                {t("inventory.adjust.description")}
              </p>
              <form action={adjustStockAction} className="mt-3 grid gap-2">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="itemId" value={item.id} />
                <select className={CONTROL} name="locationId" required>
                  <option value="">{t("inventory.chooseLocation")}</option>
                  {levels.map((level) => (
                    <option key={level.locationId} value={level.locationId}>
                      {level.locationName}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <select className={CONTROL} name="type" defaultValue="IN">
                    <option value="IN">{t("inventory.adjust.types.in")}</option>
                    <option value="OUT">{t("inventory.adjust.types.out")}</option>
                    <option value="ADJUST">{t("inventory.adjust.types.adjust")}</option>
                  </select>
                  <input className={CONTROL} name="quantity" type="number" step="0.001" placeholder={t("inventory.adjust.quantity")} required />
                </div>
                <input className={CONTROL} name="reason" placeholder={t("inventory.adjust.reason")} />
                <button className={SIGNAL_BUTTON} type="submit">
                  {t("inventory.adjust.button")}
                </button>
              </form>
            </section>
          )}
        </div>

        {canWork && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.reserve.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("inventory.reserve.description")}
            </p>
            <form action={reserveStockAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="itemId" value={item.id} />
              <select className={CONTROL} name="locationId" required>
                <option value="">{t("inventory.chooseLocation")}</option>
                {levels.map((level) => (
                  <option key={level.locationId} value={level.locationId}>
                    {level.locationName} ({formatQuantity(level.available)})
                  </option>
                ))}
              </select>
              <input className={CONTROL} name="quantity" type="number" step="0.001" min="0.001" placeholder={t("inventory.reserve.quantity")} required />
              <input className={CONTROL} name="workOrderId" placeholder={t("inventory.reserve.workOrderId")} required />
              <input className={CONTROL} name="note" placeholder={t("inventory.reserve.note")} />
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
              <table className="w-full min-w-[38rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.location")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.reserve.quantity")}</th>
                    <th className="px-2 py-2">{t("inventory.status")}</th>
                    <th className="px-2 py-2">{t("inventory.workOrder")}</th>
                    <th className="px-2 py-2">{t("inventory.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((reservation) => (
                    <tr key={reservation.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2">{reservation.locationName}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(reservation.quantity)}</td>
                      <td className="px-2 py-2 text-xs font-bold">{reservation.status}</td>
                      <td className="px-2 py-2">
                        {reservation.workOrderId ? (
                          <Link className="underline underline-offset-2" href={`/lager/oppdrag/${reservation.workOrderId}`}>
                            {t("inventory.openWorkOrder")}
                          </Link>
                        ) : (
                          <span className="text-[var(--muted,#62685f)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {reservation.status === "ACTIVE" && canWork && (
                          <div className="flex flex-wrap gap-2">
                            <form action={releaseReservationAction}>
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <input type="hidden" name="reservationId" value={reservation.id} />
                              <input type="hidden" name="workOrderId" value={reservation.workOrderId ?? ""} />
                              <button className={INK_BUTTON} type="submit">
                                {t("inventory.reservations.release")}
                              </button>
                            </form>
                            <form action={consumeReservationAction}>
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <input type="hidden" name="reservationId" value={reservation.id} />
                              <input type="hidden" name="workOrderId" value={reservation.workOrderId ?? ""} />
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

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("inventory.movements.title")}
          </h2>
          {movements.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">
              {t("inventory.movements.empty")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.movements.at")}</th>
                    <th className="px-2 py-2">{t("inventory.movements.type")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.movements.quantity")}</th>
                    <th className="px-2 py-2">{t("inventory.location")}</th>
                    <th className="px-2 py-2">{t("inventory.movements.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 text-xs">{formatDateTimeLocalized(movement.createdAt, locale)}</td>
                      <td className="px-2 py-2 font-bold">{movement.type}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(movement.quantity)}</td>
                      <td className="px-2 py-2">{movement.locationName}</td>
                      <td className="px-2 py-2 text-xs">{movement.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canManage && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.item.edit")}
            </h2>
            <form action={updateInventoryItemAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input className={CONTROL} name="sku" defaultValue={item.sku} required />
              <input className={CONTROL} name="name" defaultValue={item.name} required />
              <input className={CONTROL} name="unit" defaultValue={item.unit} required />
              <input className={CONTROL} name="minLevel" type="number" step="0.001" min="0" defaultValue={item.minLevel} />
              <input className={`${CONTROL} sm:col-span-2`} name="description" defaultValue={item.description ?? ""} />
              <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                <input type="checkbox" name="active" value="true" defaultChecked={item.active} />
                {t("inventory.item.active")}
              </label>
              <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                {t("inventory.item.save")}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
