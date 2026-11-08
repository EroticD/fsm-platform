import { requireModulePage } from "@/lib/module-guards";
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
  getCustomerEquipmentOptions,
} from "@/server/equipment";
import { getCustomerSiteOptions } from "@/server/customer-sites";
import CustomerToast from "@/components/customer/CustomerToast";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import SubmitButton from "@/components/SubmitButton";
import Card from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import { brandInset } from "@/components/ui/brandStyles";
import Icon, { type IconName } from "@/components/icons";
import NavigateLink from "@/components/NavigateLink";
import { buildPhoneUrl } from "@/lib/maps-links";
import CopyAddressButton from "@/components/CopyAddressButton";
import EquipmentDocuments from "@/components/equipment/EquipmentDocuments";
import EquipmentQrCodeForm from "@/components/equipment/EquipmentQrCodeForm";
import MeterChart from "@/components/equipment/MeterChart";
import { displayExternalQrValue } from "@/lib/equipment-qr";
import {
  addMeterReadingAction,
  createMaintenancePlanAction,
  deleteEquipmentAction,
  deleteEquipmentQrCodeAction,
  deleteMaintenancePlanAction,
  moveEquipmentAction,
  rotateQrTokenAction,
  toggleMaintenancePlanAction,
  updateEquipmentAction,
  updateMaintenancePlanAction,
} from "../actions";

