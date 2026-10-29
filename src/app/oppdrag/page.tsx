import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { readableTextColor } from "@/lib/colors";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Prisma, WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import StatusBadge from "@/components/StatusBadge";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import CustomerToast from "@/components/customer/CustomerToast";
import Pagination, { paginationLabels } from "@/components/Pagination";
import OrderViewTabs from "./ViewTabs";
import { formatAddress } from "@/lib/address";
import {
  addDaysUtc,
  formatDateRangeLocalized,
  parseDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import {
  workOrderListSearchWhere,
  workOrderTagWhere,
} from "@/lib/search-filters";
import { scheduledTodayWhere } from "@/lib/work-order-date-where";
import { searchWorkOrderIds } from "@/lib/search-sql";

// ---------------------------------------------------------------------------
// Hjelpere (utenfor komponenten slik at render forblir ren)
// ---------------------------------------------------------------------------

// Samme definisjoner som dashbordet bruker, slik at tallene stemmer.
// «Nye» er oppdrag som ennå ikke er planlagt eller satt i gang. Den er et
// bevisst snevrere utvalg enn «Aktive», som også tar med påbegynte oppdrag.
const NEW_STATUSES: WorkStatus[] = ["OPEN", "PENDING"];
const AWAITING_STATUSES: WorkStatus[] = ["OPEN", "PENDING", "PLANNED", "WAITING"];
const CLOSED_STATUSES: WorkStatus[] = ["COMPLETED", "CANCELLED"];
const PAGE_SIZE = 20;

type SortKey = "urgency" | "newest";

const SORT_OPTIONS: Array<{ key: SortKey; labelKey: string }> = [
  { key: "urgency", labelKey: "orders.list.sortUrgency" },
  { key: "newest", labelKey: "orders.list.sortNewest" },
];

const LIST_FEEDBACK_MESSAGE_KEYS: Record<string, string> = {
  slettet: "orders.feedback.deleted",
  gjenopprettet: "orders.feedback.restored",
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
  { key: "alle", labelKey: "orders.list.views.alle.label", icon: "📂", descriptionKey: "orders.list.views.alle.description" },
  {
    key: "apne",
    labelKey: "orders.list.views.apne.label",
    icon: "🆕",
    descriptionKey: "orders.list.views.apne.description",
  },
  {
    key: "venter",
    labelKey: "orders.list.views.venter.label",
    icon: "⏳",
    descriptionKey: "orders.list.views.venter.description",
  },
  {
    key: "pagaaende",
    labelKey: "orders.list.views.pagaaende.label",
    icon: "🛠️",
    descriptionKey: "orders.list.views.pagaaende.description",
  },
  {
    key: "idag",
    labelKey: "orders.list.views.idag.label",
    icon: "📅",
    descriptionKey: "orders.list.views.idag.description",
  },
  {
    key: "forfalte",
    labelKey: "orders.list.views.forfalte.label",
    icon: "⚠️",
    descriptionKey: "orders.list.views.forfalte.description",
  },
  {
    key: "ikke-tildelt",
    labelKey: "orders.list.views.ikke-tildelt.label",
    icon: "🙋",
    descriptionKey: "orders.list.views.ikke-tildelt.description",
  },
  {
    key: "fullforte",
    labelKey: "orders.list.views.fullforte.label",
    icon: "✅",
    descriptionKey: "orders.list.views.fullforte.description",
  },
  {
    key: "kansellerte",
    labelKey: "orders.list.views.kansellerte.label",
    icon: "🚫",
    descriptionKey: "orders.list.views.kansellerte.description",
  },
] as const;

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
      return { status: { in: NEW_STATUSES } };
    case "venter":
      return { status: { in: AWAITING_STATUSES } };
    case "pagaaende":
      return { status: "IN_PROGRESS" };
    case "idag":
      // Tar med flerdagersoppdrag som er i gang i dag, men ikke avsluttede.
      // Streng `lt` mot neste dags midnatt – ellers teller morgendagens
      // oppdrag med når de starter kl. 00:00.
      return {
        status: { notIn: CLOSED_STATUSES },
        ...scheduledTodayWhere(startOfToday, endOfToday),
      };
    case "forfalte":
      return {
        scheduledFor: { lt: startOfToday },
        OR: [{ scheduledTo: null }, { scheduledTo: { lt: startOfToday } }],
        status: { notIn: CLOSED_STATUSES },
      };
    case "ikke-tildelt":
      return { technicians: { none: {} }, status: { notIn: CLOSED_STATUSES } };
    case "fullforte":
      return { status: "COMPLETED" };
    case "kansellerte":
      return { status: "CANCELLED" };
    default:
      // Standardoversikten viser aktive/kommende oppdrag. Fullførte og
      // kansellerte er historikk og vises bare i historikkfanene.
      return { status: { notIn: CLOSED_STATUSES } };
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
      technicians: { select: { name: true } },
      templates: { select: { id: true } },
      reports: { select: { id: true } },
      tags: { select: { id: true, name: true, color: true } },
    },
  });

  const countByStatus = (s: string) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const sumStatuses = (statuses: string[]) =>
    statuses.reduce((sum, s) => sum + countByStatus(s), 0);

  const viewCounts: Record<ViewKey, number> = {
    alle: statusGroups
      .filter((group) => !CLOSED_STATUSES.includes(group.status))
      .reduce((sum, group) => sum + group._count._all, 0),
    apne: sumStatuses(NEW_STATUSES),
    venter: sumStatuses(AWAITING_STATUSES),
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

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">
              {activeView.icon} {t(activeView.labelKey)}
            </h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              {t(activeView.descriptionKey)}
              {" • "}
              <span className="font-bold text-gray-700">
                {t("orders.list.total", { count: total })}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            {user.role === "ADMIN" && (
              <Link
                href="/oppdrag/slettede"
                className="flex-1 md:flex-none text-center bg-white border-2 border-amber-200 text-amber-900 px-4 py-2 rounded-xl text-sm font-bold hover:bg-amber-50 transition shadow-sm whitespace-nowrap"
              >
                🗑️ {t("orders.detail.deletedOrders")}
              </Link>
            )}
            <Link
              href="/"
              className="flex-1 md:flex-none text-center bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
            >
              {t("orders.list.backToDashboard")}
            </Link>
            {canCreate && (
              <Link
                href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
                className="flex-1 md:flex-none text-center bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
              >
                {t("orders.list.newWorkOrder")}
              </Link>
            )}
          </div>
        </div>

        {feedbackKey ? (
          <CustomerToast message={t(feedbackKey)} tone="success" />
        ) : null}
        <ErrorBanner message={errorKey ? t(errorKey) : undefined} />

        {/* FILTRE */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
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
              className="flex-1 min-w-[14rem] border-2 border-gray-200 p-2.5 rounded-xl text-sm font-medium text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
            />
            <button
              type="submit"
              className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition"
            >
              {t("orders.list.search")}
            </button>
            {search || tagFilter ? (
              <Link
                href={resetLinkFor()}
                className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
              >
                {t("orders.list.reset")}
              </Link>
            ) : null}
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-black uppercase tracking-wider text-gray-500">
              {t("orders.list.sortLabel")}
            </span>
            {SORT_OPTIONS.map((option) => {
              const active = sort === option.key;
              return (
                <Link
                  key={option.key}
                  href={sortLinkFor(option.key)}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-full border-2 px-3 py-1.5 font-bold transition ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {t(option.labelKey)}
                </Link>
              );
            })}
          </div>

          {tagFilter ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="bg-blue-50 border-2 border-blue-200 text-blue-900 px-3 py-1.5 rounded-xl font-bold">
                🏷️ {t("orders.list.filterTag", { tag: tagFilter })}
              </span>
              <Link
                href={linkFor(view, false)}
                className="text-blue-700 font-bold hover:underline"
              >
                {t("orders.list.clearTag")}
              </Link>
            </div>
          ) : null}
        </div>

        {/* LISTE */}
        {orders.length === 0 ? (
          <EmptyState
            icon="📂"
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
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
                >
                  {t("orders.list.reset")}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {orders.map((wo) => {
              const address = formatAddress(wo.customer);
              return (
              <Link
                key={wo.id}
                href={`/oppdrag/${wo.id}`}
                className="block bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-gray-900 truncate">{wo.title}</p>
                      {wo.orderNumber ? (
                        <span className="text-[11px] font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                          {t("orders.list.orderNumber")} {wo.orderNumber}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      🏢 {wo.customer?.name || t("orders.list.noCustomer")}
                      {address ? ` • 📍 ${address}` : ""}
                      {" • 📅 "}
                      {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) || t("orders.list.noDate")}
                    </p>
                    {wo.tags && wo.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {wo.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="text-white px-2 py-0.5 rounded-full text-xs font-bold shadow-sm"
                            suppressHydrationWarning
                            style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
                          >
                            🏷️ {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={wo.status} />
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] font-bold">
                  <span className={wo.technicians.length === 0 ? "text-amber-700" : "text-gray-600"}>
                    {wo.technicians.length === 0
                      ? t("orders.list.unassigned")
                      : `👷 ${wo.technicians.map((tech) => tech.name).filter(Boolean).join(", ")}`}
                  </span>
                  <span className="text-gray-600">
                    {t("orders.list.checklists", {
                      done: wo.reports.length,
                      total: wo.templates.length,
                    })}
                  </span>
                  {wo.scheduledFor && new Date(wo.scheduledTo || wo.scheduledFor) < dates.startOfToday &&
                    !CLOSED_STATUSES.includes(wo.status) && (
                      <span className="text-red-700">{t("orders.list.overdue")}</span>
                    )}
                </div>
              </Link>
              );
            })}
          </div>
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
      </div>
    </div>
  );
}
