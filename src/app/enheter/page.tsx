import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import {
  buildEquipmentTree,
  listEquipment,
  listEquipmentCategories,
  listEquipmentForest,
  type EquipmentForestData,
  type EquipmentForestItem,
  type EquipmentListData,
} from "@/server/equipment";
import EmptyState from "@/components/EmptyState";
import Pagination, { paginationLabels } from "@/components/Pagination";
import Icon from "@/components/icons";
import CustomerToast from "@/components/customer/CustomerToast";
import { equipmentFeedbackKey } from "@/lib/equipment-feedback";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center gap-1.5 px-4 text-sm";

const STATUS_OPTIONS = ["ACTIVE", "OUT_OF_SERVICE", "RETIRED"] as const;

function param(
  value: string | string[] | undefined,
  fallback = "",
): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("assets.list.title") };
}

function matchesForestFilters(
  item: EquipmentForestItem,
  query: string,
  status: string,
  categoryId: string,
): boolean {
  if (status && status !== "ALL" && item.status !== status) return false;
  if (categoryId && item.categoryId !== categoryId) return false;
  if (!query) return true;
  const needle = query.toLocaleLowerCase("nb");
  return [
    item.model,
    item.serialNumber,
    item.location,
    item.customer.name,
    item.category?.name,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase("nb").includes(needle));
}

