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
import Icon from "@/components/icons";
import EquipmentMoveForm from "./EquipmentMoveForm";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

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
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]"
              >
                <Icon name="sync" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
                  {t("assets.move.heading")}
                </h1>
                <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                  {t("assets.move.subtitle")}
                </p>
                <p className="mt-2 text-sm font-bold text-[var(--ink,#101310)]">
                  {equipment.model}
                  {equipment.serialNumber ? ` · ${equipment.serialNumber}` : ""}
                </p>
              </div>
            </div>
            <Link
              href={`/enheter/${equipment.id}`}
              className={`${INK_BUTTON} shrink-0`}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("assets.move.back")}
            </Link>
          </div>
        </header>

        {errorMessage && <ErrorBanner message={errorMessage} />}

        <EquipmentMoveForm
          equipmentId={equipment.id}
          equipmentModel={equipment.model}
          currentCustomerName={equipment.customer.name}
          initialCounts={preview.counts}
        />
      </div>
    </div>
  );
}
