import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import MarkdownEditor from "@/components/MarkdownEditor";
import ErrorBanner from "@/components/ErrorBanner";
import EmptyState from "@/components/EmptyState";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import SubmitButton from "@/components/SubmitButton";
import BrandColorField from "@/components/customer/BrandColorField";
import BrandingLogoUpload from "@/components/BrandingLogoUpload";
import Card from "@/components/ui/Card";
import { brandInset } from "@/components/ui/brandStyles";
import { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
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
      <PageShell size="narrow">
        <EmptyState
          icon={<Icon name="alert" className="h-6 w-6" />}
          title={t("customers.detail.notFound")}
          action={
            <Link
              href="/kunder"
              className={buttonClassName({ variant: "secondary" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("customers.detail.backToArchive")}
            </Link>
          }
        />
      </PageShell>
    );
  }

  const { customer, departments, technicianOptions } = options.data;
  const updateCustomer = updateCustomerAction.bind(null, customerId);
  const errorKey = customerErrorMessageKey(error);

  return (
    <PageShell size="narrow">
      <PageHeader
        eyebrow={t("metadata.routes.kunder")}
        title={t("customers.edit.title")}
        subtitle={t("customers.edit.description", { name: customer.name })}
        icon={<Icon name="edit" className="h-5 w-5" />}
        actions={
          <>
            <Link
              href={`/kunder/${customerId}`}
              className={buttonClassName({ variant: "secondary" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("customers.edit.backToDetails")}
            </Link>
            <Link
              href="/kunder"
              className={buttonClassName({ variant: "ghost" })}
            >
              {t("customers.edit.archive")}
            </Link>
          </>
        }
      />

      <ErrorBanner message={errorKey ? t(errorKey) : undefined} />

      <Card
        as="section"
        className="min-w-0 space-y-5 p-4 [--focus-ring:var(--ink,#101310)] sm:p-5"
      >
        <form action={updateCustomer} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              id="customer-edit-name"
              label={t("customers.edit.companyName")}
              required
            >
              <Input
                id="customer-edit-name"
                type="text"
                name="name"
                defaultValue={customer.name}
                required
              />
            </Field>

            <Field
              id="customer-edit-number"
              label={t("customers.edit.customerNumber")}
            >
              <Input
                id="customer-edit-number"
                type="text"
                name="customerNumber"
                defaultValue={customer.customerNumber || ""}
              />
            </Field>

            <Field
              id="customer-edit-org-number"
              label={t("customers.edit.orgNumber")}
            >
              <Input
                id="customer-edit-org-number"
                type="text"
                name="orgNumber"
                defaultValue={customer.orgNumber || ""}
              />
            </Field>

            <Field
              id="customer-edit-brand-color"
              label={t("customers.edit.brandColor")}
            >
              <BrandColorField
                id="customer-edit-brand-color"
                label={t("customers.edit.brandColor")}
                defaultValue={customer.brandColor}
              />
            </Field>
          </div>

          <div>
            <p className="type-eyebrow text-[var(--ink,#101310)]">
              {t("portal.expansion.branding.customerLogo")}
            </p>
            <div className="mt-1.5">
              <BrandingLogoUpload
                initialUrl={customer.logoUrl}
                customerId={customer.id}
                purpose="customer-logo"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field
                id="customer-edit-address"
                label={t("customers.edit.address")}
              >
                <Input
                  id="customer-edit-address"
                  type="text"
                  name="address"
                  defaultValue={customer.address || ""}
                  placeholder={t("customers.edit.addressPlaceholder")}
                />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field
              id="customer-edit-postal-code"
              label={t("customers.edit.postalCode")}
            >
              <Input
                id="customer-edit-postal-code"
                type="text"
                name="postalCode"
                defaultValue={customer.postalCode || ""}
              />
            </Field>

            <Field id="customer-edit-city" label={t("customers.edit.city")}>
              <Input
                id="customer-edit-city"
                type="text"
                name="city"
                defaultValue={customer.city || ""}
              />
            </Field>

            <Field id="customer-edit-phone" label={t("customers.edit.phone")}>
              <Input
                id="customer-edit-phone"
                type="tel"
                name="phone"
                defaultValue={customer.phone || ""}
              />
            </Field>

            <Field id="customer-edit-email" label={t("customers.edit.email")}>
              <Input
                id="customer-edit-email"
                type="email"
                name="email"
                defaultValue={customer.email || ""}
              />
            </Field>
          </div>

          {/* Avdeling og ansvarlig montør */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              id="customer-edit-department"
              label={t("customers.edit.department")}
              hint={t("customers.edit.departmentHint")}
            >
              <Select
                id="customer-edit-department"
                name="departmentId"
                defaultValue={customer.departmentId || ""}
              >
                <option value="">{t("customers.edit.noDepartment")}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              id="customer-edit-technician"
              label={t("customers.edit.responsibleTechnician")}
              hint={t("customers.edit.responsibleHint")}
            >
              <Select
                id="customer-edit-technician"
                name="responsibleTechnicianId"
                defaultValue={customer.responsibleTechnicianId || ""}
              >
                <option value="">{t("customers.edit.noResponsible")}</option>
                {technicianOptions.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name || technician.email}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className={brandInset}>
            <Field
              id="customer-edit-notes"
              label={t("customers.edit.notes")}
              className="p-3"
            >
              <MarkdownEditor
                id="customer-edit-notes"
                name="notes"
                rows={4}
                defaultValue={customer.notes || ""}
                placeholder={t("customers.edit.notesPlaceholder")}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-3 border-t border-[var(--line,#dedcd1)] pt-4 sm:flex-row sm:justify-end">
            <Link
              href={`/kunder/${customerId}`}
              className={buttonClassName({ variant: "secondary" })}
            >
              {t("customers.edit.cancel")}
            </Link>
            <SubmitButton
              pendingLabel={t("customers.edit.saving")}
              className={buttonClassName({ variant: "primary" })}
            >
              {t("customers.edit.save")}
            </SubmitButton>
          </div>
        </form>
      </Card>
    </PageShell>
  );
}