function TreeBranch({
  nodes,
  depth = 0,
}: {
  nodes: ReturnType<typeof buildEquipmentTree>;
  depth?: number;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className={depth > 0 ? "ml-4 border-l border-[var(--line,#dedcd1)] pl-3" : "space-y-2"}>
      {nodes.map((node) => (
        <li key={node.id}>
          <Link
            href={`/enheter/${node.id}`}
            className="flex min-h-11 items-center gap-2 rounded-[10px] px-2 py-1.5 text-sm transition hover:bg-[var(--paper,#f2efe6)]"
          >
            <Icon
              name={node.children.length > 0 ? "folder" : "wrench"}
              className="h-4 w-4 shrink-0 text-[var(--muted,#62685f)]"
            />
            <span className="min-w-0 flex-1 truncate font-bold text-[var(--ink,#101310)]">
              {node.model}
            </span>
            <span className="shrink-0 text-xs text-[var(--muted,#62685f)]">
              {node.customer.name}
            </span>
            {node._count.children > 0 && (
              <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] px-2 py-0.5 text-2xs font-bold text-[var(--muted,#62685f)]">
                {node._count.children}
              </span>
            )}
          </Link>
          <TreeBranch nodes={node.children} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/");

  const resolved = await searchParams;
  const query = param(resolved.q).trim().slice(0, 120);
  const status = param(resolved.status);
  const categoryId = param(resolved.kategori);
  const customerId = param(resolved.kunde);
  const hierarchy = param(resolved.hierarki) === "1";
  const page = Math.max(1, Number.parseInt(param(resolved.side, "1"), 10) || 1);
  const feedbackKey = equipmentFeedbackKey(param(resolved.meldt));

  const [categoriesResult, listResult] = await Promise.all([
    listEquipmentCategories(user),
    hierarchy
      ? listEquipmentForest(user)
      : listEquipment(user, {
          q: query,
          status,
          categoryId,
          customerId,
          page,
          limit: 20,
        }),
  ]);

  const categories = categoriesResult.ok ? categoriesResult.data.categories : [];
  let listData: EquipmentListData | null = null;
  let forestData: EquipmentForestData | null = null;
  if (hierarchy) {
    if (listResult.ok) forestData = listResult.data as EquipmentForestData;
  } else if (listResult.ok) {
    listData = listResult.data as EquipmentListData;
  }
  const forestItems = forestData
    ? forestData.items.filter((item) =>
        matchesForestFilters(item, query, status, categoryId),
      )
    : [];
  const total = forestData ? forestItems.length : listData?.total ?? 0;
  const totalPages = forestData ? 1 : listData?.totalPages ?? 0;
  const tree = forestData ? buildEquipmentTree(forestItems) : [];

  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    if (categoryId) params.set("kategori", categoryId);
    if (customerId) params.set("kunde", customerId);
    if (hierarchy) params.set("hierarki", "1");
    if (nextPage > 1) params.set("side", String(nextPage));
    const suffix = params.toString();
    return `/enheter${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        {feedbackKey && <CustomerToast message={t(feedbackKey)} />}
        <header className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]"
              >
                <Icon name="wrench" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
                  {t("assets.list.title")}
                </h1>
                <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                  {t("assets.list.subtitle")}
                </p>
              </div>
            </div>
            {hasPermission(user, "equipment.manage") && (
              <Link href="/enheter/ny" className={SIGNAL_BUTTON}>
                <Icon name="plus" className="h-4 w-4" />
                {t("assets.list.newAsset")}
              </Link>
            )}
          </div>
        </header>

        <section className={CARD} aria-labelledby="assets-filters">
          <h2 id="assets-filters" className="sr-only">
            {t("assets.list.searchLabel")}
          </h2>
          <form method="GET" action="/enheter" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label htmlFor="assets-q" className={LABEL}>
                {t("assets.list.searchLabel")}
              </label>
              <div className="relative mt-1">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted,#62685f)]"
                />
                <input
                  id="assets-q"
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder={t("assets.list.searchPlaceholder")}
                  className={`${CONTROL} pl-9`}
                />
              </div>
            </div>
            <div>
              <label htmlFor="assets-status" className={LABEL}>
                {t("assets.list.status")}
              </label>
              <select
                id="assets-status"
                name="status"
                defaultValue={status || "ALL"}
                className={`${CONTROL} mt-1`}
              >
                <option value="ALL">{t("assets.list.allStatuses")}</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`assets.status.${option}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assets-category" className={LABEL}>
                {t("assets.list.category")}
              </label>
              <select
                id="assets-category"
                name="kategori"
                defaultValue={categoryId}
                className={`${CONTROL} mt-1`}
              >
                <option value="">{t("assets.list.allCategories")}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
              <button type="submit" className={INK_BUTTON}>
                <Icon name="search" className="h-4 w-4" />
                {t("assets.list.search")}
              </button>
              <Link href="/enheter" className={INK_BUTTON}>
                {t("assets.list.reset")}
              </Link>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-[var(--ink,#101310)]">
                <input
                  type="checkbox"
                  name="hierarki"
                  value="1"
                  defaultChecked={hierarchy}
                  className="h-5 w-5 rounded border-[var(--line,#dedcd1)]"
                />
                {t("assets.list.hierarchy")}
              </label>
              <p className="ml-auto self-center text-xs text-[var(--muted,#62685f)]">
                {hierarchy
                  ? t("assets.list.hierarchyHint")
                  : t("assets.list.showing", {
                      shown: listData?.items.length ?? 0,
                      total,
                    })}
              </p>
            </div>
          </form>
        </section>

        {hierarchy && forestData?.truncated && (
          <p className="text-xs font-bold text-[var(--muted,#62685f)]">
            {t("assets.list.treeTruncated", { limit: forestItems.length })}
          </p>
        )}

        {(forestData ? forestItems.length === 0 : (listData?.items.length ?? 0) === 0) ? (
          <EmptyState
            icon={<Icon name="wrench" className="h-6 w-6" />}
            title={t("assets.list.empty")}
            description={t("assets.list.emptyHint")}
            action={
              hasPermission(user, "equipment.manage") ? (
                <Link href="/enheter/ny" className={SIGNAL_BUTTON}>
                  {t("assets.list.newAsset")}
                </Link>
              ) : undefined
            }
          />
        ) : hierarchy ? (
          <section className={CARD} aria-label={t("assets.list.hierarchy")}>
            <TreeBranch nodes={tree} />
          </section>
        ) : (
          <section className="space-y-2" aria-live="polite">
            {(listData?.items ?? []).map((item) => (
              <article key={item.id} className={CARD}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link
                      href={`/enheter/${item.id}`}
                      className="text-base font-black text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                    >
                      {item.model}
                    </Link>
                    <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                      {item.serialNumber
                        ? t("assets.detail.serial") + `: ${item.serialNumber}`
                        : t("assets.detail.noSerial")}
                      {" · "}
                      {item.customer.name}
                      {item.location ? ` · ${item.location}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-1 font-bold">
                      {t(`assets.status.${item.status}`)}
                    </span>
                    {item.category && (
                      <span className="rounded-full border border-[var(--line,#dedcd1)] px-2 py-1 font-bold">
                        {item.category.name}
                      </span>
                    )}
                    <span className="text-[var(--muted,#62685f)]">
                      {t("assets.detail.criticality")}:{" "}
                      {t(`assets.criticality.${item.criticality}`)}
                    </span>
                    {item.warrantyUntil && (
                      <span className="text-[var(--muted,#62685f)]">
                        {t("assets.detail.warrantyUntil")}:{" "}
                        {formatDateLocalized(item.warrantyUntil, locale)}
                      </span>
                    )}
                    <Link href={`/enheter/${item.id}`} className={INK_BUTTON}>
                      {t("assets.list.open")}
                    </Link>
                  </div>
                </div>
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted,#62685f)]">
                  <span>
                    {t("assets.list.meterReadings")}:{" "}
                    {item._count.meterReadings}
                  </span>
                  <span>
                    {t("assets.list.plans")}: {item._count.maintenancePlans}
                  </span>
                  <span>
                    {t("assets.list.children")}: {item._count.children}
                  </span>
                  <span>
                    {t("assets.list.serviceHistory")}:{" "}
                    {item._count.reportUnits}
                  </span>
                </p>
              </article>
            ))}
            <Pagination
              page={page}
              totalPages={totalPages}
              hrefFor={hrefFor}
              labels={paginationLabels(t)}
              summary={t("assets.list.showing", {
                shown: Math.min(listData?.items.length ?? 0, 20),
                total,
              })}
            />
          </section>
        )}
      </div>
    </div>
  );
}
