import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateTimeLocalized } from "@/lib/dates";
import { formatQuantity } from "@/lib/inventory";
import { getInventoryLocation } from "@/server/inventory";
import { updateInventoryLocationAction } from "../../actions";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const t = await getTranslations("common");
  const { id } = await params;
  return { title: `${t("inventory.locations.detailTitle")} ${id}` };
}

export default async function InventoryLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("inventory");
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");
  const canManage = hasPermission(user, "equipment.manage");

  const { id } = await params;
  const resolved = await searchParams;
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const result = await getInventoryLocation(user, id);
  if (!result.ok) notFound();
  const { location, levels, movements } = result.data;
  const returnTo = `/lager/lokasjoner/${location.id}`;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={CARD}>
          <Link href="/lager" className="text-xs font-bold underline underline-offset-4">
            {t("inventory.back")}
          </Link>
          <p className={`${LABEL} mt-2`}>{t(`inventory.locationType.${location.type.toLowerCase()}`)}</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{location.name}</h1>
        </header>

        {meldt && (
          <div className="rounded-lg border border-[#a9c96a] bg-[#eef7d6] px-4 py-3 text-sm font-bold text-[#283509]">
            {t("inventory.feedback.saved")}
          </div>
        )}
        {feil && (
          <div className="rounded-lg border border-[#e7b5ae] bg-[#fbe9e7] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t("inventory.feedback.error")}
          </div>
        )}

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("inventory.stock.levels")}
          </h2>
          {levels.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">
              {t("inventory.stock.noLevels")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.item.sku")}</th>
                    <th className="px-2 py-2">{t("inventory.item.name")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.onHand")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.reserved")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.available")}</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((level) => (
                    <tr key={level.itemId} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 font-mono text-xs">{level.sku}</td>
                      <td className="px-2 py-2">
                        <Link className="font-bold hover:underline" href={`/lager/varer/${level.itemId}`}>
                          {level.name}
                        </Link>
                        {level.low && (
                          <span className="ml-2 rounded-full border border-[#e4c98f] bg-[#fdf5e4] px-2 py-0.5 text-2xs font-bold text-[#6b4808]">
                            {t("inventory.item.low")}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(level.quantity)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(level.reserved)}</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{formatQuantity(level.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("inventory.movements.title")}
          </h2>
          {movements.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">
              {t("inventory.movements.empty")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.movements.at")}</th>
                    <th className="px-2 py-2">{t("inventory.movements.type")}</th>
                    <th className="px-2 py-2">{t("inventory.item.name")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.movements.quantity")}</th>
                    <th className="px-2 py-2">{t("inventory.movements.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 text-xs">{formatDateTimeLocalized(movement.createdAt, locale)}</td>
                      <td className="px-2 py-2 font-bold">{movement.type}</td>
                      <td className="px-2 py-2">{movement.itemName}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(movement.quantity)}</td>
                      <td className="px-2 py-2 text-xs">{movement.reason || "—"}</td>
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
              {t("inventory.locations.edit")}
            </h2>
            <form action={updateInventoryLocationAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="id" value={location.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input className={CONTROL} name="name" defaultValue={location.name} required />
              <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                <input type="checkbox" name="isActive" value="true" defaultChecked={location.isActive} />
                {t("inventory.locations.active")}
              </label>
              <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                {t("inventory.item.save")}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
