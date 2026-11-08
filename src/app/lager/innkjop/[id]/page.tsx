import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized, formatDateTimeLocalized } from "@/lib/dates";
import { formatAmount } from "@/lib/billing";
import { formatQuantity } from "@/lib/inventory";
import { getPurchaseOrder } from "@/server/purchasing";
import {
  addLineAction,
  cancelPurchaseOrderAction,
  orderPurchaseOrderAction,
  receivePurchaseOrderAction,
  removeLineAction,
  updateDraftAction,
} from "../actions";

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

function dateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("common");
  const { id } = await params;
  return { title: `${t("inventory.purchasing.title")} ${id}` };
}

export default async function PurchaseOrderPage({
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
  const result = await getPurchaseOrder(user, id);
  if (!result.ok) notFound();
  const { order, lines, items } = result.data;
  const returnTo = `/lager/innkjop/${order.id}`;
  const statusLabel = t(
    `inventory.purchasing.status.${order.status.toLowerCase()}`,
  );

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={CARD}>
          <Link
            href="/lager/innkjop"
            className="text-xs font-bold underline underline-offset-4"
          >
            {t("inventory.purchasing.back")}
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={LABEL}>{t("inventory.purchasing.table.number")}</p>
              <h1 className="font-mono text-2xl font-extrabold tracking-tight sm:text-3xl">
                {order.number}
              </h1>
              <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                {order.supplierName} · {order.locationName}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line,#dedcd1)] px-4 py-3 text-right">
              <p className={LABEL}>{t("inventory.status")}</p>
              <p className="text-lg font-black">{statusLabel}</p>
              <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                {t("inventory.purchasing.order.totals.ordered")}{" "}
                <span className="font-bold tabular-nums">
                  {formatAmount(order.orderedTotal)}
                </span>
              </p>
              <p className="text-xs text-[var(--muted,#62685f)]">
                {t("inventory.purchasing.order.totals.received")}{" "}
                <span className="font-bold tabular-nums">
                  {formatAmount(order.receivedTotal)}
                </span>
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

        <section className={`${CARD} grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4`}>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.supplier")}</p>
            <p className="font-bold">{order.supplierName}</p>
            {order.supplierEmail && (
              <p className="text-xs text-[var(--muted,#62685f)]">{order.supplierEmail}</p>
            )}
          </div>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.location")}</p>
            <p className="font-bold">{order.locationName}</p>
          </div>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.expectedAt")}</p>
            <p className="font-bold">
              {formatDateLocalized(order.expectedAt, locale, undefined, "—")}
            </p>
          </div>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.created")}</p>
            <p className="font-bold">
              {formatDateTimeLocalized(order.createdAt, locale)}
            </p>
          </div>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.orderedAt")}</p>
            <p className="font-bold">
              {formatDateTimeLocalized(order.orderedAt, locale, "—")}
            </p>
          </div>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.receivedAt")}</p>
            <p className="font-bold">
              {formatDateTimeLocalized(order.receivedAt, locale, "—")}
            </p>
          </div>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.cancelledAt")}</p>
            <p className="font-bold">
              {formatDateTimeLocalized(order.cancelledAt, locale, "—")}
            </p>
          </div>
          <div>
            <p className={LABEL}>{t("inventory.purchasing.order.notes")}</p>
            <p className="font-bold">
              {order.notes || t("inventory.purchasing.order.noNotes")}
            </p>
          </div>
        </section>

        {canManage && (order.canOrder || order.canCancel) && (
          <section className={`${CARD} flex flex-wrap gap-2`}>
            {order.canOrder && (
              <form action={orderPurchaseOrderAction}>
                <input type="hidden" name="purchaseOrderId" value={order.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className={SIGNAL_BUTTON} type="submit">
                  {t("inventory.purchasing.order.orderButton")}
                </button>
              </form>
            )}
            {order.canCancel && (
              <form action={cancelPurchaseOrderAction}>
                <input type="hidden" name="purchaseOrderId" value={order.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className={INK_BUTTON} type="submit">
                  {t("inventory.purchasing.order.cancelButton")}
                </button>
              </form>
            )}
          </section>
        )}

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("inventory.purchasing.order.linesTitle")}
          </h2>
          {lines.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
              {t("inventory.purchasing.order.noLines")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.item.sku")}</th>
                    <th className="px-2 py-2">{t("inventory.item.name")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.purchasing.order.orderedQuantity")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.purchasing.order.receivedQuantity")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.purchasing.order.remaining")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.purchasing.order.unitCost")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.purchasing.order.lineTotal")}</th>
                    {canManage && order.status === "DRAFT" && (
                      <th className="px-2 py-2">{t("inventory.actions")}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 font-mono text-xs">{line.sku}</td>
                      <td className="px-2 py-2">
                        <Link
                          className="font-bold underline-offset-2 hover:underline"
                          href={`/lager/varer/${line.itemId}`}
                        >
                          {line.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantity(line.orderedQuantity)} {line.unit}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantity(line.receivedQuantity)}
                      </td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">
                        {formatQuantity(line.remainingQuantity)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatAmount(line.unitCost)}
                      </td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">
                        {formatAmount(line.lineTotal)}
                      </td>
                      {canManage && order.status === "DRAFT" && (
                        <td className="px-2 py-2">
                          <form action={removeLineAction}>
                            <input type="hidden" name="purchaseOrderId" value={order.id} />
                            <input type="hidden" name="lineId" value={line.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <button className={INK_BUTTON} type="submit">
                              {t("inventory.purchasing.order.remove")}
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManage && order.status === "DRAFT" && (
            <form
              action={addLineAction}
              className="mt-5 grid gap-3 border-t border-[var(--line,#dedcd1)] pt-4 sm:grid-cols-[2fr_1fr_1fr_auto]"
            >
              <input type="hidden" name="purchaseOrderId" value={order.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <label className="grid gap-1 text-xs font-bold">
                {t("inventory.purchasing.order.addLine")}
                <select className={CONTROL} name="itemId" required>
                  <option value="">{t("inventory.purchasing.order.chooseItem")}</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} · {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold">
                {t("inventory.purchasing.order.orderedQuantity")}
                <input
                  className={CONTROL}
                  name="orderedQuantity"
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                />
              </label>
              <label className="grid gap-1 text-xs font-bold">
                {t("inventory.purchasing.order.unitCost")}
                <input
                  className={CONTROL}
                  name="unitCost"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue="0"
                />
              </label>
              <button className={`${SIGNAL_BUTTON} self-end`} type="submit">
                {t("inventory.purchasing.order.addButton")}
              </button>
            </form>
          )}
        </section>

        {canManage && order.canReceive && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.purchasing.order.receiveTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
              {t("inventory.purchasing.order.receiveDescription")}
            </p>
            <form action={receivePurchaseOrderAction} className="mt-3 grid gap-3">
              <input type="hidden" name="purchaseOrderId" value={order.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="grid gap-2">
                {lines.map((line) => (
                  <label
                    key={line.id}
                    className="grid items-end gap-2 rounded-[10px] border border-[var(--line,#dedcd1)] p-3 sm:grid-cols-[1fr_10rem]"
                  >
                    <span>
                      <span className="block text-sm font-bold">{line.name}</span>
                      <span className="text-xs text-[var(--muted,#62685f)]">
                        {t("inventory.purchasing.order.remaining")}:{" "}
                        {formatQuantity(line.remainingQuantity)} {line.unit}
                      </span>
                    </span>
                    <span className="grid gap-1 text-xs font-bold">
                      {t("inventory.purchasing.order.receiveQuantity")}
                      <input
                        className={CONTROL}
                        name={`quantity:${line.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        max={line.remainingQuantity}
                        defaultValue={line.remainingQuantity || ""}
                        disabled={line.remainingQuantity <= 0}
                      />
                    </span>
                  </label>
                ))}
              </div>
              <button className={SIGNAL_BUTTON} type="submit">
                {t("inventory.purchasing.order.receiveButton")}
              </button>
            </form>
          </section>
        )}

        {canManage && order.status === "DRAFT" && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.purchasing.order.editTitle")}
            </h2>
            <form action={updateDraftAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <label className="grid gap-1 text-xs font-bold">
                {t("inventory.purchasing.order.expectedAt")}
                <input
                  className={CONTROL}
                  name="expectedAt"
                  type="date"
                  defaultValue={dateInput(order.expectedAt)}
                />
              </label>
              <label className="grid gap-1 text-xs font-bold">
                {t("inventory.purchasing.order.notes")}
                <input className={CONTROL} name="notes" defaultValue={order.notes ?? ""} />
              </label>
              <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                {t("inventory.purchasing.order.saveButton")}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