const TIMELINE_ICONS: Record<string, IconName> = {
  report: "file",
  workOrder: "clipboard",
  meter: "chart",
  document: "folder",
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE:
    "border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] text-[var(--success-text,#283509)]",
  OUT_OF_SERVICE:
    "border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] text-[var(--warning-text,#7a4f0c)]",
  RETIRED:
    "border-[color-mix(in_srgb,var(--risk-text,#b42318)_22%,transparent)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]",
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
  await requireModulePage("equipment");
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
      <PageShell size="narrow">
        <Card className="p-4 sm:p-5">
          <EmptyState
            variant="plain"
            icon={<Icon name="wrench" className="h-6 w-6" />}
            title={t("assets.errors.notFound")}
            action={
              <Link
                href="/enheter"
                className={buttonClassName({ variant: "primary", size: "sm" })}
              >
                {t("assets.detail.back")}
              </Link>
            }
          />
        </Card>
      </PageShell>
    );
  }

  const { equipment, uploads, ancestors } = detailResult.data;
  const history = historyResult.ok ? historyResult.data : [];
  const options = optionsResult.ok
    ? optionsResult.data
    : { customers: [], categories: [] };
  // Steder og overordnede enheter hentes bare for denne enhetens kunde, etter
  // at detaljene er lest. Da inneholder verken HTML eller side-payload rader
  // fra en annen kunde.
  const [siteOptionsResult, customerEquipmentResult] = await Promise.all([
    getCustomerSiteOptions(user, equipment.customer.id, { limit: 200 }),
    getCustomerEquipmentOptions(user, equipment.customer.id, {
      excludeId: equipment.id,
      limit: 500,
    }),
  ]);
  const customerSites = siteOptionsResult.ok ? siteOptionsResult.data.sites : [];
  const customerEquipment = customerEquipmentResult.ok
    ? customerEquipmentResult.data.equipment
    : [];
  const canManage = hasPermission(user, "equipment.manage");
  const canMoveToCustomer =
    user.role === "ADMIN" ||
    (canManage && hasPermission(user, "customers.manage"));
  const isAdmin = user.role === "ADMIN";
  const meldt = param(query.meldt);
  const feil = param(query.feil);
  const annen = param(query.annen);
  const feedbackKey = equipmentFeedbackKey(meldt);
  const errorMessage = feil
    ? EQUIPMENT_ERROR_KEYS.has(feil)
      ? feil === "assets.errors.qrDuplicate" && annen
        ? t("assets.errors.qrDuplicateNamed", { model: annen })
        : t(feil)
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

  const parentOptions = customerEquipment;
  const mapTarget = {
    latitude: equipment.site?.latitude ?? null,
    longitude: equipment.site?.longitude ?? null,
    address: equipment.site?.address || equipment.customer.address,
    postalCode: equipment.site?.postalCode || equipment.customer.postalCode,
    city: equipment.site?.city || equipment.customer.city,
  };
  const mapQuery = [
    mapTarget.address,
    mapTarget.postalCode,
    mapTarget.city,
  ]
    .filter(Boolean)
    .join(", ");
  const customerPhoneHref = buildPhoneUrl(equipment.customer.phone);
  const latestReadings = equipment.meterReadings.slice(0, 5);
  const planTrigger = (trigger: string) => t(`assets.triggers.${trigger}`);

  return (
    <PageShell>
      {feedbackKey && <CustomerToast message={t(feedbackKey)} />}
      {errorMessage && <ErrorBanner message={errorMessage} />}

      <PageHeader
        title={equipment.model}
        subtitle={
          <>
            <Link
              href={`/kunder/${equipment.customer.id}`}
              className="font-bold text-ink underline decoration-signal decoration-2 underline-offset-4"
            >
              {equipment.customer.name}
            </Link>
            {equipment.location ? ` · ${equipment.location}` : ""}
            {equipment.site ? ` · ${equipment.site.name}` : ""}
            {equipment.serialNumber ? ` · ${equipment.serialNumber}` : ""}
            {ancestors.length > 0 && (
              <nav
                aria-label={t("assets.detail.parent")}
                className="mt-2 flex flex-wrap items-center gap-1 text-xs"
              >
                {ancestors.map((ancestor) => (
                  <span key={ancestor.id} className="flex items-center gap-1">
                    <Link
                      href={`/enheter/${ancestor.id}`}
                      className="font-bold text-ink underline underline-offset-2"
                    >
                      {ancestor.model}
                    </Link>
                    <span aria-hidden="true">/</span>
                  </span>
                ))}
                <span className="font-bold text-ink">{equipment.model}</span>
              </nav>
            )}
          </>
        }
        icon={<Icon name="wrench" className="h-5 w-5" />}
        actions={
          <>
            <span
              className={`rounded-full border px-2.5 py-1 type-micro ${
                STATUS_TONE[equipment.status] ?? "border-line"
              }`}
            >
              {t(`assets.status.${equipment.status}`)}
            </span>
            <Link
              href="/enheter"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("assets.detail.back")}
            </Link>
            {customerPhoneHref && (
              <a
                href={customerPhoneHref}
                aria-label={t("fieldTools.callAria", {
                  phone: equipment.customer.phone ?? "",
                })}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                <Icon name="phone" className="h-4 w-4" />
                {t("fieldTools.call")}
              </a>
            )}
            <NavigateLink
              latitude={mapTarget.latitude}
              longitude={mapTarget.longitude}
              address={mapTarget.address}
              postalCode={mapTarget.postalCode}
              city={mapTarget.city}
              label={t("fieldTools.navigate")}
              newTabLabel={t("fieldTools.newTab")}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            />
            {canMoveToCustomer && (
              <Link
                href={`/enheter/${equipment.id}/flytt`}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                <Icon name="sync" className="h-4 w-4" />
                {t("assets.move.link")}
              </Link>
            )}
            <Link
              href={`/enheter/${equipment.id}/etikett`}
              className={buttonClassName({ variant: "primary", size: "sm" })}
            >
              <Icon name="file" className="h-4 w-4" />
              {t("assets.detail.printLabel")}
            </Link>
          </>
        }
      />

      {(warrantyExpiring || warrantyExpired) && (
        <div
          role="status"
          className={`rounded-2xl border-2 px-4 py-3 text-sm font-bold ${
            warrantyExpired
              ? "border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]"
              : "border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_30%,transparent)] bg-[var(--warning-surface,#fdf5e4)] text-[var(--warning-text,#7a4f0c)]"
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

      <Card as="section" className="p-4 sm:p-5" aria-labelledby="assets-identity">
        <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
          <h2 id="assets-identity" className="type-eyebrow text-ink">
            {t("assets.detail.identity")}
          </h2>
          {canManage && (
            <a
              href="#rediger"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <Icon name="edit" className="h-4 w-4" />
              {t("assets.detail.editTitle")}
            </a>
          )}
        </div>
        <dl className="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.category")}</dt>
            <dd className="mt-0.5 font-bold">{equipment.category?.name ?? t("assets.detail.noCategory")}</dd>
          </div>
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.serial")}</dt>
            <dd className="mt-0.5 font-mono text-sm">{equipment.serialNumber || t("assets.detail.noSerial")}</dd>
          </div>
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.location")}</dt>
            <dd className="mt-0.5">{equipment.location || t("assets.detail.noLocation")}</dd>
          </div>
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.site")}</dt>
            <dd className="mt-0.5">
              {equipment.site
                ? `${equipment.site.name}${equipment.site.address ? ` · ${equipment.site.address}` : ""}`
                : t("assets.detail.noSite")}
              {mapQuery && (
                <span className="mt-2 block">
                  <CopyAddressButton
                    value={mapQuery}
                    label={t("fieldTools.copyAddress")}
                    copiedLabel={t("fieldTools.copied")}
                    failedLabel={t("fieldTools.copyFailed")}
                    className="border-line bg-transparent text-ink hover:bg-paper"
                  />
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.criticality")}</dt>
            <dd className="mt-0.5 font-bold">
              {t(`assets.criticality.${equipment.criticality}`)}
            </dd>
          </div>
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.installDate")}</dt>
            <dd className="mt-0.5">
              {equipment.installDate
                ? formatDateLocalized(equipment.installDate, locale)
                : t("assets.detail.unknown")}
            </dd>
          </div>
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.warrantyUntil")}</dt>
            <dd className="mt-0.5">
              {warranty
                ? t("assets.detail.warrantyValid", {
                    date: formatDateLocalized(warranty, locale),
                  })
                : t("assets.detail.warrantyNone")}
            </dd>
          </div>
          <div>
            <dt className="type-eyebrow text-muted">{t("assets.detail.meterUnit")}</dt>
            <dd className="mt-0.5">{equipment.meterUnit || t("assets.detail.noMeterUnit")}</dd>
          </div>
        </dl>

        {canManage && (
          <details id="rediger" className="mt-4 border-t border-line pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 type-eyebrow text-ink">
              <Icon name="edit" className="h-4 w-4" />
              {t("assets.detail.editTitle")}
            </summary>
            <form action={updateEquipmentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={equipment.id} />
              <input type="hidden" name="customerId" value={equipment.customer.id} />
              <Field id="edit-model" label={t("assets.form.model")} required>
                <Input id="edit-model" name="model" required defaultValue={equipment.model} />
              </Field>
              <Field id="edit-serial" label={t("assets.form.serialNumber")}>
                <Input id="edit-serial" name="serialNumber" defaultValue={equipment.serialNumber ?? ""} />
              </Field>
              <Field id="edit-location" label={t("assets.form.location")}>
                <Input id="edit-location" name="location" defaultValue={equipment.location ?? ""} />
              </Field>
              <Field id="edit-site" label={t("assets.form.site")}>
                <Select id="edit-site" name="siteId" defaultValue={equipment.siteId ?? ""}>
                  <option value="">{t("assets.form.noSite")}</option>
                  {customerSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                      {site.address ? ` — ${site.address}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="edit-category" label={t("assets.form.category")}>
                <Select id="edit-category" name="categoryId" defaultValue={equipment.categoryId ?? ""}>
                  <option value="">{t("assets.detail.noCategory")}</option>
                  {options.categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </Select>
              </Field>
              <Field id="edit-status" label={t("assets.form.status")}>
                <Select id="edit-status" name="status" defaultValue={equipment.status}>
                  {(["ACTIVE", "OUT_OF_SERVICE", "RETIRED"] as const).map((status) => (
                    <option key={status} value={status}>{t(`assets.status.${status}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field id="edit-criticality" label={t("assets.form.criticality")}>
                <Select id="edit-criticality" name="criticality" defaultValue={String(equipment.criticality)}>
                  {(["1", "2", "3"] as const).map((level) => (
                    <option key={level} value={level}>{t(`assets.criticality.${level}`)}</option>
                  ))}
                </Select>
              </Field>
              <Field id="edit-install" label={t("assets.form.installDate")}>
                <Input id="edit-install" name="installDate" type="date" defaultValue={equipment.installDate ? equipment.installDate.toISOString().slice(0, 10) : ""} />
              </Field>
              <Field id="edit-warranty" label={t("assets.form.warrantyUntil")}>
                <Input id="edit-warranty" name="warrantyUntil" type="date" defaultValue={warranty ? warranty.toISOString().slice(0, 10) : ""} />
              </Field>
              <Field id="edit-meter-unit" label={t("assets.form.meterUnit")}>
                <Input id="edit-meter-unit" name="meterUnit" defaultValue={equipment.meterUnit ?? ""} maxLength={20} />
              </Field>
              <div className="flex items-end">
                <SubmitButton className={buttonClassName({ variant: "primary" })}>
                  {t("assets.detail.save")}
                </SubmitButton>
              </div>
            </form>
          </details>
        )}
      </Card>

      <Card
        as="section"
        id="hierarki"
        className="scroll-mt-24 p-4 sm:p-5"
        aria-labelledby="assets-hierarchy"
      >
        <h2 id="assets-hierarchy" className="border-b border-line pb-2 type-eyebrow text-ink">
          {t("assets.detail.children")}
        </h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <h3 className="type-eyebrow text-muted">{t("assets.detail.parent")}</h3>
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
                    <Link href={`/enheter/${child.id}`} className="flex min-h-11 items-center gap-2 rounded-[10px] px-2 text-sm transition hover:bg-paper">
                      <Icon name="wrench" className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-bold">{child.model}</span>
                      <span className="text-xs text-muted">
                        {t(`assets.status.${child.status}`)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs italic text-muted">
                {t("assets.detail.noChildren")}
              </p>
            )}
          </div>
          {canManage && (
            <form action={moveEquipmentAction} className={`${brandInset} p-3`}>
              <input type="hidden" name="id" value={equipment.id} />
              <input type="hidden" name="customerId" value={equipment.customer.id} />
              <h3 className="type-eyebrow text-muted">{t("assets.detail.moveTitle")}</h3>
              <p className="mt-1 text-xs text-muted">{t("assets.detail.moveDescription")}</p>
              <Field id="move-parent" label={t("assets.detail.newParent")} className="mt-2">
                <Select id="move-parent" name="parentId" defaultValue={equipment.parentId ?? ""}>
                  <option value="">{t("assets.detail.noParent")}</option>
                  {parentOptions.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.model}{asset.serialNumber ? ` (${asset.serialNumber})` : ""}</option>
                  ))}
                </Select>
              </Field>
              <SubmitButton className={`${buttonClassName({ variant: "primary" })} mt-2`}>
                {t("assets.detail.moveSave")}
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>

      <Card
        as="section"
        id="maler"
        className="scroll-mt-24 p-4 sm:p-5"
        aria-labelledby="assets-meter"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <h2 id="assets-meter" className="type-eyebrow text-ink">
            {t("assets.detail.meter")}
          </h2>
          <span className="text-xs text-muted">
            {t("assets.detail.meterUnit")}: {equipment.meterUnit || t("assets.detail.noMeterUnit")}
          </span>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="type-eyebrow text-muted">{t("assets.detail.chartTitle")}</h3>
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
              <ul className="mt-3 divide-y divide-line text-sm">
                {latestReadings.map((reading) => (
                  <li key={reading.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="font-bold">
                      {reading.value.toString()}
                      {equipment.meterUnit ? ` ${equipment.meterUnit}` : ""}
                    </span>
                    <span className="text-xs text-muted">
                      {formatDateLocalized(reading.readAt, locale)} · {t(`assets.sources.${reading.source}`)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs italic text-muted">
                {t("assets.detail.noReadings")}
              </p>
            )}
          </div>
          {canManage && (
            <form action={addMeterReadingAction} className={`${brandInset} p-3`}>
              <input type="hidden" name="id" value={equipment.id} />
              <input type="hidden" name="customerId" value={equipment.customer.id} />
              <h3 className="type-eyebrow text-muted">{t("assets.detail.addReading")}</h3>
              <div className="mt-2 grid gap-2">
                <Field id="reading-value" label={t("assets.detail.readingValue")} required>
                  <Input id="reading-value" name="value" type="number" step="0.01" min="0" required />
                </Field>
                <Field id="reading-date" label={t("assets.detail.readingDate")} required>
                  <Input id="reading-date" name="readAt" type="date" required defaultValue={today.toISOString().slice(0, 10)} />
                </Field>
                <Field id="reading-source" label={t("assets.detail.readingSource")}>
                  <Select id="reading-source" name="source" defaultValue="MANUAL">
                    {(["MANUAL", "VISIT", "IMPORT"] as const).map((source) => (
                      <option key={source} value={source}>{t(`assets.sources.${source}`)}</option>
                    ))}
                  </Select>
                </Field>
                <Field id="reading-note" label={t("assets.detail.note")}>
                  <Textarea id="reading-note" name="note" rows={2} maxLength={2000} />
                </Field>
                <SubmitButton className={buttonClassName({ variant: "primary" })}>
                  {t("assets.detail.saveReading")}
                </SubmitButton>
              </div>
            </form>
          )}
        </div>
      </Card>

      <Card
        as="section"
        id="planer"
        className="scroll-mt-24 p-4 sm:p-5"
        aria-labelledby="assets-plans"
      >
        <h2 id="assets-plans" className="border-b border-line pb-2 type-eyebrow text-ink">
          {t("assets.detail.plansTitle")}
        </h2>
        {equipment.maintenancePlans.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="calendar" className="h-6 w-6" />}
            title={t("assets.detail.plansEmpty")}
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {equipment.maintenancePlans.map((plan) => (
              <li key={plan.id} className={`${brandInset} p-3`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{plan.title}</p>
                    <p className="text-xs text-muted">
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
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs font-bold">
                      {plan.isActive ? t("assets.detail.active") : t("assets.detail.paused")}
                    </span>
                    {canManage && (
                      <form action={toggleMaintenancePlanAction}>
                        <input type="hidden" name="id" value={equipment.id} />
                        <input type="hidden" name="customerId" value={equipment.customer.id} />
                        <input type="hidden" name="planId" value={plan.id} />
                        <input type="hidden" name="isActive" value={plan.isActive ? "true" : "false"} />
                        <button
                          type="submit"
                          className={buttonClassName({ variant: "secondary", size: "sm" })}
                        >
                          {plan.isActive ? t("assets.detail.pause") : t("assets.detail.resume")}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {plan.occurrences.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    {plan.occurrences.map((occurrence) => (
                      <li key={occurrence.id}>
                        {formatDateLocalized(occurrence.dueDate, locale)} ·{" "}
                        {t(`assets.planStatus.${occurrence.status}`)}
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && (
                  <details className="mt-3 border-t border-line pt-3">
                    <summary className="min-h-11 cursor-pointer list-none text-xs font-bold text-ink [&::-webkit-details-marker]:hidden">
                      {t("assets.detail.editPlan")}
                    </summary>
                    <p className="mt-1 text-xs text-muted">
                      {t("assets.detail.editPlanHint")}
                    </p>
                    <form action={updateMaintenancePlanAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input type="hidden" name="id" value={equipment.id} />
                      <input type="hidden" name="customerId" value={equipment.customer.id} />
                      <input type="hidden" name="planId" value={plan.id} />
                      <Field
                        id={`plan-${plan.id}-title`}
                        label={t("assets.detail.planTitle")}
                        required
                        className="sm:col-span-2"
                      >
                        <Input
                          id={`plan-${plan.id}-title`}
                          name="title"
                          required
                          maxLength={200}
                          defaultValue={plan.title}
                        />
                      </Field>
                      <Field id={`plan-${plan.id}-months`} label={t("assets.detail.intervalMonths")}>
                        <Input
                          id={`plan-${plan.id}-months`}
                          name="intervalMonths"
                          type="number"
                          min={1}
                          max={120}
                          defaultValue={plan.intervalMonths ?? ""}
                        />
                      </Field>
                      <Field id={`plan-${plan.id}-meter`} label={t("assets.detail.meterInterval")}>
                        <Input
                          id={`plan-${plan.id}-meter`}
                          name="meterInterval"
                          type="number"
                          step="0.01"
                          min="0.01"
                          defaultValue={plan.meterInterval?.toString() ?? ""}
                        />
                      </Field>
                      <Field id={`plan-${plan.id}-lead`} label={t("assets.detail.leadDays")}>
                        <Input
                          id={`plan-${plan.id}-lead`}
                          name="leadDays"
                          type="number"
                          min={0}
                          max={365}
                          defaultValue={plan.leadDays}
                        />
                      </Field>
                      <Field id={`plan-${plan.id}-due`} label={t("assets.detail.nextDue")}>
                        <Input
                          id={`plan-${plan.id}-due`}
                          name="nextDueDate"
                          type="date"
                          defaultValue={plan.nextDueDate?.toISOString().slice(0, 10) ?? ""}
                        />
                      </Field>
                      <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-ink">
                        <input
                          type="checkbox"
                          name="isActive"
                          defaultChecked={plan.isActive}
                          className="h-5 w-5 rounded border-line"
                        />
                        {t("assets.detail.planActive")}
                      </label>
                      <div className="flex items-end">
                        <SubmitButton className={buttonClassName({ variant: "primary" })}>
                          {t("assets.detail.savePlan")}
                        </SubmitButton>
                      </div>
                    </form>
                    <ConfirmSubmitForm
                      action={deleteMaintenancePlanAction}
                      confirmMessage={t("assets.detail.deletePlanConfirm")}
                      confirmLabel={t("assets.detail.deletePlan")}
                      danger
                      className="mt-2"
                    >
                      <input type="hidden" name="id" value={equipment.id} />
                      <input type="hidden" name="customerId" value={equipment.customer.id} />
                      <input type="hidden" name="planId" value={plan.id} />
                      <button
                        type="submit"
                        className={buttonClassName({ variant: "danger-outline", size: "sm" })}
                      >
                        <Icon name="trash" className="h-4 w-4" />
                        {t("assets.detail.deletePlan")}
                      </button>
                    </ConfirmSubmitForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form action={createMaintenancePlanAction} className={`${brandInset} mt-4 p-3`}>
            <input type="hidden" name="id" value={equipment.id} />
            <input type="hidden" name="customerId" value={equipment.customer.id} />
            <h3 className="type-eyebrow text-muted">{t("assets.detail.newPlan")}</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field id="plan-title" label={t("assets.detail.planTitle")} required className="sm:col-span-2">
                <Input id="plan-title" name="title" required maxLength={200} />
              </Field>
              <Field id="plan-trigger" label={t("assets.detail.trigger")}>
                <Select id="plan-trigger" name="trigger" defaultValue="CALENDAR">
                  <option value="CALENDAR">{t("assets.triggers.CALENDAR")}</option>
                  <option value="METER">{t("assets.triggers.METER")}</option>
                </Select>
              </Field>
              <Field id="plan-lead" label={t("assets.detail.leadDays")}>
                <Input id="plan-lead" name="leadDays" type="number" min={0} max={365} defaultValue={14} />
              </Field>
              <Field id="plan-months" label={t("assets.detail.intervalMonths")}>
                <Input id="plan-months" name="intervalMonths" type="number" min={1} max={120} />
              </Field>
              <Field id="plan-meter" label={t("assets.detail.meterInterval")}>
                <Input id="plan-meter" name="meterInterval" type="number" step="0.01" min="0.01" />
              </Field>
              <Field id="plan-due" label={t("assets.detail.nextDue")}>
                <Input id="plan-due" name="nextDueDate" type="date" />
              </Field>
              <div className="flex items-end">
                <SubmitButton className={buttonClassName({ variant: "primary" })}>
                  {t("assets.detail.newPlan")}
                </SubmitButton>
              </div>
            </div>
          </form>
        )}
      </Card>

      <Card as="section" className="p-4 sm:p-5" aria-labelledby="assets-timeline">
        <h2 id="assets-timeline" className="border-b border-line pb-2 type-eyebrow text-ink">
          {t("assets.detail.timeline")}
        </h2>
        {history.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="clock" className="h-6 w-6" />}
            title={t("assets.detail.timelineEmpty")}
          />
        ) : (
          <ol className="mt-3 space-y-2">
            {history.map((item) => (
              <li key={item.id} className="flex items-start gap-2 rounded-xl border border-line p-2">
                <Icon name={TIMELINE_ICONS[item.kind] ?? "clock"} className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  {item.href ? (
                    <a href={item.href} className="font-bold text-ink underline underline-offset-2">
                      {item.title}
                    </a>
                  ) : (
                    <span className="font-bold text-ink">{item.title}</span>
                  )}
                  <p className="text-xs text-muted">
                    {t(`assets.timeline.kinds.${item.kind}`)} ·{" "}
                    {formatDateLocalized(item.at, locale)}
                    {item.description ? ` · ${item.description}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card
        as="section"
        id="dokumenter"
        className="scroll-mt-24 p-4 sm:p-5"
        aria-labelledby="assets-documents"
      >
        <h2 id="assets-documents" className="border-b border-line pb-2 type-eyebrow text-ink">
          {t("assets.documents.title")}
        </h2>
        <div className="mt-3">
          <EquipmentDocuments equipmentId={equipment.id} documents={uploads} canUpload={canManage} />
        </div>
      </Card>

      <Card
        as="section"
        id="qr"
        className="scroll-mt-24 p-4 sm:p-5"
        aria-labelledby="assets-qr"
      >
        <h2 id="assets-qr" className="border-b border-line pb-2 type-eyebrow text-ink">
          {t("assets.detail.qr")}
        </h2>
        <p className="mt-2 text-xs text-muted">
          {t("assets.detail.qrDescription")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="max-w-full overflow-x-auto rounded-lg border border-line bg-paper px-2 py-1 text-xs">
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
              <button
                type="submit"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("assets.detail.rotateQr")}
              </button>
            </ConfirmSubmitForm>
          )}
        </div>
      </Card>

      <Card
        as="section"
        id="qr-koder"
        className="scroll-mt-24 p-4 sm:p-5"
        aria-labelledby="assets-external-qr"
      >
        <h2
          id="assets-external-qr"
          className="border-b border-line pb-2 type-eyebrow text-ink"
        >
          {t("assets.externalQr.title")}
        </h2>
        <p className="mt-2 text-xs text-muted">
          {t("assets.externalQr.description")}
        </p>

        {equipment.qrCodes.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="flag" className="h-6 w-6" />}
            title={t("assets.externalQr.empty")}
          />
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {equipment.qrCodes.map((code) => (
              <li key={code.id} className="flex flex-wrap items-start gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <code
                    title={code.value}
                    className="block max-w-full overflow-x-auto rounded-lg border border-line bg-paper px-2 py-1 text-xs"
                  >
                    {displayExternalQrValue(code.value)}
                  </code>
                  <p className="mt-1 text-xs font-bold text-ink">
                    {code.label || t("assets.externalQr.noLabel")}
                    <span className="ml-2 font-medium text-muted">
                      {t(`assets.externalQr.sources.${code.source}`)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-2xs text-muted">
                    {t("assets.externalQr.added", {
                      date: formatDateLocalized(code.createdAt, locale),
                    })}
                    {" · "}
                    {code.lastScannedAt
                      ? t("assets.externalQr.lastScanned", {
                          date: formatDateLocalized(code.lastScannedAt, locale),
                        })
                      : t("assets.externalQr.neverScanned")}
                    {code.createdBy?.name
                      ? ` · ${code.createdBy.name}`
                      : ""}
                  </p>
                </div>
                {canManage && (
                  <ConfirmSubmitForm
                    action={deleteEquipmentQrCodeAction}
                    confirmMessage={t("assets.externalQr.deleteConfirm")}
                    confirmLabel={t("assets.externalQr.delete")}
                    danger
                  >
                    <input type="hidden" name="id" value={equipment.id} />
                    <input
                      type="hidden"
                      name="customerId"
                      value={equipment.customer.id}
                    />
                    <input type="hidden" name="codeId" value={code.id} />
                    <button
                      type="submit"
                      className={buttonClassName({ variant: "danger", size: "sm" })}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                      {t("assets.externalQr.delete")}
                    </button>
                  </ConfirmSubmitForm>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <EquipmentQrCodeForm
            equipmentId={equipment.id}
            customerId={equipment.customer.id}
          />
        )}
      </Card>

      {isAdmin && (
        <Card
          as="section"
          className="border-[var(--risk,#f04427)] p-4 sm:p-5"
          aria-labelledby="assets-danger"
        >
          <h2 id="assets-danger" className="type-eyebrow text-[var(--risk-text,#b42318)]">
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
              <button
                type="submit"
                className={buttonClassName({ variant: "danger", size: "sm" })}
              >
                <Icon name="trash" className="h-4 w-4" />
                {t("assets.detail.delete")}
              </button>
            </ConfirmSubmitForm>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
