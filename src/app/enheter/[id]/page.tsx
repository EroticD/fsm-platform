import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import {
  formatDateLocalized,
  todayUtc,
} from "@/lib/dates";
import {
  EQUIPMENT_ERROR_KEYS,
  equipmentFeedbackKey,
} from "@/lib/equipment-feedback";
import {
  getEquipment,
  getEquipmentFormOptions,
  getEquipmentHistory,
} from "@/server/equipment";
import CustomerToast from "@/components/customer/CustomerToast";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import ErrorBanner from "@/components/ErrorBanner";
import SubmitButton from "@/components/SubmitButton";
import Icon, { type IconName } from "@/components/icons";
import EquipmentDocuments from "@/components/equipment/EquipmentDocuments";
import MeterChart from "@/components/equipment/MeterChart";
import {
  addMeterReadingAction,
  createMaintenancePlanAction,
  deleteEquipmentAction,
  moveEquipmentAction,
  rotateQrTokenAction,
  toggleMaintenancePlanAction,
  updateEquipmentAction,
} from "../actions";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center gap-1.5 border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 text-sm text-[var(--ink,#101310)]";
const DANGER_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--risk,#f04427)] bg-[var(--risk,#f04427)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]";

const TIMELINE_ICONS: Record<string, IconName> = {
  report: "file",
  workOrder: "clipboard",
  meter: "chart",
  document: "folder",
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-[#a9c96a] bg-[#eef7d6] text-[#283509]",
  OUT_OF_SERVICE: "border-[#e4c98f] bg-[#fdf5e4] text-[#7a4f0c]",
  RETIRED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
};

const DAY_MS = 24 * 60 * 60 * 1000;

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
  return { title: `${t("assets.detail.identity")} · ${id}` };
}

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/enheter");

  const { id } = await params;
  const [detailResult, historyResult, optionsResult, query] = await Promise.all([
    getEquipment(user, id),
    getEquipmentHistory(user, id),
    getEquipmentFormOptions(user),
    searchParams,
  ]);
  if (!detailResult.ok) {
    return (
      <div className="office-app flex min-h-screen items-center justify-center p-4">
        <div className={`${CARD} w-full max-w-md text-center`}>
          <h1 className="text-xl font-black text-[var(--ink,#101310)]">
            {t("assets.errors.notFound")}
          </h1>
          <Link href="/enheter" className={`${SIGNAL_BUTTON} mt-4`}>
            {t("assets.detail.back")}
          </Link>
        </div>
      </div>
    );
  }

  const { equipment, uploads, ancestors } = detailResult.data;
  const history = historyResult.ok ? historyResult.data : [];
  const options = optionsResult.ok
    ? optionsResult.data
    : { customers: [], categories: [], equipment: [] };
  const canManage = hasPermission(user, "equipment.manage");
  const isAdmin = user.role === "ADMIN";
  const meldt = param(query.meldt);
  const feil = param(query.feil);
  const feedbackKey = equipmentFeedbackKey(meldt);
  const errorMessage = feil
    ? EQUIPMENT_ERROR_KEYS.has(feil)
      ? t(feil)
      : t("assets.errors.generic")
    : null;

  const today = todayUtc();
  const warranty = equipment.warrantyUntil;
  const daysUntilWarranty = warranty
    ? Math.ceil((warranty.getTime() - today.getTime()) / DAY_MS)
    : null;
  const warrantyExpired = daysUntilWarranty !== null && daysUntilWarranty < 0;
  const warrantyExpiring =
    daysUntilWarranty !== null && daysUntilWarranty >= 0 && daysUntilWarranty <= 30;

  const parentOptions = options.equipment.filter((asset) => asset.id !== id);
  const latestReadings = equipment.meterReadings.slice(0, 5);
  const planTrigger = (trigger: string) => t(`assets.triggers.${trigger}`);

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        {feedbackKey && <CustomerToast message={t(feedbackKey)} />}
        {errorMessage && <ErrorBanner message={errorMessage} />}

        <header className={CARD}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]"
              >
                <Icon name="wrench" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="break-words text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
                    {equipment.model}
                  </h1>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                      STATUS_TONE[equipment.status] ??
                      "border-[var(--line,#dedcd1)]"
                    }`}
                  >
                    {t(`assets.status.${equipment.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                  <Link
                    href={`/kunder/${equipment.customer.id}`}
                    className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                  >
                    {equipment.customer.name}
                  </Link>
                  {equipment.location ? ` · ${equipment.location}` : ""}
                  {equipment.serialNumber ? ` · ${equipment.serialNumber}` : ""}
                </p>
                {ancestors.length > 0 && (
                  <nav aria-label={t("assets.detail.parent")} className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                    {ancestors.map((ancestor) => (
                      <span key={ancestor.id} className="flex items-center gap-1">
                        <Link
                          href={`/enheter/${ancestor.id}`}
                          className="font-bold text-[var(--ink,#101310)] underline underline-offset-2"
                        >
                          {ancestor.model}
                        </Link>
                        <span aria-hidden="true">/</span>
                      </span>
                    ))}
                    <span className="font-bold">{equipment.model}</span>
                  </nav>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/enheter" className={INK_BUTTON}>
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("assets.detail.back")}
              </Link>
              <Link href={`/enheter/${equipment.id}/etikett`} className={SIGNAL_BUTTON}>
                <Icon name="file" className="h-4 w-4" />
                {t("assets.detail.printLabel")}
              </Link>
            </div>
          </div>
        </header>

        {(warrantyExpiring || warrantyExpired) && (
          <div
            role="status"
            className={`rounded-2xl border-2 px-4 py-3 text-sm font-bold ${
              warrantyExpired
                ? "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]"
                : "border-[#e4c98f] bg-[#fdf5e4] text-[#7a4f0c]"
            }`}
          >
            <Icon name="shield" className="mr-1.5 inline h-4 w-4" />
            {warrantyExpired
              ? t("assets.detail.warrantyExpired", {
                  date: formatDateLocalized(warranty, locale),
                })
              : t("assets.detail.warrantyExpiring", {
                  date: formatDateLocalized(warranty, locale),
                })}
          </div>
        )}

        <section className={CARD} aria-labelledby="assets-identity">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
            <h2 id="assets-identity" className="text-xs font-black uppercase tracking-[0.12em]">
              {t("assets.detail.identity")}
            </h2>
            {canManage && (
              <a href="#rediger" className={INK_BUTTON}>
                <Icon name="edit" className="h-4 w-4" />
                {t("assets.detail.editTitle")}
              </a>
            )}
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className={LABEL}>{t("assets.detail.category")}</dt>
              <dd className="mt-0.5 font-bold">{equipment.category?.name ?? t("assets.detail.noCategory")}</dd>
            </div>
            <div>
              <dt className={LABEL}>{t("assets.detail.serial")}</dt>
              <dd className="mt-0.5 font-mono text-sm">{equipment.serialNumber || t("assets.detail.noSerial")}</dd>
            </div>
            <div>
              <dt className={LABEL}>{t("assets.detail.location")}</dt>
              <dd className="mt-0.5">{equipment.location || t("assets.detail.noLocation")}</dd>
            </div>
            <div>
              <dt className={LABEL}>{t("assets.detail.criticality")}</dt>
              <dd className="mt-0.5 font-bold">
                {t(`assets.criticality.${equipment.criticality}`)}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>{t("assets.detail.installDate")}</dt>
              <dd className="mt-0.5">
                {equipment.installDate
                  ? formatDateLocalized(equipment.installDate, locale)
                  : t("assets.detail.unknown")}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>{t("assets.detail.warrantyUntil")}</dt>
              <dd className="mt-0.5">
                {warranty
                  ? t("assets.detail.warrantyValid", {
                      date: formatDateLocalized(warranty, locale),
                    })
                  : t("assets.detail.warrantyNone")}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>{t("assets.detail.meterUnit")}</dt>
              <dd className="mt-0.5">{equipment.meterUnit || t("assets.detail.noMeterUnit")}</dd>
            </div>
          </dl>

          {canManage && (
            <details id="rediger" className="mt-4 border-t border-[var(--line,#dedcd1)] pt-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em]">
                <Icon name="edit" className="h-4 w-4" />
                {t("assets.detail.editTitle")}
              </summary>
              <form action={updateEquipmentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={equipment.id} />
                <input type="hidden" name="customerId" value={equipment.customer.id} />
                <div>
                  <label htmlFor="edit-model" className={LABEL}>{t("assets.form.model")} *</label>
                  <input id="edit-model" name="model" required defaultValue={equipment.model} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="edit-serial" className={LABEL}>{t("assets.form.serialNumber")}</label>
                  <input id="edit-serial" name="serialNumber" defaultValue={equipment.serialNumber ?? ""} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="edit-location" className={LABEL}>{t("assets.form.location")}</label>
                  <input id="edit-location" name="location" defaultValue={equipment.location ?? ""} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="edit-category" className={LABEL}>{t("assets.form.category")}</label>
                  <select id="edit-category" name="categoryId" defaultValue={equipment.categoryId ?? ""} className={CONTROL}>
                    <option value="">{t("assets.detail.noCategory")}</option>
                    {options.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-status" className={LABEL}>{t("assets.form.status")}</label>
                  <select id="edit-status" name="status" defaultValue={equipment.status} className={CONTROL}>
                    {(["ACTIVE", "OUT_OF_SERVICE", "RETIRED"] as const).map((status) => (
                      <option key={status} value={status}>{t(`assets.status.${status}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-criticality" className={LABEL}>{t("assets.form.criticality")}</label>
                  <select id="edit-criticality" name="criticality" defaultValue={String(equipment.criticality)} className={CONTROL}>
                    {(["1", "2", "3"] as const).map((level) => (
                      <option key={level} value={level}>{t(`assets.criticality.${level}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-install" className={LABEL}>{t("assets.form.installDate")}</label>
                  <input id="edit-install" name="installDate" type="date" defaultValue={equipment.installDate ? equipment.installDate.toISOString().slice(0, 10) : ""} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="edit-warranty" className={LABEL}>{t("assets.form.warrantyUntil")}</label>
                  <input id="edit-warranty" name="warrantyUntil" type="date" defaultValue={warranty ? warranty.toISOString().slice(0, 10) : ""} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="edit-meter-unit" className={LABEL}>{t("assets.form.meterUnit")}</label>
                  <input id="edit-meter-unit" name="meterUnit" defaultValue={equipment.meterUnit ?? ""} maxLength={20} className={CONTROL} />
                </div>
                <div className="flex items-end">
                  <SubmitButton className={SIGNAL_BUTTON}>{t("assets.detail.save")}</SubmitButton>
                </div>
              </form>
            </details>
          )}
        </section>

        <section id="hierarki" className={`${CARD} scroll-mt-24`} aria-labelledby="assets-hierarchy">
          <h2 id="assets-hierarchy" className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
            {t("assets.detail.children")}
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className={LABEL}>{t("assets.detail.parent")}</h3>
              <p className="mt-1 text-sm font-bold">
                {equipment.parent ? (
                  <Link href={`/enheter/${equipment.parent.id}`} className="underline underline-offset-2">
                    {equipment.parent.model}
                  </Link>
                ) : (
                  t("assets.detail.noParent")
                )}
              </p>
              {equipment.children.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {equipment.children.map((child) => (
                    <li key={child.id}>
                      <Link href={`/enheter/${child.id}`} className="flex min-h-11 items-center gap-2 rounded-[10px] px-2 text-sm hover:bg-[var(--paper,#f2efe6)]">
                        <Icon name="wrench" className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-bold">{child.model}</span>
                        <span className="text-xs text-[var(--muted,#62685f)]">
                          {t(`assets.status.${child.status}`)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs italic text-[var(--muted,#62685f)]">
                  {t("assets.detail.noChildren")}
                </p>
              )}
            </div>
            {canManage && (
              <form action={moveEquipmentAction} className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
                <input type="hidden" name="id" value={equipment.id} />
                <input type="hidden" name="customerId" value={equipment.customer.id} />
                <h3 className={LABEL}>{t("assets.detail.moveTitle")}</h3>
                <p className="mt-1 text-xs text-[var(--muted,#62685f)]">{t("assets.detail.moveDescription")}</p>
                <label htmlFor="move-parent" className={`${LABEL} mt-2 block`}>{t("assets.detail.newParent")}</label>
                <select id="move-parent" name="parentId" defaultValue={equipment.parentId ?? ""} className={CONTROL}>
                  <option value="">{t("assets.detail.noParent")}</option>
                  {parentOptions.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.model} · {asset.customer.name}</option>
                  ))}
                </select>
                <SubmitButton className={`${SIGNAL_BUTTON} mt-2`}>{t("assets.detail.moveSave")}</SubmitButton>
              </form>
            )}
          </div>
        </section>

        <section id="maler" className={`${CARD} scroll-mt-24`} aria-labelledby="assets-meter">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
            <h2 id="assets-meter" className="text-xs font-black uppercase tracking-[0.12em]">
              {t("assets.detail.meter")}
            </h2>
            <span className="text-xs text-[var(--muted,#62685f)]">
              {t("assets.detail.meterUnit")}: {equipment.meterUnit || t("assets.detail.noMeterUnit")}
            </span>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className={LABEL}>{t("assets.detail.chartTitle")}</h3>
              <div className="mt-1">
                <MeterChart
                  readings={equipment.meterReadings.map((reading) => ({
                    id: reading.id,
                    value: reading.value.toString(),
                    readAt: reading.readAt,
                  }))}
                  unit={equipment.meterUnit}
                  label={t("assets.detail.chartTitle")}
                  emptyLabel={t("assets.detail.chartEmpty")}
                  model={equipment.model}
                />
              </div>
              {latestReadings.length > 0 ? (
                <ul className="mt-3 divide-y divide-[var(--line,#dedcd1)] text-sm">
                  {latestReadings.map((reading) => (
                    <li key={reading.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="font-bold">
                        {reading.value.toString()}
                        {equipment.meterUnit ? ` ${equipment.meterUnit}` : ""}
                      </span>
                      <span className="text-xs text-[var(--muted,#62685f)]">
                        {formatDateLocalized(reading.readAt, locale)} · {t(`assets.sources.${reading.source}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs italic text-[var(--muted,#62685f)]">
                  {t("assets.detail.noReadings")}
                </p>
              )}
            </div>
            {canManage && (
              <form action={addMeterReadingAction} className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
                <input type="hidden" name="id" value={equipment.id} />
                <input type="hidden" name="customerId" value={equipment.customer.id} />
                <h3 className={LABEL}>{t("assets.detail.addReading")}</h3>
                <div className="mt-2 grid gap-2">
                  <div>
                    <label htmlFor="reading-value" className={LABEL}>{t("assets.detail.readingValue")} *</label>
                    <input id="reading-value" name="value" type="number" step="0.01" min="0" required className={CONTROL} />
                  </div>
                  <div>
                    <label htmlFor="reading-date" className={LABEL}>{t("assets.detail.readingDate")} *</label>
                    <input id="reading-date" name="readAt" type="date" required defaultValue={today.toISOString().slice(0, 10)} className={CONTROL} />
                  </div>
                  <div>
                    <label htmlFor="reading-source" className={LABEL}>{t("assets.detail.readingSource")}</label>
                    <select id="reading-source" name="source" defaultValue="MANUAL" className={CONTROL}>
                      {(["MANUAL", "VISIT", "IMPORT"] as const).map((source) => (
                        <option key={source} value={source}>{t(`assets.sources.${source}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="reading-note" className={LABEL}>{t("assets.detail.note")}</label>
                    <textarea id="reading-note" name="note" rows={2} maxLength={2000} className={CONTROL} />
                  </div>
                  <SubmitButton className={SIGNAL_BUTTON}>{t("assets.detail.saveReading")}</SubmitButton>
                </div>
              </form>
            )}
          </div>
        </section>

        <section id="planer" className={`${CARD} scroll-mt-24`} aria-labelledby="assets-plans">
          <h2 id="assets-plans" className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
            {t("assets.detail.plansTitle")}
          </h2>
          {equipment.maintenancePlans.length === 0 ? (
            <p className="mt-3 text-xs italic text-[var(--muted,#62685f)]">
              {t("assets.detail.plansEmpty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {equipment.maintenancePlans.map((plan) => (
                <li key={plan.id} className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[var(--ink,#101310)]">{plan.title}</p>
                      <p className="text-xs text-[var(--muted,#62685f)]">
                        {planTrigger(plan.trigger)}
                        {plan.intervalMonths ? ` · ${plan.intervalMonths} ${t("assets.detail.intervalMonths")}` : ""}
                        {plan.meterInterval ? ` · ${plan.meterInterval.toString()} ${t("assets.detail.meterInterval")}` : ""}
                        {" · "}
                        {plan.nextDueDate
                          ? `${t("assets.detail.nextDue")}: ${formatDateLocalized(plan.nextDueDate, locale)}`
                          : t("assets.detail.noOccurrences")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-[var(--line,#dedcd1)] px-2 py-0.5 text-xs font-bold">
                        {plan.isActive ? t("assets.detail.active") : t("assets.detail.paused")}
                      </span>
                      {canManage && (
                        <form action={toggleMaintenancePlanAction}>
                          <input type="hidden" name="id" value={equipment.id} />
                          <input type="hidden" name="customerId" value={equipment.customer.id} />
                          <input type="hidden" name="planId" value={plan.id} />
                          <input type="hidden" name="isActive" value={plan.isActive ? "true" : "false"} />
                          <button type="submit" className={INK_BUTTON}>
                            {plan.isActive ? t("assets.detail.pause") : t("assets.detail.resume")}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                  {plan.occurrences.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted,#62685f)]">
                      {plan.occurrences.map((occurrence) => (
                        <li key={occurrence.id}>
                          {formatDateLocalized(occurrence.dueDate, locale)} ·{" "}
                          {t(`assets.planStatus.${occurrence.status}`)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <form action={createMaintenancePlanAction} className="mt-4 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
              <input type="hidden" name="id" value={equipment.id} />
              <input type="hidden" name="customerId" value={equipment.customer.id} />
              <h3 className={LABEL}>{t("assets.detail.newPlan")}</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="plan-title" className={LABEL}>{t("assets.detail.planTitle")} *</label>
                  <input id="plan-title" name="title" required maxLength={200} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="plan-trigger" className={LABEL}>{t("assets.detail.trigger")}</label>
                  <select id="plan-trigger" name="trigger" defaultValue="CALENDAR" className={CONTROL}>
                    <option value="CALENDAR">{t("assets.triggers.CALENDAR")}</option>
                    <option value="METER">{t("assets.triggers.METER")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="plan-lead" className={LABEL}>{t("assets.detail.leadDays")}</label>
                  <input id="plan-lead" name="leadDays" type="number" min={0} max={365} defaultValue={14} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="plan-months" className={LABEL}>{t("assets.detail.intervalMonths")}</label>
                  <input id="plan-months" name="intervalMonths" type="number" min={1} max={120} className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="plan-meter" className={LABEL}>{t("assets.detail.meterInterval")}</label>
                  <input id="plan-meter" name="meterInterval" type="number" step="0.01" min="0.01" className={CONTROL} />
                </div>
                <div>
                  <label htmlFor="plan-due" className={LABEL}>{t("assets.detail.nextDue")}</label>
                  <input id="plan-due" name="nextDueDate" type="date" className={CONTROL} />
                </div>
                <div className="flex items-end">
                  <SubmitButton className={SIGNAL_BUTTON}>{t("assets.detail.newPlan")}</SubmitButton>
                </div>
              </div>
            </form>
          )}
        </section>

        <section className={CARD} aria-labelledby="assets-timeline">
          <h2 id="assets-timeline" className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
            {t("assets.detail.timeline")}
          </h2>
          {history.length === 0 ? (
            <p className="mt-3 text-xs italic text-[var(--muted,#62685f)]">
              {t("assets.detail.timelineEmpty")}
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {history.map((item) => (
                <li key={item.id} className="flex items-start gap-2 rounded-xl border border-[var(--line,#dedcd1)] p-2">
                  <Icon name={TIMELINE_ICONS[item.kind] ?? "clock"} className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {item.href ? (
                      <a href={item.href} className="font-bold text-[var(--ink,#101310)] underline underline-offset-2">
                        {item.title}
                      </a>
                    ) : (
                      <span className="font-bold text-[var(--ink,#101310)]">{item.title}</span>
                    )}
                    <p className="text-xs text-[var(--muted,#62685f)]">
                      {t(`assets.timeline.kinds.${item.kind}`)} ·{" "}
                      {formatDateLocalized(item.at, locale)}
                      {item.description ? ` · ${item.description}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section id="dokumenter" className={`${CARD} scroll-mt-24`} aria-labelledby="assets-documents">
          <h2 id="assets-documents" className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
            {t("assets.documents.title")}
          </h2>
          <div className="mt-3">
            <EquipmentDocuments equipmentId={equipment.id} documents={uploads} canUpload={canManage} />
          </div>
        </section>

        <section id="qr" className={`${CARD} scroll-mt-24`} aria-labelledby="assets-qr">
          <h2 id="assets-qr" className="border-b border-[var(--line,#dedcd1)] pb-2 text-xs font-black uppercase tracking-[0.12em]">
            {t("assets.detail.qr")}
          </h2>
          <p className="mt-2 text-xs text-[var(--muted,#62685f)]">
            {t("assets.detail.qrDescription")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="max-w-full overflow-x-auto rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-1 text-xs">
              {equipment.qrToken ?? t("assets.errors.qrMissing")}
            </code>
            {canManage && (
              <ConfirmSubmitForm
                action={rotateQrTokenAction}
                confirmMessage={t("assets.detail.rotateConfirm")}
                confirmLabel={t("assets.detail.rotateQr")}
              >
                <input type="hidden" name="id" value={equipment.id} />
                <input type="hidden" name="customerId" value={equipment.customer.id} />
                <button type="submit" className={INK_BUTTON}>
                  {t("assets.detail.rotateQr")}
                </button>
              </ConfirmSubmitForm>
            )}
          </div>
        </section>

        {isAdmin && (
          <section className={`${CARD} border-[var(--risk,#f04427)]`} aria-labelledby="assets-danger">
            <h2 id="assets-danger" className="text-xs font-black uppercase tracking-[0.12em] text-[var(--risk-text,#b42318)]">
              {t("assets.detail.dangerous")}
            </h2>
            <div className="mt-2">
              <ConfirmSubmitForm
                action={deleteEquipmentAction}
                confirmMessage={t("assets.detail.deleteConfirm")}
                confirmLabel={t("assets.detail.delete")}
                danger
              >
                <input type="hidden" name="id" value={equipment.id} />
                <input type="hidden" name="customerId" value={equipment.customer.id} />
                <button type="submit" className={DANGER_BUTTON}>
                  <Icon name="trash" className="h-4 w-4" />
                  {t("assets.detail.delete")}
                </button>
              </ConfirmSubmitForm>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
