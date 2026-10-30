import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import MarkdownEditor from "@/components/MarkdownEditor";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/icons";
import SubmitButton from "@/components/SubmitButton";
import BrandColorField from "@/components/customer/BrandColorField";
import BrandingLogoUpload from "@/components/BrandingLogoUpload";
import {
  CUSTOMER_CARD,
  CUSTOMER_CONTROL,
  CUSTOMER_EYEBROW,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_SIGNAL_BUTTON,
  LEGACY_SURFACE,
} from "@/components/customer/customerStyles";
import { getCustomerEditOptions } from "@/server/customers";
import { updateCustomerAction } from "../../actions";
import { customerErrorMessageKey } from "../../feedback";

export default async function EditCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getCurrentUser();
  if (!session) redirect("/api/auth/signin");
  const t = await getTranslations("common");

  const resolvedParams = await params;
  const customerId = resolvedParams.id;

  // Å redigere kundedata krever customers.manage. Montører får lese kundekortet.
  if (!hasPermission(session, "customers.manage"))
    redirect(`/kunder/${customerId}`);

  const options = await getCustomerEditOptions(session, customerId);
  if (!options.ok) {
    if (options.reason === "forbidden") redirect(`/kunder/${customerId}`);
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center p-4 sm:p-6">
        <div
          className={`${CUSTOMER_CARD} w-full max-w-lg p-6 text-center ${LEGACY_SURFACE}`}
        >
          <h1 className="text-lg font-extrabold text-[var(--ink,#101310)]">
            {t("customers.detail.notFound")}
          </h1>
          <Link
            href="/kunder"
            className={`${CUSTOMER_INK_BUTTON} mt-3`}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("customers.detail.backToArchive")}
          </Link>
        </div>
      </div>
    );
  }

  const { customer, departments, technicianOptions } = options.data;
  const updateCustomer = updateCustomerAction.bind(null, customerId);
  const errorKey = customerErrorMessageKey(error);

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <ErrorBanner message={errorKey ? t(errorKey) : undefined} />

        {/* HEADER */}
        <header
          className={`${CUSTOMER_CARD} relative overflow-hidden px-5 py-5 sm:px-6`}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
          />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
              >
                <Icon name="edit" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className={CUSTOMER_EYEBROW}>
                  {t("metadata.routes.kunder")}
                </p>
                <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
                  {t("customers.edit.title")}
                </h1>
                <p className={`mt-1 text-sm ${CUSTOMER_MUTED}`}>
                  {t("customers.edit.description", { name: customer.name })}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={`/kunder/${customerId}`}
                className={CUSTOMER_INK_BUTTON}
              >
                <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
                {t("customers.edit.backToDetails")}
              </Link>
              <Link href="/kunder" className={CUSTOMER_INK_BUTTON}>
                {t("customers.edit.archive")}
              </Link>
            </div>
          </div>
        </header>

        <form
          action={updateCustomer}
          className={`${CUSTOMER_CARD} min-w-0 space-y-5 p-4 [--focus-ring:var(--ink,#101310)] sm:p-5`}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Firmanavn */}
            <div>
              <label htmlFor="customer-edit-name" className={CUSTOMER_LABEL}>
                {t("customers.edit.companyName")} *
              </label>
              <input
                id="customer-edit-name"
                type="text"
                name="name"
                defaultValue={customer.name}
                required
                className={CUSTOMER_CONTROL}
              />
            </div>

            {/* Kundenummer */}
            <div>
              <label
                htmlFor="customer-edit-number"
                className={CUSTOMER_LABEL}
              >
                {t("customers.edit.customerNumber")}
              </label>
              <input
                id="customer-edit-number"
                type="text"
                name="customerNumber"
                defaultValue={customer.customerNumber || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>

            {/* Org.nr */}
            <div>
              <label
                htmlFor="customer-edit-org-number"
                className={CUSTOMER_LABEL}
              >
                {t("customers.edit.orgNumber")}
              </label>
              <input
                id="customer-edit-org-number"
                type="text"
                name="orgNumber"
                defaultValue={customer.orgNumber || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>

            {/* Merkevarefarge */}
            <div>
              <label
                htmlFor="customer-edit-brand-color"
                className={CUSTOMER_LABEL}
              >
                {t("customers.edit.brandColor")}
              </label>
              <div className="[&_input[type=color]]:h-11 [&_input[type=color]]:w-11 [&_input[type=color]]:cursor-pointer [&_input[type=color]]:rounded-[10px] [&_input[type=color]]:border-[var(--line,#dedcd1)] [&_input[type=color]]:bg-[var(--surface,#fffdf8)] [&_input[type=color]]:p-1 [&_input[type=text]]:min-h-11 [&_input[type=text]]:rounded-xl [&_input[type=text]]:border-[var(--line,#dedcd1)] [&_input[type=text]]:bg-[var(--surface,#fffdf8)] [&_input[type=text]]:text-base [&_input[type=text]]:text-[var(--ink,#101310)]">
                <BrandColorField
                  id="customer-edit-brand-color"
                  label={t("customers.edit.brandColor")}
                  defaultValue={customer.brandColor}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Kundeportal-logo */}
            <div className="md:col-span-2">
              <p className={CUSTOMER_LABEL}>
                {t("portal.expansion.branding.customerLogo")}
              </p>
              <BrandingLogoUpload
                initialUrl={customer.logoUrl}
                customerId={customer.id}
                purpose="customer-logo"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Adresse */}
            <div className="md:col-span-2">
              <label
                htmlFor="customer-edit-address"
                className={CUSTOMER_LABEL}
              >
                {t("customers.edit.address")}
              </label>
              <input
                id="customer-edit-address"
                type="text"
                name="address"
                defaultValue={customer.address || ""}
                placeholder={t("customers.edit.addressPlaceholder")}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Postnr */}
            <div>
              <label
                htmlFor="customer-edit-postal-code"
                className={CUSTOMER_LABEL}
              >
                {t("customers.edit.postalCode")}
              </label>
              <input
                id="customer-edit-postal-code"
                type="text"
                name="postalCode"
                defaultValue={customer.postalCode || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>

            {/* By */}
            <div>
              <label htmlFor="customer-edit-city" className={CUSTOMER_LABEL}>
                {t("customers.edit.city")}
              </label>
              <input
                id="customer-edit-city"
                type="text"
                name="city"
                defaultValue={customer.city || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>

            {/* Telefon */}
            <div>
              <label htmlFor="customer-edit-phone" className={CUSTOMER_LABEL}>
                {t("customers.edit.phone")}
              </label>
              <input
                id="customer-edit-phone"
                type="tel"
                name="phone"
                defaultValue={customer.phone || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>

            {/* E-post */}
            <div>
              <label htmlFor="customer-edit-email" className={CUSTOMER_LABEL}>
                {t("customers.edit.email")}
              </label>
              <input
                id="customer-edit-email"
                type="email"
                name="email"
                defaultValue={customer.email || ""}
                className={CUSTOMER_CONTROL}
              />
            </div>
          </div>

          {/* Avdeling og ansvarlig montør */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="customer-edit-department"
                className={CUSTOMER_LABEL}
              >
                {t("customers.edit.department")}
              </label>
              <select
                id="customer-edit-department"
                name="departmentId"
                defaultValue={customer.departmentId || ""}
                className={CUSTOMER_CONTROL}
              >
                <option value="">{t("customers.edit.noDepartment")}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <p className={`mt-1 text-xs ${CUSTOMER_MUTED}`}>
                {t("customers.edit.departmentHint")}
              </p>
            </div>
            <div>
              <label
                htmlFor="customer-edit-technician"
                className={CUSTOMER_LABEL}
              >
                {t("customers.edit.responsibleTechnician")}
              </label>
              <select
                id="customer-edit-technician"
                name="responsibleTechnicianId"
                defaultValue={customer.responsibleTechnicianId || ""}
                className={CUSTOMER_CONTROL}
              >
                <option value="">{t("customers.edit.noResponsible")}</option>
                {technicianOptions.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name || technician.email}
                  </option>
                ))}
              </select>
              <p className={`mt-1 text-xs ${CUSTOMER_MUTED}`}>
                {t("customers.edit.responsibleHint")}
              </p>
            </div>
          </div>

          {/* Noter */}
          <div className={LEGACY_SURFACE}>
            <label htmlFor="customer-edit-notes" className={CUSTOMER_LABEL}>
              {t("customers.edit.notes")}
            </label>
            <MarkdownEditor
              id="customer-edit-notes"
              name="notes"
              rows={4}
              defaultValue={customer.notes || ""}
              placeholder={t("customers.edit.notesPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--line,#dedcd1)] pt-4 sm:flex-row sm:justify-end">
            <Link
              href={`/kunder/${customerId}`}
              className={CUSTOMER_INK_BUTTON}
            >
              {t("customers.edit.cancel")}
            </Link>
            <SubmitButton
              pendingLabel={t("customers.edit.saving")}
              className={CUSTOMER_SIGNAL_BUTTON}
            >
              {t("customers.edit.save")}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
