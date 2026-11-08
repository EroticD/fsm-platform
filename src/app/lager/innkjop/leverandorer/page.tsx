import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { listSuppliers } from "@/server/purchasing";
import { createSupplierAction } from "../actions";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center px-4 text-sm";

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
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className={CARD}>
          <Link
            href="/lager/innkjop"
            className="text-xs font-bold underline underline-offset-4"
          >
            {t("inventory.purchasing.back")}
          </Link>
          <p className={`${LABEL} mt-3`}>{t("inventory.purchasing.eyebrow")}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            {t("inventory.purchasing.suppliers.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
            {t("inventory.purchasing.suppliers.description")}
          </p>
        </header>

        {meldt && (
          <div className="rounded-lg border border-[#a9c96a] bg-[#eef7d6] px-4 py-3 text-sm font-bold text-[#283509]">
            {t("inventory.purchasing.suppliers.created")}
          </div>
        )}
        {feil && (
          <div className="rounded-lg border border-[#e7b5ae] bg-[#fbe9e7] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t("inventory.feedback.error")}
          </div>
        )}

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("inventory.purchasing.suppliers.title")}
          </h2>
          {suppliers.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
              {t("inventory.purchasing.suppliers.empty")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.purchasing.suppliers.name")}</th>
                    <th className="px-2 py-2">{t("inventory.purchasing.suppliers.orgNumber")}</th>
                    <th className="px-2 py-2">{t("inventory.purchasing.suppliers.email")}</th>
                    <th className="px-2 py-2">{t("inventory.purchasing.suppliers.phone")}</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 font-bold">{supplier.name}</td>
                      <td className="px-2 py-2 font-mono text-xs">
                        {supplier.orgNumber || "—"}
                      </td>
                      <td className="px-2 py-2 text-xs">{supplier.email || "—"}</td>
                      <td className="px-2 py-2 text-xs">{supplier.phone || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {canManage && (
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.purchasing.suppliers.create")}
            </h2>
            <form action={createSupplierAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="returnTo" value="/lager/innkjop/leverandorer" />
              <input
                className={CONTROL}
                name="name"
                placeholder={t("inventory.purchasing.suppliers.name")}
                aria-label={t("inventory.purchasing.suppliers.name")}
                required
              />
              <input
                className={CONTROL}
                name="orgNumber"
                placeholder={t("inventory.purchasing.suppliers.orgNumber")}
                aria-label={t("inventory.purchasing.suppliers.orgNumber")}
              />
              <input
                className={CONTROL}
                name="email"
                type="email"
                placeholder={t("inventory.purchasing.suppliers.email")}
                aria-label={t("inventory.purchasing.suppliers.email")}
              />
              <input
                className={CONTROL}
                name="phone"
                placeholder={t("inventory.purchasing.suppliers.phone")}
                aria-label={t("inventory.purchasing.suppliers.phone")}
              />
              <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                {t("inventory.purchasing.suppliers.createButton")}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
