import { requireModulePage } from "@/lib/module-guards";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { EQUIPMENT_ERROR_KEYS } from "@/lib/equipment-feedback";
import { getEquipmentFormOptions } from "@/server/equipment";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import SubmitButton from "@/components/SubmitButton";
import Card from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import Icon from "@/components/icons";
import { createEquipmentAction } from "../actions";
import EquipmentCustomerFields from "./EquipmentCustomerFields";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("assets.form.title") };
}

export default async function NewEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string }>;
}) {
  await requireModulePage("equipment");
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
    <PageShell size="narrow">
      <PageHeader
        title={t("assets.form.title")}
        subtitle={t("assets.form.subtitle")}
        icon={<Icon name="plus" className="h-5 w-5" />}
        actions={
          <Link
            href="/enheter"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("assets.form.cancel")}
          </Link>
        }
      />

      {errorMessage && <ErrorBanner message={errorMessage} />}

      <Card as="section" className="p-4 sm:p-5">
        <form action={createEquipmentAction} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <EquipmentCustomerFields customers={result.data.customers} />
            <Field id="model" label={t("assets.form.model")} required>
              <Input
                id="model"
                name="model"
                type="text"
                required
                maxLength={200}
              />
            </Field>
            <Field id="serialNumber" label={t("assets.form.serialNumber")}>
              <Input
                id="serialNumber"
                name="serialNumber"
                type="text"
                maxLength={500}
              />
            </Field>
            <Field id="location" label={t("assets.form.location")}>
              <Input
                id="location"
                name="location"
                type="text"
                maxLength={500}
              />
            </Field>
            <Field id="categoryId" label={t("assets.form.category")}>
              <Select id="categoryId" name="categoryId">
                <option value="">{t("assets.detail.noCategory")}</option>
                {result.data.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="status" label={t("assets.form.status")}>
              <Select id="status" name="status" defaultValue="ACTIVE">
                {(["ACTIVE", "OUT_OF_SERVICE", "RETIRED"] as const).map(
                  (status) => (
                    <option key={status} value={status}>
                      {t(`assets.status.${status}`)}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field id="criticality" label={t("assets.form.criticality")}>
              <Select id="criticality" name="criticality" defaultValue="2">
                {(["1", "2", "3"] as const).map((level) => (
                  <option key={level} value={level}>
                    {t(`assets.criticality.${level}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="installDate" label={t("assets.form.installDate")}>
              <Input id="installDate" name="installDate" type="date" />
            </Field>
            <Field id="warrantyUntil" label={t("assets.form.warrantyUntil")}>
              <Input id="warrantyUntil" name="warrantyUntil" type="date" />
            </Field>
            <Field
              id="meterUnit"
              label={t("assets.form.meterUnit")}
              hint={t("assets.form.meterUnitHint")}
              className="sm:col-span-2"
            >
              <Input
                id="meterUnit"
                name="meterUnit"
                type="text"
                maxLength={20}
              />
            </Field>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Link
              href="/enheter"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {t("assets.form.cancel")}
            </Link>
            <SubmitButton className={buttonClassName({ variant: "primary" })}>
              {t("assets.form.submit")}
            </SubmitButton>
          </div>
        </form>
      </Card>
    </PageShell>
  );
}
