import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatQuantity } from "@/lib/inventory";
import { listInventory } from "@/server/inventory";
import {
  createInventoryItemAction,
  createInventoryLocationAction,
} from "./actions";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center px-4 text-sm";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("inventory.title") };
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("inventory");
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");

  const resolved = await searchParams;
  const query = param(resolved.q);
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const canManage = hasPermission(user, "equipment.manage");
  const result = await listInventory(user, { q: query });
  if (!result.ok) redirect("/");

  const { items, locations, suggestions } = result.data;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={LABEL}>{t("inventory.eyebrow")}</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
                {t("inventory.title")}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
                {t("inventory.description")}
              </p>
            </div>
            <form className="flex gap-2" action="/lager">
              <input
                className={CONTROL}
                name="q"
                defaultValue={query}
                placeholder={t("inventory.searchPlaceholder")}
                aria-label={t("inventory.searchPlaceholder")}
              />
              <button className={INK_BUTTON} type="submit">
                {t("inventory.search")}
              </button>
            </form>
            <Link className={INK_BUTTON} href="/lager/innkjop">
              {t("inventory.purchasing.link")}
            </Link>
          </div>
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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.suggestions.title")}
            </h2>
            <span className="rounded-full border border-[var(--line,#dedcd1)] px-2.5 py-1 text-xs font-bold">
              {suggestions.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
            {t("inventory.suggestions.description")}
          </p>
          {suggestions.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
              {t("inventory.suggestions.empty")}
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("inventory.item.sku")}</th>
                    <th className="px-2 py-2">{t("inventory.item.name")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.available")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.item.minLevel")}</th>
                    <th className="px-2 py-2 text-right">{t("inventory.suggestions.buy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((item) => (
                    <tr key={item.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 font-mono text-xs">{item.sku}</td>
                      <td className="px-2 py-2">
                        <Link className="font-bold underline-offset-2 hover:underline" href={`/lager/varer/${item.id}`}>
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantity(item.available)} {item.unit}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatQuantity(item.minLevel)}
                      </td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums text-[#6b4808]">
                        {formatQuantity(item.suggestedQuantity)} {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.items.title")}
            </h2>
            {items.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
                {t("inventory.items.empty")}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
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
                    {items.map((item) => (
                      <tr key={item.id} className="border-t border-[var(--line,#dedcd1)]">
                        <td className="px-2 py-2 font-mono text-xs">{item.sku}</td>
                        <td className="px-2 py-2">
                          <Link className="font-bold underline-offset-2 hover:underline" href={`/lager/varer/${item.id}`}>
                            {item.name}
                          </Link>
                          {item.low && (
                            <span className="ml-2 rounded-full border border-[#e4c98f] bg-[#fdf5e4] px-2 py-0.5 text-2xs font-bold text-[#6b4808]">
                              {t("inventory.item.low")}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(item.onHand)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(item.reserved)}</td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums">{formatQuantity(item.available)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canManage && (
              <form action={createInventoryItemAction} className="mt-5 grid gap-3 border-t border-[var(--line,#dedcd1)] pt-4 sm:grid-cols-2">
                <h3 className="sm:col-span-2 text-xs font-black uppercase tracking-[0.12em]">
                  {t("inventory.items.create")}
                </h3>
                <input type="hidden" name="returnTo" value="/lager" />
                <input className={CONTROL} name="sku" placeholder={t("inventory.item.sku")} required />
                <input className={CONTROL} name="name" placeholder={t("inventory.item.name")} required />
                <input className={CONTROL} name="unit" placeholder={t("inventory.item.unit")} defaultValue="stk" />
                <input className={CONTROL} name="minLevel" type="number" step="0.001" min="0" placeholder={t("inventory.item.minLevel")} />
                <input className={`${CONTROL} sm:col-span-2`} name="description" placeholder={t("inventory.item.description")} />
                <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                  {t("inventory.items.createButton")}
                </button>
              </form>
            )}
          </section>

          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("inventory.locations.title")}
            </h2>
            {locations.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-[var(--line,#dedcd1)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
                {t("inventory.locations.empty")}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {locations.map((location) => (
                  <li key={location.id}>
                    <Link
                      className="flex min-h-11 items-center justify-between gap-2 rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-sm transition hover:bg-[var(--paper,#f2efe6)]"
                      href={`/lager/lokasjoner/${location.id}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{location.name}</span>
                        <span className="text-xs text-[var(--muted,#62685f)]">
                          {t(`inventory.locationType.${location.type.toLowerCase()}`)}
                          {" · "}
                          {t("inventory.locations.itemCount", { count: location.itemCount })}
                        </span>
                      </span>
                      {location.lowCount > 0 && (
                        <span className="shrink-0 rounded-full border border-[#e4c98f] bg-[#fdf5e4] px-2 py-0.5 text-2xs font-bold text-[#6b4808]">
                          {t("inventory.locations.lowCount", { count: location.lowCount })}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {canManage && (
              <form action={createInventoryLocationAction} className="mt-5 grid gap-3 border-t border-[var(--line,#dedcd1)] pt-4">
                <h3 className="text-xs font-black uppercase tracking-[0.12em]">
                  {t("inventory.locations.create")}
                </h3>
                <input type="hidden" name="returnTo" value="/lager" />
                <input className={CONTROL} name="name" placeholder={t("inventory.locations.name")} required />
                <select className={CONTROL} name="type" defaultValue="WAREHOUSE">
                  <option value="WAREHOUSE">{t("inventory.locationType.warehouse")}</option>
                  <option value="VAN">{t("inventory.locationType.van")}</option>
                </select>
                <button className={SIGNAL_BUTTON} type="submit">
                  {t("inventory.locations.createButton")}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
