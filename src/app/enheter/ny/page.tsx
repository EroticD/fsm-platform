import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { EQUIPMENT_ERROR_KEYS } from "@/lib/equipment-feedback";
import { getEquipmentFormOptions } from "@/server/equipment";
import ErrorBanner from "@/components/ErrorBanner";
import SubmitButton from "@/components/SubmitButton";
import Icon from "@/components/icons";
import { createEquipmentAction } from "../actions";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center gap-1.5 px-4 text-sm";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("assets.form.title") };
}

export default async function NewEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string }>;
}) {
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.manage")) redirect("/enheter");

  const { feil } = await searchParams;
  const result = await getEquipmentFormOptions(user);
  if (!result.ok) redirect("/enheter");

  const errorMessage = feil
    ? EQUIPMENT_ERROR_KEYS.has(feil)
      ? t(feil)
      : t("assets.errors.generic")
    : null;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]"
              >
                <Icon name="plus" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)]">
                  {t("assets.form.title")}
                </h1>
                <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                  {t("assets.form.subtitle")}
                </p>
              </div>
            </div>
            <Link href="/enheter" className={INK_BUTTON}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("assets.form.cancel")}
            </Link>
          </div>
        </header>

        {errorMessage && <ErrorBanner message={errorMessage} />}

        <form action={createEquipmentAction} className={`${CARD} space-y-4`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="customerId" className={LABEL}>
                {t("assets.form.customer")} *
              </label>
              <select id="customerId" name="customerId" required className={CONTROL}>
                <option value="">{t("assets.form.customer")}</option>
                {result.data.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="model" className={LABEL}>
                {t("assets.form.model")} *
              </label>
              <input
                id="model"
                name="model"
                type="text"
                required
                maxLength={200}
                className={CONTROL}
              />
            </div>
            <div>
              <label htmlFor="serialNumber" className={LABEL}>
                {t("assets.form.serialNumber")}
              </label>
              <input
                id="serialNumber"
                name="serialNumber"
                type="text"
                maxLength={500}
                className={CONTROL}
              />
            </div>
            <div>
              <label htmlFor="location" className={LABEL}>
                {t("assets.form.location")}
              </label>
              <input
                id="location"
                name="location"
                type="text"
                maxLength={500}
                className={CONTROL}
              />
            </div>
            <div>
              <label htmlFor="categoryId" className={LABEL}>
                {t("assets.form.category")}
              </label>
              <select id="categoryId" name="categoryId" className={CONTROL}>
                <option value="">{t("assets.detail.noCategory")}</option>
                {result.data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="parentId" className={LABEL}>
                {t("assets.form.parent")}
              </label>
              <select id="parentId" name="parentId" className={CONTROL}>
                <option value="">{t("assets.detail.noParent")}</option>
                {result.data.equipment.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.model}
                    {asset.serialNumber ? ` (${asset.serialNumber})` : ""} ·{" "}
                    {asset.customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="status" className={LABEL}>
                {t("assets.form.status")}
              </label>
              <select id="status" name="status" defaultValue="ACTIVE" className={CONTROL}>
                {(["ACTIVE", "OUT_OF_SERVICE", "RETIRED"] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(`assets.status.${status}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="criticality" className={LABEL}>
                {t("assets.form.criticality")}
              </label>
              <select
                id="criticality"
                name="criticality"
                defaultValue="2"
                className={CONTROL}
              >
                {(["1", "2", "3"] as const).map((level) => (
                  <option key={level} value={level}>
                    {t(`assets.criticality.${level}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="installDate" className={LABEL}>
                {t("assets.form.installDate")}
              </label>
              <input
                id="installDate"
                name="installDate"
                type="date"
                className={CONTROL}
              />
            </div>
            <div>
              <label htmlFor="warrantyUntil" className={LABEL}>
                {t("assets.form.warrantyUntil")}
              </label>
              <input
                id="warrantyUntil"
                name="warrantyUntil"
                type="date"
                className={CONTROL}
              />
            </div>
            <div>
              <label htmlFor="meterUnit" className={LABEL}>
                {t("assets.form.meterUnit")}
              </label>
              <input
                id="meterUnit"
                name="meterUnit"
                type="text"
                maxLength={20}
                aria-describedby="meterUnitHint"
                className={CONTROL}
              />
              <p id="meterUnitHint" className="mt-1 text-xs text-[var(--muted,#62685f)]">
                {t("assets.form.meterUnitHint")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line,#dedcd1)] pt-4">
            <Link href="/enheter" className={INK_BUTTON}>
              {t("assets.form.cancel")}
            </Link>
            <SubmitButton
              className={`${SIGNAL_BUTTON} border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]`}
            >
              {t("assets.form.submit")}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
