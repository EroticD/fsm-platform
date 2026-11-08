import { requireModulePage } from "@/lib/module-guards";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { EQUIPMENT_ERROR_KEYS } from "@/lib/equipment-feedback";
import { getEquipment } from "@/server/equipment";
import { getEquipmentMovePreview } from "@/server/equipment-move";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import { buttonClassName } from "@/components/ui/Button";
import Icon from "@/components/icons";
import EquipmentMoveForm from "./EquipmentMoveForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("assets.move.heading") };
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function MoveEquipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("equipment");
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const { id } = await params;
  const canMoveToCustomer =
    user.role === "ADMIN" ||
    (hasPermission(user, "equipment.manage") &&
      hasPermission(user, "customers.manage"));
  if (!canMoveToCustomer) redirect(`/enheter/${encodeURIComponent(id)}`);

  const query = await searchParams;
  const feil = param(query.feil);
  const errorMessage = feil
    ? EQUIPMENT_ERROR_KEYS.has(feil)
      ? t(feil)
      : t("assets.errors.generic")
    : null;

  const [detailResult, previewResult] = await Promise.all([
    getEquipment(user, id),
    getEquipmentMovePreview(user, id),
  ]);
  if (!detailResult.ok) notFound();
  if (!previewResult.ok) {
    if (previewResult.reason === "not_found") notFound();
    redirect("/enheter");
  }

  const { equipment } = detailResult.data;
  const preview = previewResult.data;

  return (
    <PageShell size="narrow">
      <PageHeader
        title={t("assets.move.heading")}
        subtitle={
          <>
            {t("assets.move.subtitle")}
            <span className="mt-2 block font-bold text-ink">
              {equipment.model}
              {equipment.serialNumber ? ` · ${equipment.serialNumber}` : ""}
            </span>
          </>
        }
        icon={<Icon name="sync" className="h-5 w-5" />}
        actions={
          <Link
            href={`/enheter/${equipment.id}`}
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("assets.move.back")}
          </Link>
        }
      />

      {errorMessage && <ErrorBanner message={errorMessage} />}

      <EquipmentMoveForm
        equipmentId={equipment.id}
        equipmentModel={equipment.model}
        currentCustomerName={equipment.customer.name}
        initialCounts={preview.counts}
      />
    </PageShell>
  );
}
