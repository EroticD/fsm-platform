import { requireModulePage } from "@/lib/module-guards";
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
  type EquipmentListData,
} from "@/server/equipment";
import {
  buildEquipmentListHref,
  matchesEquipmentFilters,
} from "@/lib/equipment-list-filters";
import EmptyState from "@/components/EmptyState";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Pagination, { paginationLabels } from "@/components/Pagination";
import Card from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import Icon from "@/components/icons";
import CustomerToast from "@/components/customer/CustomerToast";
import { equipmentFeedbackKey } from "@/lib/equipment-feedback";

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

function TreeBranch({
  nodes,
  depth = 0,
}: {
  nodes: ReturnType<typeof buildEquipmentTree>;
  depth?: number;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className={depth > 0 ? "ml-4 border-l border-line pl-3" : "space-y-2"}>
      {nodes.map((node) => (
        <li key={node.id}>
          <Link
            href={`/enheter/${node.id}`}
            className="flex min-h-11 items-center gap-2 rounded-[10px] px-2 py-1.5 text-sm transition hover:bg-paper"
          >
            <Icon
              name={node.children.length > 0 ? "folder" : "wrench"}
              className="h-4 w-4 shrink-0 text-muted"
            />
            <span className="min-w-0 flex-1 truncate font-bold text-ink">
              {node.model}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {node.customer.name}
            </span>
            {node._count.children > 0 && (
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-2xs font-bold text-muted">
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
  await requireModulePage("equipment");
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
      ? listEquipmentForest(user, { customerId })
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
  const filters = { query, status, categoryId, customerId, hierarchy };
  const forestItems = forestData
    ? forestData.items.filter((item) => matchesEquipmentFilters(item, filters))
    : [];
  const total = forestData ? forestItems.length : listData?.total ?? 0;
  const totalPages = forestData ? 1 : listData?.totalPages ?? 0;
  const tree = forestData ? buildEquipmentTree(forestItems) : [];

  const hrefFor = (nextPage: number) =>
    buildEquipmentListHref(filters, nextPage);

  return (
    <PageShell>
      {feedbackKey && <CustomerToast message={t(feedbackKey)} />}

      <PageHeader
        title={t("assets.list.title")}
        subtitle={t("assets.list.subtitle")}
        icon={<Icon name="wrench" className="h-5 w-5" />}
        actions={
          hasPermission(user, "equipment.manage") ? (
            <Link
              href="/enheter/ny"
              className={buttonClassName({ variant: "primary", size: "sm" })}
            >
              <Icon name="plus" className="h-4 w-4" />
              {t("assets.list.newAsset")}
            </Link>
          ) : undefined
        }
      />

      <Card as="section" className="min-w-0 p-4 sm:p-5" aria-labelledby="assets-filters">
        <h2 id="assets-filters" className="sr-only">
          {t("assets.list.searchLabel")}
        </h2>
        <form
          method="GET"
          action="/enheter"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {customerId && <input type="hidden" name="kunde" value={customerId} />}
          <Field
            id="assets-q"
            label={t("assets.list.searchLabel")}
            className="lg:col-span-2"
          >
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              />
              <Input
                id="assets-q"
                type="search"
                name="q"
                defaultValue={query}
                placeholder={t("assets.list.searchPlaceholder")}
                className="pl-9"
              />
            </div>
          </Field>
          <Field id="assets-status" label={t("assets.list.status")}>
            <Select
              id="assets-status"
              name="status"
              defaultValue={status || "ALL"}
            >
              <option value="ALL">{t("assets.list.allStatuses")}</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`assets.status.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="assets-category" label={t("assets.list.category")}>
            <Select
              id="assets-category"
              name="kategori"
              defaultValue={categoryId}
            >
              <option value="">{t("assets.list.allCategories")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <Icon name="search" className="h-4 w-4" />
              {t("assets.list.search")}
            </button>
            <Link
              href="/enheter"
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              {t("assets.list.reset")}
            </Link>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-ink">
              <input
                type="checkbox"
                name="hierarki"
                value="1"
                defaultChecked={hierarchy}
                className="h-5 w-5 rounded border-line"
              />
              {t("assets.list.hierarchy")}
            </label>
            <p className="ml-auto self-center text-xs text-muted">
              {hierarchy
                ? t("assets.list.hierarchyHint")
                : t("assets.list.showing", {
                    shown: listData?.items.length ?? 0,
                    total,
                  })}
            </p>
          </div>
        </form>
      </Card>

      {hierarchy && forestData?.truncated && (
        <p className="text-xs font-bold text-muted">
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
              <Link
                href="/enheter/ny"
                className={buttonClassName({ variant: "primary", size: "sm" })}
              >
                {t("assets.list.newAsset")}
              </Link>
            ) : undefined
          }
        />
      ) : hierarchy ? (
        <Card as="section" className="min-w-0 p-4 sm:p-5" aria-label={t("assets.list.hierarchy")}>
          <TreeBranch nodes={tree} />
        </Card>
      ) : (
        <section className="space-y-2" aria-live="polite">
          {(listData?.items ?? []).map((item) => (
            <Card key={item.id} as="article" className="min-w-0 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/enheter/${item.id}`}
                    className="text-base font-black text-ink underline decoration-signal decoration-2 underline-offset-4"
                  >
                    {item.model}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {item.serialNumber
                      ? t("assets.detail.serial") + `: ${item.serialNumber}`
                      : t("assets.detail.noSerial")}
                    {" · "}
                    {item.customer.name}
                    {item.location ? ` · ${item.location}` : ""}
                    {item.site ? ` · ${item.site.name}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-line bg-paper px-2 py-1 font-bold">
                    {t(`assets.status.${item.status}`)}
                  </span>
                  {item.category && (
                    <span className="rounded-full border border-line px-2 py-1 font-bold">
                      {item.category.name}
                    </span>
                  )}
                  <span className="text-muted">
                    {t("assets.detail.criticality")}:{" "}
                    {t(`assets.criticality.${item.criticality}`)}
                  </span>
                  {item.warrantyUntil && (
                    <span className="text-muted">
                      {t("assets.detail.warrantyUntil")}:{" "}
                      {formatDateLocalized(item.warrantyUntil, locale)}
                    </span>
                  )}
                  <Link
                    href={`/enheter/${item.id}`}
                    className={buttonClassName({ variant: "secondary", size: "sm" })}
                  >
                    {t("assets.list.open")}
                  </Link>
                </div>
              </div>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
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
                  {t("assets.list.serviceHistory")}: {item._count.reportUnits}
                </span>
              </p>
            </Card>
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
    </PageShell>
  );
}
