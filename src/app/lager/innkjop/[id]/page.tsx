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
    <PageShell>
      <PageHeader
        eyebrow={t("inventory.purchasing.table.number")}
        title={order.number}
        subtitle={`${order.supplierName} · ${order.locationName}`}
        icon={<Icon name="file" className="h-5 w-5" />}
        actions={
          <>
            <Link
              href="/lager/innkjop"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("inventory.purchasing.back")}
            </Link>
            <div className={`${brandInset} px-4 py-2 text-right`}>
              <p className="type-eyebrow text-muted">{t("inventory.status")}</p>
              <p className="text-lg font-black">{statusLabel}</p>
              <p className="mt-1 text-xs text-muted">
                {t("inventory.purchasing.order.totals.ordered")}{" "}
                <span className="font-bold tabular-nums">
                  {formatAmount(order.orderedTotal)}
                </span>
              </p>
              <p className="text-xs text-muted">
                {t("inventory.purchasing.order.totals.received")}{" "}
                <span className="font-bold tabular-nums">
                  {formatAmount(order.receivedTotal)}
                </span>
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

      <Card as="section" className="grid gap-3 p-4 text-sm sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.supplier")}</p>
          <p className="font-bold">{order.supplierName}</p>
          {order.supplierEmail && (
            <p className="text-xs text-muted">{order.supplierEmail}</p>
          )}
        </div>
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.location")}</p>
          <p className="font-bold">{order.locationName}</p>
        </div>
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.expectedAt")}</p>
          <p className="font-bold">
            {formatDateLocalized(order.expectedAt, locale, undefined, "—")}
          </p>
        </div>
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.created")}</p>
          <p className="font-bold">
            {formatDateTimeLocalized(order.createdAt, locale)}
          </p>
        </div>
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.orderedAt")}</p>
          <p className="font-bold">
            {formatDateTimeLocalized(order.orderedAt, locale, "—")}
          </p>
        </div>
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.receivedAt")}</p>
          <p className="font-bold">
            {formatDateTimeLocalized(order.receivedAt, locale, "—")}
          </p>
        </div>
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.cancelledAt")}</p>
          <p className="font-bold">
            {formatDateTimeLocalized(order.cancelledAt, locale, "—")}
          </p>
        </div>
        <div>
          <p className="type-eyebrow text-muted">{t("inventory.purchasing.order.notes")}</p>
          <p className="font-bold">
            {order.notes || t("inventory.purchasing.order.noNotes")}
          </p>
        </div>
      </Card>

      {canManage && (order.canOrder || order.canCancel) && (
        <Card as="section" className="flex flex-wrap gap-2 p-4 sm:p-5">
          {order.canOrder && (
            <form action={orderPurchaseOrderAction}>
              <input type="hidden" name="purchaseOrderId" value={order.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                className={buttonClassName({ variant: "primary" })}
                type="submit"
              >
                {t("inventory.purchasing.order.orderButton")}
              </button>
            </form>
          )}
          {order.canCancel && (
            <form action={cancelPurchaseOrderAction}>
              <input type="hidden" name="purchaseOrderId" value={order.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                className={buttonClassName({ variant: "secondary" })}
                type="submit"
              >
                {t("inventory.purchasing.order.cancelButton")}
              </button>
            </form>
          )}
        </Card>
      )}

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">
          {t("inventory.purchasing.order.linesTitle")}
        </h2>
        {lines.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="list" className="h-6 w-6" />}
            title={t("inventory.purchasing.order.noLines")}
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("inventory.purchasing.order.linesTitle")}
            tabIndex={0}
          >
            <table className="office-table min-w-[46rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.item.sku")}</th>
                  <th scope="col">{t("inventory.item.name")}</th>
                  <th scope="col" className="text-right">
                    {t("inventory.purchasing.order.orderedQuantity")}
                  </th>
                  <th scope="col" className="text-right">
                    {t("inventory.purchasing.order.receivedQuantity")}
                  </th>
                  <th scope="col" className="text-right">
                    {t("inventory.purchasing.order.remaining")}
                  </th>
                  <th scope="col" className="text-right">
                    {t("inventory.purchasing.order.unitCost")}
                  </th>
                  <th scope="col" className="text-right">
                    {t("inventory.purchasing.order.lineTotal")}
                  </th>
                  {canManage && order.status === "DRAFT" && (
                    <th scope="col">{t("inventory.actions")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="font-mono text-xs">{line.sku}</td>
                    <td>
                      <Link
                        className="font-bold hover:underline"
                        href={`/lager/varer/${line.itemId}`}
                      >
                        {line.name}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">
                      {formatQuantity(line.orderedQuantity)} {line.unit}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatQuantity(line.receivedQuantity)}
                    </td>
                    <td className="text-right font-bold tabular-nums">
                      {formatQuantity(line.remainingQuantity)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatAmount(line.unitCost)}
                    </td>
                    <td className="text-right font-bold tabular-nums">
                      {formatAmount(line.lineTotal)}
                    </td>
                    {canManage && order.status === "DRAFT" && (
                      <td>
                        <form action={removeLineAction}>
                          <input type="hidden" name="purchaseOrderId" value={order.id} />
                          <input type="hidden" name="lineId" value={line.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                            type="submit"
                          >
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
            className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-[2fr_1fr_1fr_auto]"
          >
            <input type="hidden" name="purchaseOrderId" value={order.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field id="line-item" label={t("inventory.purchasing.order.addLine")} required>
              <Select id="line-item" name="itemId" required>
                <option value="">{t("inventory.purchasing.order.chooseItem")}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="line-quantity"
              label={t("inventory.purchasing.order.orderedQuantity")}
              required
            >
              <Input
                id="line-quantity"
                name="orderedQuantity"
                type="number"
                step="0.001"
                min="0.001"
                required
              />
            </Field>
            <Field id="line-cost" label={t("inventory.purchasing.order.unitCost")}>
              <Input
                id="line-cost"
                name="unitCost"
                type="number"
                step="0.01"
                min="0"
                defaultValue="0"
              />
            </Field>
            <button
              className={`${buttonClassName({ variant: "primary" })} self-end`}
              type="submit"
            >
              {t("inventory.purchasing.order.addButton")}
            </button>
          </form>
        )}
      </Card>

      {canManage && order.canReceive && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.purchasing.order.receiveTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {t("inventory.purchasing.order.receiveDescription")}
          </p>
          <form action={receivePurchaseOrderAction} className="mt-3 grid gap-3">
            <input type="hidden" name="purchaseOrderId" value={order.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid gap-2">
              {lines.map((line) => (
                <label
                  key={line.id}
                  className={`${brandInset} grid items-end gap-2 p-3 sm:grid-cols-[1fr_10rem]`}
                >
                  <span>
                    <span className="block text-sm font-bold">{line.name}</span>
                    <span className="text-xs text-muted">
                      {t("inventory.purchasing.order.remaining")}:{" "}
                      {formatQuantity(line.remainingQuantity)} {line.unit}
                    </span>
                  </span>
                  <span className="grid gap-1">
                    <span className="type-eyebrow text-ink">
                      {t("inventory.purchasing.order.receiveQuantity")}
                    </span>
                    <Input
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
            <button
              className={buttonClassName({ variant: "primary" })}
              type="submit"
            >
              {t("inventory.purchasing.order.receiveButton")}
            </button>
          </form>
        </Card>
      )}

      {canManage && order.status === "DRAFT" && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.purchasing.order.editTitle")}
          </h2>
          <form action={updateDraftAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field id="draft-expected" label={t("inventory.purchasing.order.expectedAt")}>
              <Input
                id="draft-expected"
                name="expectedAt"
                type="date"
                defaultValue={dateInput(order.expectedAt)}
              />
            </Field>
            <Field id="draft-notes" label={t("inventory.purchasing.order.notes")}>
              <Input id="draft-notes" name="notes" defaultValue={order.notes ?? ""} />
            </Field>
            <button
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              type="submit"
            >
              {t("inventory.purchasing.order.saveButton")}
            </button>
          </form>
        </Card>
      )}
    </PageShell>
  );
}
