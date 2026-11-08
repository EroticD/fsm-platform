import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { listSuppliers } from "@/server/purchasing";
import { createSupplierAction } from "../actions";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { Field, Input } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import Icon from "@/components/icons";

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("inventory.purchasing.suppliers.title") };
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("inventory");
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");
  const canManage = hasPermission(user, "equipment.manage");

  const resolved = await searchParams;
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const result = await listSuppliers(user);
  if (!result.ok) redirect("/");
  const { suppliers } = result.data;

  return (
    <PageShell size="narrow">
      <PageHeader
        eyebrow={t("inventory.purchasing.eyebrow")}
        title={t("inventory.purchasing.suppliers.title")}
        subtitle={t("inventory.purchasing.suppliers.description")}
        icon={<Icon name="building" className="h-5 w-5" />}
        actions={
          <Link
            href="/lager/innkjop"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("inventory.purchasing.back")}
          </Link>
        }
      />

      {meldt && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("inventory.purchasing.suppliers.created")}
        </p>
      )}
      <ErrorBanner message={feil ? t("inventory.feedback.error") : undefined} />

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">
          {t("inventory.purchasing.suppliers.title")}
        </h2>
        {suppliers.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="building" className="h-6 w-6" />}
            title={t("inventory.purchasing.suppliers.empty")}
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("inventory.purchasing.suppliers.title")}
            tabIndex={0}
          >
            <table className="office-table min-w-[36rem]">
              <thead>
                <tr>
                  <th scope="col">{t("inventory.purchasing.suppliers.name")}</th>
                  <th scope="col">{t("inventory.purchasing.suppliers.orgNumber")}</th>
                  <th scope="col">{t("inventory.purchasing.suppliers.email")}</th>
                  <th scope="col">{t("inventory.purchasing.suppliers.phone")}</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td className="font-bold">{supplier.name}</td>
                    <td className="font-mono text-xs">
                      {supplier.orgNumber || "—"}
                    </td>
                    <td className="text-xs">{supplier.email || "—"}</td>
                    <td className="text-xs">{supplier.phone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && (
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("inventory.purchasing.suppliers.create")}
          </h2>
          <form action={createSupplierAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="returnTo" value="/lager/innkjop/leverandorer" />
            <Field id="supplier-name" label={t("inventory.purchasing.suppliers.name")} required>
              <Input
                id="supplier-name"
                name="name"
                placeholder={t("inventory.purchasing.suppliers.name")}
                aria-label={t("inventory.purchasing.suppliers.name")}
                required
              />
            </Field>
            <Field id="supplier-org" label={t("inventory.purchasing.suppliers.orgNumber")}>
              <Input
                id="supplier-org"
                name="orgNumber"
                placeholder={t("inventory.purchasing.suppliers.orgNumber")}
                aria-label={t("inventory.purchasing.suppliers.orgNumber")}
              />
            </Field>
            <Field id="supplier-email" label={t("inventory.purchasing.suppliers.email")}>
              <Input
                id="supplier-email"
                name="email"
                type="email"
                placeholder={t("inventory.purchasing.suppliers.email")}
                aria-label={t("inventory.purchasing.suppliers.email")}
              />
            </Field>
            <Field id="supplier-phone" label={t("inventory.purchasing.suppliers.phone")}>
              <Input
                id="supplier-phone"
                name="phone"
                placeholder={t("inventory.purchasing.suppliers.phone")}
                aria-label={t("inventory.purchasing.suppliers.phone")}
              />
            </Field>
            <button
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              type="submit"
            >
              {t("inventory.purchasing.suppliers.createButton")}
            </button>
          </form>
        </Card>
      )}
    </PageShell>
  );
}
