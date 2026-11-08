import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { readableTextColor } from "@/lib/colors";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Prisma, WorkStatus } from "@prisma/client";
import { statusKeysByCategory } from "@/lib/work-order-status";
import prisma from "@/lib/prisma";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import CustomerToast from "@/components/customer/CustomerToast";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { buttonClassName } from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import Pagination, { paginationLabels } from "@/components/Pagination";
import Icon, { type IconName } from "@/components/icons";
import OrderViewTabs from "./ViewTabs";
import { quickAssignTechnician } from "./assign-actions";
import { formatAddress } from "@/lib/address";
import {
  addDaysUtc,
  formatDateRangeLocalized,
  parseDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";
import {
  workOrderListSearchWhere,
  workOrderTagWhere,
} from "@/lib/search-filters";
import { scheduledTodayWhere } from "@/lib/work-order-date-where";
import { searchWorkOrderIds } from "@/lib/search-sql";

// ---------------------------------------------------------------------------
// Hjelpere (utenfor komponenten slik at render forblir ren)
// ---------------------------------------------------------------------------

// Statusgruppene leses fra det administrative oppsettet. «Nye» er åpne
// statuser; «venter» tar med både åpne og planlagte. Lukkede statuser er de
// administratoren har markert som lukket.
function newStatuses(): WorkStatus[] {
  return statusKeysByCategory("OPEN");
}
function awaitingStatuses(): WorkStatus[] {
  return [...statusKeysByCategory("OPEN"), ...statusKeysByCategory("PLANNED")];
}
function closedStatuses(): WorkStatus[] {
  return statusKeysByCategory("CLOSED");
}
const PAGE_SIZE = 20;

type SortKey = "urgency" | "newest";

const SORT_OPTIONS: Array<{ key: SortKey; labelKey: string }> = [
  { key: "urgency", labelKey: "orders.list.sortUrgency" },
  { key: "newest", labelKey: "orders.list.sortNewest" },
];

const LIST_FEEDBACK_MESSAGE_KEYS: Record<string, string> = {
  slettet: "orders.feedback.deleted",
  gjenopprettet: "orders.feedback.restored",
  montor: "orders.feedback.assigned",
};

const LIST_ERROR_MESSAGE_KEYS: Record<string, string> = {
  "ugyldig-data": "orders.errors.invalidData",
  "ikke-tilgang": "orders.errors.forbidden",
  "ikke-funnet": "orders.errors.notFound",
  "workorder-locked": "orders.errors.workOrderLocked",
  "legal-hold": "orders.errors.legalHold",
  ukjent: "orders.errors.generic",
};

function isSortKey(value: string | undefined): value is SortKey {
  return value === "urgency" || value === "newest";
}

function defaultSortFor(view: ViewKey): SortKey {
  return view === "fullforte" || view === "kansellerte" ? "newest" : "urgency";
}

// Samme datogrenser som dashbordet: rene kalenderdatoer i Oslo, ikke
// serverens lokale tidssone. Ellers kan «i dag» bli feil rundt midnatt.
function getDateContext() {
  const startOfToday = parseDateOnly(todayInOslo()) ?? new Date();
  const endOfToday = addDaysUtc(startOfToday, 1);
  return { startOfToday, endOfToday };
}

/**
 * De filtrerte visningene av oppdragslisten. Dashbordets tallkort lenker hit,
 * slik at man ser nøyaktig de oppdragene tallet gjelder.
 */
const VIEWS = [
  { key: "alle", labelKey: "orders.list.views.alle.label", icon: "clipboard", descriptionKey: "orders.list.views.alle.description" },
  {
    key: "apne",
    labelKey: "orders.list.views.apne.label",
    icon: "plus",
    descriptionKey: "orders.list.views.apne.description",
  },
  {
    key: "venter",
    labelKey: "orders.list.views.venter.label",
    icon: "clock",
    descriptionKey: "orders.list.views.venter.description",
  },
  {
    key: "pagaaende",
    labelKey: "orders.list.views.pagaaende.label",
    icon: "wrench",
    descriptionKey: "orders.list.views.pagaaende.description",
  },
  {
    key: "idag",
    labelKey: "orders.list.views.idag.label",
    icon: "calendar",
    descriptionKey: "orders.list.views.idag.description",
  },
  {
    key: "forfalte",
    labelKey: "orders.list.views.forfalte.label",
    icon: "alert",
    descriptionKey: "orders.list.views.forfalte.description",
  },
  {
    key: "ikke-tildelt",
    labelKey: "orders.list.views.ikke-tildelt.label",
    icon: "users",
    descriptionKey: "orders.list.views.ikke-tildelt.description",
  },
  {
    key: "fullforte",
    labelKey: "orders.list.views.fullforte.label",
    icon: "check",
    descriptionKey: "orders.list.views.fullforte.description",
  },
  {
    key: "kansellerte",
    labelKey: "orders.list.views.kansellerte.label",
    icon: "close",
    descriptionKey: "orders.list.views.kansellerte.description",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  labelKey: string;
  icon: IconName;
  descriptionKey: string;
}>;

type ViewKey = (typeof VIEWS)[number]["key"];

function isViewKey(value: string): value is ViewKey {
  return VIEWS.some((v) => v.key === value);
}

/** Spørringen bak hver visning – identisk med tallene på dashbordet. */
function whereFor(
  view: ViewKey,
  { startOfToday, endOfToday }: { startOfToday: Date; endOfToday: Date },
): Prisma.WorkOrderWhereInput {
  switch (view) {
    case "apne":
      // «Nye» er oppdrag som ikke er planlagt eller påbegynt ennå.
      return { status: { in: newStatuses() } };
    case "venter":
      return { status: { in: awaitingStatuses() } };
    case "pagaaende":
      return { status: "IN_PROGRESS" };
    case "idag":
      // Tar med flerdagersoppdrag som er i gang i dag, men ikke avsluttede.
      // Streng `lt` mot neste dags midnatt – ellers teller morgendagens
      // oppdrag med når de starter kl. 00:00.
      return {
        status: { notIn: closedStatuses() },
        ...scheduledTodayWhere(startOfToday, endOfToday),
      };
    case "forfalte":
      return {
        scheduledFor: { lt: startOfToday },
        OR: [{ scheduledTo: null }, { scheduledTo: { lt: startOfToday } }],
        status: { notIn: closedStatuses() },
      };
    case "ikke-tildelt":
      return { technicians: { none: {} }, status: { notIn: closedStatuses() } };
    case "fullforte":
      return { status: "COMPLETED" };
    case "kansellerte":
      return { status: "CANCELLED" };
    default:
      // Standardoversikten viser aktive/kommende oppdrag. Fullførte og
      // kansellerte er historikk og vises bare i historikkfanene.
      return { status: { notIn: closedStatuses() } };
  }
}

/**
 * Standardrekkefølgen er «haster først»: forfalte og dagens oppdrag før
 * framtidige, og udaterte helt til slutt. Historikkfanene viser nyeste først.
 * Brukeren kan velge «Nyeste først» for de aktive fanene også.
 */
function orderByFor(
  sort: SortKey,
): Prisma.WorkOrderOrderByWithRelationInput[] {
  if (sort === "newest") {
    return [{ createdAt: "desc" }];
  }
  return [
    { scheduledFor: { sort: "asc", nulls: "last" } },
    { createdAt: "desc" },
  ];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.oppdrag") };
}

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    vis?: string;
    q?: string;
    side?: string;
    tag?: string;
    sort?: string;
    error?: string;
    ok?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const t = await getTranslations("common");
  const locale = await getLocale();

  // Kontor og montører ser samme liste; montørene oppretter oppdrag i feltportalen.
  const office = user.role === "ADMIN" || user.role === "OFFICE";
  const canCreate = hasPermission(user, "workorders.create");
  const canAssign = hasPermission(user, "workorders.assign");

  const { vis, q, side, tag, sort: rawSort, error, ok } = await searchParams;
  const requestedView: ViewKey = vis && isViewKey(vis) ? vis : "alle";
  // Kansellerte oppdrag er historikk for kontoret; montørene skal ikke se dem.
  const view: ViewKey =
    !office && requestedView === "kansellerte" ? "alle" : requestedView;
  const sort: SortKey = isSortKey(rawSort) ? rawSort : defaultSortFor(view);
  const search = q?.trim() || "";
  const tagFilter = tag?.trim() || "";
  const requestedPage = Math.max(1, parseInt(side?.toString() || "1", 10) || 1);
  const feedbackKey = ok ? LIST_FEEDBACK_MESSAGE_KEYS[ok] : undefined;
  const errorKey = error
    ? (LIST_ERROR_MESSAGE_KEYS[error] ?? "orders.errors.generic")
    : undefined;

  const dates = getDateContext();

  // Normalisert treff i ordrenummer/tagger/kundefelt kan bare gjøres i SQL.
  // Id-ene intersects alltid med workOrderScope nedenfor.
  const smartSearchIds = search ? await searchWorkOrderIds(search) : [];

  const searchWhere: Prisma.WorkOrderWhereInput =
    workOrderListSearchWhere(search, smartSearchIds);
  const tagWhere: Prisma.WorkOrderWhereInput = workOrderTagWhere(tagFilter);
  const filters: Prisma.WorkOrderWhereInput = { AND: [searchWhere, tagWhere] };

  // Kansellerte oppdrag er avsluttet og vises ikke til montørene. Kontoret
  // trenger dem fortsatt for oppfølging og historikk. Avdelingsfilteret gjelder
  // uansett rolle; bare administrator ser oppdrag fra alle avdelinger.
  const visibleStatus: Prisma.WorkOrderWhereInput = {
    AND: [
      workOrderScope(user),
      office ? {} : { status: { not: "CANCELLED" } },
    ],
  };

  const activeWhere: Prisma.WorkOrderWhereInput = {
    AND: [visibleStatus, whereFor(view, dates), filters],
  };

  const [statusGroups, todayCount, overdueCount, unassignedCount, total] =
    await Promise.all([
      // Fanetallene må bruke nøyaktig samme filter som listen, ellers viser
      // f.eks. et søk uten treff fortsatt «Alle 5». `filters` inneholder bare
      // søk/tag – statusvalget ligger i `whereFor(view)` og skal ikke inn her.
      prisma.workOrder.groupBy({
        by: ["status"],
        where: { AND: [visibleStatus, filters] },
        _count: { _all: true },
      }),
      prisma.workOrder.count({
        where: { AND: [visibleStatus, whereFor("idag", dates), filters] },
      }),
      prisma.workOrder.count({
        where: { AND: [visibleStatus, whereFor("forfalte", dates), filters] },
      }),
      prisma.workOrder.count({
        where: { AND: [visibleStatus, whereFor("ikke-tildelt", dates), filters] },
      }),
      prisma.workOrder.count({ where: activeWhere }),
    ]);

  // En gammel `?side=999` skal lande på siste side, ikke en tom side.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const orders = await prisma.workOrder.findMany({
    where: activeWhere,
    orderBy: orderByFor(sort),
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
    include: {
      customer: { select: { name: true, address: true, postalCode: true, city: true } },
      site: { select: { name: true, address: true, postalCode: true, city: true } },
      technicians: { select: { name: true } },
      templates: { select: { id: true } },
      reports: { select: { id: true } },
      tags: { select: { id: true, name: true, color: true } },
    },
  });

  const staff = canAssign
    ? await prisma.user.findMany({
        where: staffScope(user),
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 200,
      })
    : [];

  const countByStatus = (s: string) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const sumStatuses = (statuses: string[]) =>
    statuses.reduce((sum, s) => sum + countByStatus(s), 0);

  const viewCounts: Record<ViewKey, number> = {
    alle: statusGroups
      .filter((group) => !closedStatuses().includes(group.status))
      .reduce((sum, group) => sum + group._count._all, 0),
    apne: sumStatuses(newStatuses()),
    venter: sumStatuses(awaitingStatuses()),
    pagaaende: countByStatus("IN_PROGRESS"),
    idag: todayCount,
    forfalte: overdueCount,
    "ikke-tildelt": unassignedCount,
    fullforte: countByStatus("COMPLETED"),
    kansellerte: countByStatus("CANCELLED"),
  };

  const availableViews = office
    ? VIEWS
    : VIEWS.filter((v) => v.key !== "kansellerte");
  const activeView = availableViews.find((v) => v.key === view)!;

  const linkFor = (key: ViewKey, includeTag = true) => {
    const params = new URLSearchParams();
    if (key !== "alle") params.set("vis", key);
    if (search) params.set("q", search);
    if (includeTag && tagFilter) params.set("tag", tagFilter);
    // Bevar et eksplisitt sorteringsvalg når brukeren bytter visning.
    if (isSortKey(rawSort)) params.set("sort", rawSort);
    const qs = params.toString();
    return `/oppdrag${qs ? `?${qs}` : ""}`;
  };

  const listReturnTo = linkFor(view);

  const sortLinkFor = (key: SortKey) => {
    const params = new URLSearchParams();
    if (view !== "alle") params.set("vis", view);
    if (search) params.set("q", search);
    if (tagFilter) params.set("tag", tagFilter);
    if (key !== defaultSortFor(view)) params.set("sort", key);
    const qs = params.toString();
    return `/oppdrag${qs ? `?${qs}` : ""}`;
  };

  /** Nullstiller søk og tag, men beholder visning og et eksplisitt sorteringsvalg. */
  const resetLinkFor = () => {
    const params = new URLSearchParams();
    if (view !== "alle") params.set("vis", view);
    if (isSortKey(rawSort)) params.set("sort", rawSort);
    const qs = params.toString();
    return `/oppdrag${qs ? `?${qs}` : ""}`;
  };

  const tagChips = (
    tags: { id: string; name: string; color: string | null }[],
  ) =>
    tags.map((tag) => (
      <span
        key={tag.id}
        className="rounded-full px-1.5 py-0.5 text-xs font-bold"
        suppressHydrationWarning
        style={{
          backgroundColor: tag.color || "#3b82f6",
          color: readableTextColor(tag.color || "#3b82f6"),
        }}
      >
        {tag.name}
      </span>
    ));

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("metadata.routes.oppdrag")}
        title={t(activeView.labelKey)}
        subtitle={
          <>
            {t(activeView.descriptionKey)}
            <span className="type-meta type-tabular ml-1 inline-block">
              {t("orders.list.total", { count: total })}
            </span>
          </>
        }
        actions={
          <>
            {user.role === "ADMIN" && (
              <Link
                href="/oppdrag/slettede"
                className={`${buttonClassName({ variant: "danger-outline", size: "sm" })} flex-1 md:flex-none`}
              >
                {t("orders.detail.deletedOrders")}
              </Link>
            )}
            <Link
              href="/"
              className={`${buttonClassName({ variant: "secondary", size: "sm" })} flex-1 md:flex-none`}
            >
              {t("orders.list.backToDashboard")}
            </Link>
            {canCreate && (
              <Link
                href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
                className={`${buttonClassName({ variant: "primary", size: "sm" })} flex-1 md:flex-none`}
              >
                {t("orders.list.newWorkOrder")}
              </Link>
            )}
          </>
        }
      />

      {feedbackKey ? (
        <CustomerToast message={t(feedbackKey)} tone="success" />
      ) : null}
      <ErrorBanner message={errorKey ? t(errorKey) : undefined} />

      {/* FILTRE */}
      <Card as="section" className="space-y-3 p-3 sm:p-4">
        <OrderViewTabs
          ariaLabel={t("orders.list.viewsLabel")}
          activeKey={view}
          tabs={availableViews.map((v) => ({
            key: v.key,
            label: t(v.labelKey),
            icon: v.icon,
            count: viewCounts[v.key],
            href: linkFor(v.key),
          }))}
        />

        <form method="GET" action="/oppdrag" className="flex flex-wrap gap-2">
          <input type="hidden" name="vis" value={view} />
          {tagFilter ? <input type="hidden" name="tag" value={tagFilter} /> : null}
          {isSortKey(rawSort) ? (
            <input type="hidden" name="sort" value={rawSort} />
          ) : null}
          <input
            type="search"
            name="q"
            aria-label={t("orders.list.search")}
            defaultValue={search}
            placeholder={t("orders.list.searchPlaceholder")}
            className="min-w-[14rem] flex-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm font-medium text-[var(--ink,#101310)] outline-none transition placeholder:text-[#6b6559] focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
          <button
            type="submit"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            {t("orders.list.search")}
          </button>
          {search || tagFilter ? (
            <Link
              href={resetLinkFor()}
              prefetch={false}
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              {t("orders.list.reset")}
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="type-eyebrow text-[var(--muted,#62685f)]">
            {t("orders.list.sortLabel")}
          </span>
          {SORT_OPTIONS.map((option) => {
            const active = sort === option.key;
            return (
              <Link
                key={option.key}
                href={sortLinkFor(option.key)}
                prefetch={false}
                aria-current={active ? "true" : undefined}
                className={`type-ui rounded-full border px-3 py-1.5 transition ${
                  active
                    ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                    : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]"
                }`}
              >
                {t(option.labelKey)}
              </Link>
            );
          })}
        </div>

        {tagFilter ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="type-ui rounded-full border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] px-3 py-1.5 text-[var(--warning-text,#7a4f0c)]">
              {t("orders.list.filterTag", { tag: tagFilter })}
            </span>
            <Link
              href={linkFor(view, false)}
              prefetch={false}
              className="type-ui text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
            >
              {t("orders.list.clearTag")}
            </Link>
          </div>
        ) : null}
      </Card>

      {/* LISTE */}
      {orders.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            variant="plain"
            icon={<Icon name="check" className="h-8 w-8" />}
            title={t("orders.list.emptyTitle")}
            description={
              search
                ? t("orders.list.emptySearch", { query: search })
                : tagFilter
                  ? t("orders.list.emptyTag", { tag: tagFilter })
                  : t("orders.list.emptyHint")
            }
            action={
              search || tagFilter ? (
                <Link
                  href={resetLinkFor()}
                  prefetch={false}
                  className={buttonClassName({ variant: "primary", size: "sm" })}
                >
                  {t("orders.list.reset")}
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {/* Desktop: tett tabell inne i ett office-kort. */}
          <Card as="section" className="hidden overflow-hidden md:block">
            <div
              className="overflow-x-auto"
              role="region"
              aria-label={t(activeView.labelKey)}
              tabIndex={0}
            >
              <table className="office-table">
                <thead>
                  <tr>
                    {[
                      t("orders.list.table.date"),
                      t("orders.list.table.order"),
                      t("orders.list.table.status"),
                      t("orders.list.table.technician"),
                      t("orders.list.table.tags"),
                      t("orders.list.table.action"),
                    ].map((label, index) => (
                      <th
                        key={label}
                        scope="col"
                        style={{ textAlign: index === 5 ? "right" : "left" }}
                        className="whitespace-nowrap"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((wo) => {
                    const address = wo.site
                      ? formatAddress(wo.site)
                      : formatAddress(wo.customer);
                    const scheduledEnd = wo.scheduledTo ?? wo.scheduledFor;
                    const overdue =
                      scheduledEnd !== null &&
                      scheduledEnd < dates.startOfToday &&
                      !closedStatuses().includes(wo.status);
                    return (
                      <tr key={wo.id} className="transition">
                        <td className="whitespace-nowrap px-3 py-2 align-top">
                          <span className="block text-xs font-bold tabular-nums">
                            {formatDateRangeLocalized(
                              wo.scheduledFor,
                              wo.scheduledTo,
                              locale,
                            ) || t("orders.list.noDate")}
                          </span>
                          {overdue ? (
                            <span className="mt-0.5 block text-xs font-bold text-[var(--risk-text,#b42318)]">
                              {t("orders.list.overdue")}
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-[22rem] px-3 py-2 align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link
                              href={`/oppdrag/${wo.id}`}
                              prefetch={false}
                              className="line-clamp-2 font-bold leading-5 text-[var(--ink,#101310)] hover:underline"
                            >
                              {wo.title}
                            </Link>
                            <span className="type-micro whitespace-nowrap rounded border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 text-[var(--muted,#62685f)]">
                              {t("orders.list.reference")} {wo.reference}
                            </span>
                            {wo.orderNumber ? (
                              <span className="type-micro whitespace-nowrap rounded border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 text-[var(--muted,#62685f)]">
                                {t("orders.list.orderNumber")} {wo.orderNumber}
                              </span>
                            ) : null}
                          </div>
                          <p className="type-micro mt-0.5 truncate text-[var(--muted,#62685f)]">
                            {wo.customer?.name || t("orders.list.noCustomer")}
                            {wo.site ? ` · ${wo.site.name}` : ""}
                            {address ? ` · ${address}` : ""}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-top">
                          <StatusBadge status={wo.status} />
                        </td>
                        <td className="max-w-[15rem] px-3 py-2 align-top text-xs">
                          {wo.technicians.length > 0 ? (
                            <span className="block truncate font-bold">
                              {wo.technicians
                                .map((tech) => tech.name)
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          ) : canAssign ? (
                            <form
                              action={quickAssignTechnician}
                              className="flex min-w-0 flex-wrap items-center gap-1"
                            >
                              <input
                                type="hidden"
                                name="workOrderId"
                                value={wo.id}
                              />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={listReturnTo}
                              />
                              <span className="w-full font-bold text-[var(--risk-text,#b42318)]">
                                {t("orders.list.unassigned")}
                              </span>
                              <select
                                name="technicianId"
                                required
                                defaultValue=""
                                aria-label={t("orders.list.chooseTechnician")}
                                className="min-h-9 min-w-0 max-w-full flex-1 rounded-md border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 text-xs text-[var(--ink,#101310)]"
                              >
                                <option value="" disabled>
                                  {t("orders.list.chooseTechnician")}
                                </option>
                                {staff.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name || member.id}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className={buttonClassName({
                                  variant: "secondary",
                                  size: "sm",
                                })}
                              >
                                {t("orders.list.assign")}
                              </button>
                            </form>
                          ) : (
                            <span className="font-bold text-[var(--risk-text,#b42318)]">
                              {t("orders.list.unassigned")}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[12rem] px-3 py-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            {wo.tags.length > 0 ? (
                              tagChips(wo.tags)
                            ) : (
                              <span className="text-xs text-[var(--muted,#62685f)] opacity-60">—</span>
                            )}
                          </div>
                          <span className="type-micro mt-0.5 block text-[var(--muted,#62685f)]">
                            {t("orders.list.checklists", {
                              done: wo.reports.length,
                              total: wo.templates.length,
                            })}
                          </span>
                        </td>
                        <td
                          className="whitespace-nowrap"
                          style={{ textAlign: "right" }}
                        >
                          <Link
                            href={`/oppdrag/${wo.id}`}
                            prefetch={false}
                            className={buttonClassName({
                              variant: "secondary",
                              size: "sm",
                            })}
                          >
                            {t("orders.list.openOrder")}
                            <Icon name="arrowRight" className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobil: kompakte rader i stedet for tabell. */}
          <Card as="section" className="overflow-hidden md:hidden">
            <div className="divide-y divide-[var(--line,#dedcd1)]">
              {orders.map((wo) => {
                const address = wo.site
                  ? formatAddress(wo.site)
                  : formatAddress(wo.customer);
                const scheduledEnd = wo.scheduledTo ?? wo.scheduledFor;
                const overdue =
                  scheduledEnd !== null &&
                  scheduledEnd < dates.startOfToday &&
                  !closedStatuses().includes(wo.status);
                return (
                  <div key={wo.id}>
                    <Link
                      href={`/oppdrag/${wo.id}`}
                      prefetch={false}
                      className="block px-3 py-2.5 transition hover:bg-[var(--paper,#f2efe6)]/60"
                    >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className={`text-xs font-bold tabular-nums ${
                            overdue
                              ? "text-[var(--risk-text,#b42318)]"
                              : "text-[var(--muted,#62685f)]"
                          }`}
                        >
                          {formatDateRangeLocalized(
                            wo.scheduledFor,
                            wo.scheduledTo,
                            locale,
                          ) || t("orders.list.noDate")}
                          {overdue ? ` · ${t("orders.list.overdue")}` : ""}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-sm font-bold leading-5">
                          {wo.title}
                        </p>
                        <p className="truncate text-xs text-[var(--muted,#62685f)]">
                          {wo.customer?.name || t("orders.list.noCustomer")}
                          {wo.site ? ` · ${wo.site.name}` : ""}
                          {address ? ` · ${address}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={wo.status} />
                    </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold">
                        <span
                          className={
                            wo.technicians.length === 0
                              ? "text-[var(--risk-text,#b42318)]"
                              : "text-[var(--ink,#101310)]"
                          }
                        >
                          {wo.technicians.length === 0
                            ? t("orders.list.unassigned")
                            : wo.technicians
                                .map((tech) => tech.name)
                                .filter(Boolean)
                                .join(", ")}
                        </span>
                        <span className="text-[var(--muted,#62685f)]">
                          {t("orders.list.checklists", {
                            done: wo.reports.length,
                            total: wo.templates.length,
                          })}
                        </span>
                      </div>
                      {wo.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tagChips(wo.tags)}
                        </div>
                      ) : null}
                      <span className="mt-1 block text-right text-xs font-bold text-[var(--ink,#101310)]">
                        {t("orders.list.openOrder")}
                        <Icon name="arrowRight" className="ml-1 inline-block h-3.5 w-3.5 align-[-0.125em]" />
                      </span>
                      </Link>
                      {canAssign && wo.technicians.length === 0 && (
                        <form
                          action={quickAssignTechnician}
                          className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5"
                        >
                          <input type="hidden" name="workOrderId" value={wo.id} />
                          <input type="hidden" name="returnTo" value={listReturnTo} />
                          <select
                            name="technicianId"
                            required
                            defaultValue=""
                            aria-label={t("orders.list.chooseTechnician")}
                            className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2 text-xs font-medium text-[var(--ink,#101310)]"
                          >
                            <option value="" disabled>
                              {t("orders.list.chooseTechnician")}
                            </option>
                            {staff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name || member.id}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className={buttonClassName({
                              variant: "secondary",
                              size: "sm",
                            })}
                          >
                            {t("orders.list.assign")}
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
          </Card>
        </>
      )}

      {/* SIDEBLADDRING */}
      <Pagination
        page={page}
        totalPages={totalPages}
        hrefFor={(targetPage) => {
          const base = linkFor(view);
          if (targetPage <= 1) return base;
          return `${base}${base.includes("?") ? "&" : "?"}side=${targetPage}`;
        }}
        labels={paginationLabels(t)}
        summary={t("orders.list.page", { page, pages: totalPages })}
        className="pt-2"
      />
    </PageShell>
  );
}
