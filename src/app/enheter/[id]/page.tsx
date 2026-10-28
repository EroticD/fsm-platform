import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getUnitDetail } from "@/server/customers";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import UnitHistory from "@/components/UnitHistory";

/** Enhetens egen side, slik at enheter kan lenkes direkte fra søk og lister. */
export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("common");
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (
    !hasPermission(user, "customers.view") ||
    !hasPermission(user, "equipment.view")
  ) {
    redirect("/kunder");
  }

  const result = await getUnitDetail(user, id);
  if (!result.ok) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4 sm:p-6">
        <EmptyState
          icon="🔧"
          title={t("customers.units.notFound")}
          action={
            <Link
              href="/kunder"
              className="font-bold text-blue-600 hover:underline"
            >
              {t("customers.units.backToCustomers")}
            </Link>
          }
        />
      </div>
    );
  }

  const { unit, canViewReports } = result.data;
  const customerHref = `/kunder/${unit.customer.id}?tab=utstyr#unit-${unit.id}`;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title={`🔧 ${unit.model}`}
          subtitle={t("customers.units.detailSubtitle", {
            customer: unit.customer.name,
          })}
          actions={
            <Link
              href={customerHref}
              className="rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-100"
            >
              &larr; {t("customers.units.backToCustomer")}
            </Link>
          }
        />

        <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-bold text-gray-600">
                {t("customers.units.customerLabel")}
              </dt>
              <dd className="mt-0.5">
                <Link
                  href={`/kunder/${unit.customer.id}`}
                  className="font-bold text-blue-700 hover:underline"
                >
                  {unit.customer.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="font-bold text-gray-600">
                {t("customers.units.model")}
              </dt>
              <dd className="mt-0.5 font-bold text-gray-900">{unit.model}</dd>
            </div>
            <div>
              <dt className="font-bold text-gray-600">
                {t("customers.units.serialNumber")}
              </dt>
              <dd className="mt-0.5 text-gray-900">
                {unit.serialNumber || t("customers.units.withoutSerial")}
              </dd>
            </div>
            <div>
              <dt className="font-bold text-gray-600">
                {t("customers.units.location")}
              </dt>
              <dd className="mt-0.5 text-gray-900">
                {unit.location || t("customers.overview.notProvided")}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 border-b pb-2 font-black text-gray-900">
            🕓 {t("customers.units.serviceHistory", {
              count: unit._count.reportUnits,
            })}
          </h2>
          {!canViewReports ? (
            <p className="text-xs italic text-gray-600">
              {t("customers.units.historyHidden")}
            </p>
          ) : (
            <>
              {unit._count.reportUnits > unit.reportUnits.length && (
                <p className="mb-2 text-xs text-gray-500">
                  {t("customers.units.showingRecent", {
                    shown: unit.reportUnits.length,
                    total: unit._count.reportUnits,
                  })}
                </p>
              )}
              <UnitHistory entries={unit.reportUnits} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
