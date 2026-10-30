import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getUnitDetail } from "@/server/customers";
import Icon from "@/components/icons";
import UnitHistory from "@/components/UnitHistory";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const INK_LINK =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

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
      <div className="office-app flex min-h-screen flex-col items-center justify-center p-4 sm:p-6">
        <div className="office-card w-full max-w-md p-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]">
            <Icon name="wrench" className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-black text-[var(--ink,#101310)]">
            {t("customers.units.notFound")}
          </h1>
          <Link href="/kunder" className="signal-button mt-4 w-full">
            {t("customers.units.backToCustomers")}
          </Link>
        </div>
      </div>
    );
  }

  const { unit, canViewReports } = result.data;
  const customerHref = `/kunder/${unit.customer.id}?tab=utstyr#unit-${unit.id}`;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="office-card relative overflow-hidden p-4 sm:p-5">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
              >
                <Icon name="wrench" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
                  {unit.model}
                </h1>
                <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
                  {t("customers.units.detailSubtitle", {
                    customer: unit.customer.name,
                  })}
                </p>
              </div>
            </div>
            <Link href={customerHref} className={INK_LINK}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("customers.units.backToCustomer")}
            </Link>
          </div>
        </header>

        <section
          className={CARD}
          aria-label={t("customers.units.title")}
        >
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className={LABEL}>{t("customers.units.customerLabel")}</dt>
              <dd className="mt-0.5 break-words font-bold text-[var(--ink,#101310)]">
                <Link
                  href={`/kunder/${unit.customer.id}`}
                  className="underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]"
                >
                  {unit.customer.name}
                </Link>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className={LABEL}>{t("customers.units.model")}</dt>
              <dd className="mt-0.5 break-words font-bold text-[var(--ink,#101310)]">
                {unit.model}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className={LABEL}>{t("customers.units.serialNumber")}</dt>
              <dd className="mt-0.5 break-words font-mono text-sm font-medium text-[var(--ink,#101310)]">
                {unit.serialNumber || t("customers.units.withoutSerial")}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className={LABEL}>{t("customers.units.location")}</dt>
              <dd className="mt-0.5 break-words text-sm font-medium text-[var(--ink,#101310)]">
                {unit.location || t("customers.overview.notProvided")}
              </dd>
            </div>
          </dl>
        </section>

        <section className={CARD} aria-labelledby="unit-service-history">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
            <h2
              id="unit-service-history"
              className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
            >
              <Icon name="clock" className="h-4 w-4 shrink-0" />
              {t("customers.units.serviceHistory", {
                count: unit._count.reportUnits,
              })}
            </h2>
          </div>

          {!canViewReports ? (
            <p className="text-xs italic text-[var(--muted,#62685f)]">
              {t("customers.units.historyHidden")}
            </p>
          ) : (
            <>
              {unit._count.reportUnits > unit.reportUnits.length && (
                <p className="mb-2 text-xs text-[var(--muted,#62685f)]">
                  {t("customers.units.showingRecent", {
                    shown: unit.reportUnits.length,
                    total: unit._count.reportUnits,
                  })}
                </p>
              )}
              <UnitHistory entries={unit.reportUnits} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
