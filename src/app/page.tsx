import { Suspense } from "react";
import { redirect } from "next/navigation";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import { scheduledTodayWhere } from "@/lib/work-order-date-where";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { type Prisma, WorkStatus } from "@prisma/client";
import StatusBadge from "@/components/StatusBadge";
import KpiCard from "@/components/KpiCard";
import PageHeader from "@/components/PageHeader";
import SectionCard from "@/components/SectionCard";
import EmptyState from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { formatAddress } from "@/lib/address";
import {
  addDaysUtc,
  formatDateLocalized,
  formatDateRangeLocalized,
  formatDateTimeLocalized,
  parseDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { describeAuditAction, type AuditTranslator } from "@/lib/audit-actions";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";

// ------------------------------------------------------------------
// Hjelpere (definert utenfor komponenten slik at render forblir ren)
// ------------------------------------------------------------------

// Hvor mange oppdrag hvert handlingspanel viser før «se alle»-lenken tar over.
const QUEUE_LIMIT = 8;
const PAGE_SIZE = 10;
const AWAITING_STATUSES: WorkStatus[] = [
  "OPEN",
  "PENDING",
  "PLANNED",
  "WAITING",
];

// Dagens dato-grenser til bruk i spørringene. Kalenderdatoer er `date` i
// databasen, så grensene regnes som rene datoer i Oslo – ikke lokal tid på
// serveren, som kan være en annen tidssone.
function getDateContext() {
  const startOfToday = parseDateOnly(todayInOslo()) ?? new Date();
  const endOfToday = addDaysUtc(startOfToday, 1);
  const startOfMonth = new Date(
    Date.UTC(startOfToday.getUTCFullYear(), startOfToday.getUTCMonth(), 1),
  );
  return { startOfToday, endOfToday, startOfMonth };
}

type DateContext = ReturnType<typeof getDateContext>;

// Flerdagersoppdrag teller som «i dag» så lenge perioden dekker dagen.
function todayWhere(
  scope: Prisma.WorkOrderWhereInput,
  visibleStatus: Prisma.WorkOrderWhereInput,
  { startOfToday, endOfToday }: DateContext,
): Prisma.WorkOrderWhereInput {
  return {
    AND: [
      scope,
      visibleStatus,
      { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      scheduledTodayWhere(startOfToday, endOfToday),
    ],
  };
}

function overdueWhere(
  scope: Prisma.WorkOrderWhereInput,
  visibleStatus: Prisma.WorkOrderWhereInput,
  { startOfToday }: DateContext,
): Prisma.WorkOrderWhereInput {
  return {
    AND: [
      scope,
      visibleStatus,
      {
        scheduledFor: { lt: startOfToday },
        OR: [{ scheduledTo: null }, { scheduledTo: { lt: startOfToday } }],
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
    ],
  };
}

function unassignedWhere(
  scope: Prisma.WorkOrderWhereInput,
  visibleStatus: Prisma.WorkOrderWhereInput,
): Prisma.WorkOrderWhereInput {
  return {
    AND: [
      scope,
      visibleStatus,
      {
        technicians: { none: {} },
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
    ],
  };
}

type OrderWith = {
  id: string;
  title: string;
  status: string;
  scheduledFor: Date | null;
  scheduledTo?: Date | null;
  customer: {
    name: string;
    address?: string | null;
    postalCode?: string | null;
    city?: string | null;
  } | null;
  technicians: { name: string | null }[];
  tags?: { id: string; name: string; color?: string | null }[];
};

/**
 * Kompakt positiv tomtilstand. Wrapperen trimmer den delte EmptyState ned slik
 * at den passer inne i et handlingspanel uten å skyve resten av innholdet ned.
 */
function CompactEmptyState({
  icon = "✓",
  title,
}: {
  icon?: string;
  title: string;
}) {
  return (
    <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:px-1 [&>div]:py-4">
      <EmptyState icon={icon} title={title} />
    </div>
  );
}

// Kompakt oppdragsliste brukt i handlingspanelene. Listene er allerede
// begrenset av spørringene, så denne komponenten rendrer aldri ubegrenset data.
async function OrderList({
  orders,
  emptyTitle,
  emptyIcon = "✓",
  locale,
}: {
  orders: OrderWith[];
  emptyTitle: string;
  emptyIcon?: string;
  locale: string;
}) {
  const t = await getTranslations("common");
  if (orders.length === 0) {
    return <CompactEmptyState icon={emptyIcon} title={emptyTitle} />;
  }
  return (
    <div className="space-y-2">
      {orders.map((wo) => {
        const address = formatAddress(wo.customer);
        return (
          <Link
            key={wo.id}
            href={`/oppdrag/${wo.id}`}
            className="block bg-gray-50 hover:bg-blue-50/60 border border-gray-200 hover:border-blue-300 p-3 rounded-xl transition"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-gray-900 text-sm line-clamp-2">
                {wo.title}
              </span>
              <StatusBadge status={wo.status} />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              🏢 {wo.customer?.name || t("dashboard.orderList.noCustomer")} • 📅{" "}
              {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) ||
                t("dashboard.orderList.noDate")}
              {wo.technicians.length === 0
                ? ` • ${t("dashboard.orderList.unassigned")}`
                : ` • 👷 ${wo.technicians
                    .map((tech) => tech.name?.split(" ")[0])
                    .filter(Boolean)
                    .join(", ")}`}
            </p>
            {address && (
              <p className="text-xs text-gray-600 mt-0.5">📍 {address}</p>
            )}
            {wo.tags && wo.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {wo.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-2 py-0.5 rounded-full text-xs font-bold shadow-sm"
                    suppressHydrationWarning
                    style={{
                      backgroundColor: tag.color || "#3b82f6",
                      color: readableTextColor(tag.color || "#3b82f6"),
                    }}
                  >
                    🏷️ {tag.name}
                  </span>
                ))}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: "", labelKey: "dashboard.statusOptions.all" },
  { value: "OPEN", labelKey: "dashboard.statusOptions.open" },
  { value: "PENDING", labelKey: "dashboard.statusOptions.pending" },
  { value: "WAITING", labelKey: "dashboard.statusOptions.waiting" },
  { value: "IN_PROGRESS", labelKey: "dashboard.statusOptions.inProgress" },
  { value: "PLANNED", labelKey: "dashboard.statusOptions.planned" },
  { value: "COMPLETED", labelKey: "dashboard.statusOptions.completed" },
  { value: "CANCELLED", labelKey: "dashboard.statusOptions.cancelled" },
];

// Hurtighandlinger for kontoret.
const OFFICE_ACTIONS = [
  { href: "/oppdrag/ny", icon: "➕", labelKey: "dashboard.quickActions.newWorkOrder" },
  { href: "/kalender", icon: "📅", labelKey: "dashboard.quickActions.calendar" },
  { href: "/kart", icon: "🗺️", labelKey: "dashboard.quickActions.map" },
  { href: "/kalender/dispatch", icon: "🎛️", labelKey: "dashboard.quickActions.dispatch" },
  { href: "/kunder", icon: "🏢", labelKey: "dashboard.quickActions.customers" },
  { href: "/dokumenter", icon: "📚", labelKey: "dashboard.quickActions.documents" },
  { href: "/innstillinger?tab=maler", icon: "📋", labelKey: "dashboard.quickActions.checklists" },
  { href: "/innstillinger?tab=statistikk", icon: "📊", labelKey: "dashboard.quickActions.statistics" },
];

// Hurtighandlinger for montører: feltrelevante sider, ingen kontorverktøy.
const FIELD_ACTIONS = [
  { href: "/mine-oppdrag/ny", icon: "➕", labelKey: "dashboard.quickActions.newWorkOrder" },
  { href: "/mine-oppdrag", icon: "📋", labelKey: "dashboard.quickActions.myWorkOrders" },
  { href: "/oppdrag", icon: "📂", labelKey: "dashboard.quickActions.allWorkOrders" },
  { href: "/kalender", icon: "📅", labelKey: "dashboard.quickActions.calendar" },
  { href: "/kart", icon: "🗺️", labelKey: "dashboard.quickActions.map" },
  { href: "/kunder", icon: "🏢", labelKey: "dashboard.quickActions.customers" },
];

// ------------------------------------------------------------------
// Async seksjoner. Hver av dem eier spørringene sine, slik at de kan
// streame uavhengig av hverandre i stedet for å dele én stor Promise.all.
// ------------------------------------------------------------------

async function DashboardKpis({
  scope,
  visibleStatus,
  organisationScope,
  dateContext,
  locale,
}: {
  scope: Prisma.WorkOrderWhereInput;
  visibleStatus: Prisma.WorkOrderWhereInput;
  organisationScope: Prisma.CustomerWhereInput;
  dateContext: DateContext;
  locale: string;
}) {
  const t = await getTranslations("common");
  const { startOfToday, startOfMonth } = dateContext;

  const [
    statusGroups,
    todayCount,
    overdueCount,
    unassignedCount,
    reportsThisMonth,
    customerCount,
    unitCount,
  ] = await Promise.all([
    prisma.workOrder.groupBy({
      by: ["status"],
      where: {
        AND: [
          scope,
          visibleStatus,
          { status: { in: [...AWAITING_STATUSES, "IN_PROGRESS"] } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.workOrder.count({ where: todayWhere(scope, visibleStatus, dateContext) }),
    prisma.workOrder.count({ where: overdueWhere(scope, visibleStatus, dateContext) }),
    prisma.workOrder.count({ where: unassignedWhere(scope, visibleStatus) }),
    prisma.report.count({
      where: {
        deletedAt: null,
        completedAt: { gte: startOfMonth },
        workOrder: scope,
      },
    }),
    prisma.customer.count({ where: organisationScope }),
    prisma.product.count({ where: { customer: organisationScope } }),
  ]);

  const countByStatus = (status: WorkStatus) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const inProgressCount = countByStatus("IN_PROGRESS");
  const awaitingCount = AWAITING_STATUSES.reduce(
    (sum, status) => sum + countByStatus(status),
    0,
  );
  const dateLabel = formatDateLocalized(
    startOfToday,
    locale,
    undefined,
    t("dashboard.orderList.noDate"),
  );

  return (
    <>
      <section
        aria-labelledby="dashboard-exceptions-title"
        className="order-4 lg:order-2 lg:col-span-2"
      >
        <h2 id="dashboard-exceptions-title" className="sr-only">
          {t("dashboard.primaryKpisTitle")}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            icon="⚠️"
            label={t("dashboard.kpi.overdue")}
            value={overdueCount}
            sub={t("dashboard.kpi.overdueSub")}
            tone={overdueCount > 0 ? "red" : "gray"}
            href="/oppdrag?vis=forfalte"
          />
          <KpiCard
            icon="📅"
            label={t("dashboard.kpi.today")}
            value={todayCount}
            sub={dateLabel}
            tone="blue"
            href="/oppdrag?vis=idag"
          />
          <KpiCard
            icon="🙋"
            label={t("dashboard.kpi.unassigned")}
            value={unassignedCount}
            sub={t("dashboard.kpi.unassignedSub")}
            tone={unassignedCount > 0 ? "amber" : "gray"}
            href="/oppdrag?vis=ikke-tildelt"
          />
          <KpiCard
            icon="🔄"
            label={t("dashboard.kpi.inProgress")}
            value={inProgressCount}
            sub={t("dashboard.kpi.awaiting", { count: awaitingCount })}
            tone="purple"
            href="/oppdrag?vis=pagaaende"
          />
        </div>
      </section>

      <section
        aria-labelledby="dashboard-key-figures-title"
        className="order-5 lg:order-4 lg:col-span-2"
      >
        <h2
          id="dashboard-key-figures-title"
          className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500"
        >
          {t("dashboard.keyFigures")}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <KpiCard
            compact
            icon="🏢"
            label={t("dashboard.kpi.customers")}
            value={customerCount}
            sub={t("dashboard.kpi.customersSub")}
            href="/kunder"
          />
          <KpiCard
            compact
            icon="🔧"
            label={t("dashboard.kpi.equipment")}
            value={unitCount}
            sub={t("dashboard.kpi.equipmentSub")}
          />
          <KpiCard
            compact
            icon="📋"
            label={t("dashboard.kpi.reports")}
            value={reportsThisMonth}
            sub={t("dashboard.kpi.reportsSub")}
            href="/rapporter"
          />
        </div>
      </section>
    </>
  );
}

async function DashboardActionQueue({
  scope,
  visibleStatus,
  dateContext,
  locale,
  canAssign,
}: {
  scope: Prisma.WorkOrderWhereInput;
  visibleStatus: Prisma.WorkOrderWhereInput;
  dateContext: DateContext;
  locale: string;
  canAssign: boolean;
}) {
  const t = await getTranslations("common");

  const [todayOrders, overdueOrders, unassignedOrders] = await Promise.all([
    prisma.workOrder.findMany({
      where: todayWhere(scope, visibleStatus, dateContext),
      orderBy: { scheduledFor: "asc" },
      take: QUEUE_LIMIT + 1,
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.workOrder.findMany({
      where: overdueWhere(scope, visibleStatus, dateContext),
      orderBy: { scheduledFor: "asc" },
      take: QUEUE_LIMIT + 1,
      include: { customer: true, technicians: true, tags: true },
    }),
    prisma.workOrder.findMany({
      where: unassignedWhere(scope, visibleStatus),
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
      take: QUEUE_LIMIT + 1,
      include: { customer: true, technicians: true, tags: true },
    }),
  ]);

  const todayVisible = todayOrders.slice(0, QUEUE_LIMIT);
  const overdueVisible = overdueOrders.slice(0, QUEUE_LIMIT);
  const unassignedVisible = unassignedOrders.slice(0, QUEUE_LIMIT);
  const overdueHasMore = overdueOrders.length > QUEUE_LIMIT;
  const unassignedHasMore = unassignedOrders.length > QUEUE_LIMIT;

  return (
    <>
      <SectionCard
        title={t("dashboard.todayTitle")}
        action={
          <Link
            href="/oppdrag?vis=idag"
            className="whitespace-nowrap text-[11px] font-bold text-blue-600 hover:underline"
          >
            {t("dashboard.todayViewAll")}
          </Link>
        }
        className="order-2 lg:order-3 border-2 border-gray-200"
      >
        <OrderList
          orders={todayVisible}
          emptyTitle={t("dashboard.todayEmpty")}
          locale={locale}
        />
      </SectionCard>

      <div className="order-3 lg:order-3 space-y-4">
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              {t("dashboard.overdueTitle")}
              {overdueOrders.length > 0 && (
                <span className="text-xs font-bold bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                  {overdueHasMore ? `${QUEUE_LIMIT}+` : overdueOrders.length}
                </span>
              )}
            </span>
          }
          action={
            <Link
              href="/oppdrag?vis=forfalte"
              className="whitespace-nowrap text-[11px] font-bold text-blue-600 hover:underline"
            >
              {t("dashboard.viewAll")}
            </Link>
          }
          className="border-2 border-gray-200"
        >
          <OrderList
            orders={overdueVisible}
            emptyTitle={t("dashboard.overdueEmpty")}
            locale={locale}
          />
        </SectionCard>

        <SectionCard
          title={
            <span className="flex items-center gap-2">
              {t("dashboard.unassignedTitle")}
              {unassignedOrders.length > 0 && (
                <span className="text-xs font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">
                  {unassignedHasMore ? `${QUEUE_LIMIT}+` : unassignedOrders.length}
                </span>
              )}
            </span>
          }
          action={
            canAssign ? (
              <Link
                href="/kalender/dispatch"
                className="whitespace-nowrap text-[11px] font-bold text-blue-600 hover:underline"
              >
                {t("dashboard.openDispatch")}
              </Link>
            ) : (
              <Link
                href="/oppdrag?vis=ikke-tildelt"
                className="whitespace-nowrap text-[11px] font-bold text-blue-600 hover:underline"
              >
                {t("dashboard.viewAll")}
              </Link>
            )
          }
          className="border-2 border-gray-200"
        >
          <OrderList
            orders={unassignedVisible}
            emptyTitle={t("dashboard.unassignedEmpty")}
            locale={locale}
          />
        </SectionCard>
      </div>
    </>
  );
}

async function DashboardLists({
  searchParams,
  scope,
  visibleStatus,
  canSeeCancelled,
  canViewAudit,
  canCreate,
  office,
  locale,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
  scope: Prisma.WorkOrderWhereInput;
  visibleStatus: Prisma.WorkOrderWhereInput;
  canSeeCancelled: boolean;
  canViewAudit: boolean;
  canCreate: boolean;
  office: boolean;
  locale: string;
}) {
  const t = await getTranslations("common");
  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q?.trim() || "";
  const rawStatus = resolvedParams.status?.trim() || "";
  const requestedStatus = Object.values(WorkStatus).includes(
    rawStatus as WorkStatus,
  )
    ? (rawStatus as WorkStatus)
    : undefined;
  // Kansellerte oppdrag er avsluttet og skal ikke vises til montørene.
  const statusFilter =
    !canSeeCancelled && requestedStatus === "CANCELLED"
      ? undefined
      : requestedStatus;
  const statusOptions = canSeeCancelled
    ? STATUS_OPTIONS
    : STATUS_OPTIONS.filter((option) => option.value !== "CANCELLED");

  const page = Math.max(
    1,
    parseInt(resolvedParams.page?.toString() || "1", 10) || 1,
  );
  const skip = (page - 1) * PAGE_SIZE;

  const listSearchWhere: Prisma.WorkOrderWhereInput = searchQuery
    ? {
        OR: [
          { title: { contains: searchQuery, mode: "insensitive" as const } },
          { description: { contains: searchQuery, mode: "insensitive" as const } },
          { customer: { name: { contains: searchQuery, mode: "insensitive" as const } } },
          { customer: { city: { contains: searchQuery, mode: "insensitive" as const } } },
          { customer: { address: { contains: searchQuery, mode: "insensitive" as const } } },
        ],
      }
    : {};
  // Fullførte og kansellerte oppdrag er historikk og skal ikke fylles inn i
  // den generelle oversikten. Velger man en av dem i statusfilteret, er det en
  // bevisst historikk-visning og da vises de.
  const explicitHistory =
    statusFilter === "COMPLETED" || statusFilter === "CANCELLED";
  const listWhere: Prisma.WorkOrderWhereInput = {
    AND: [
      scope,
      visibleStatus,
      explicitHistory ? {} : { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      statusFilter ? { status: statusFilter } : {},
      listSearchWhere,
    ],
  };

  const [listTotal, listOrders, recentLogs] = await Promise.all([
    prisma.workOrder.count({ where: listWhere }),
    // Denne listen er «siste oppdrag» – nyligst endret først. Dagens,
    // forfalte og ikke-tildelte oppdrag har egne paneler over.
    prisma.workOrder.findMany({
      where: listWhere,
      orderBy: [{ updatedAt: "desc" }],
      take: PAGE_SIZE,
      skip,
      include: {
        customer: true,
        technicians: true,
        tags: true,
        _count: { select: { reports: true } },
      },
    }),
    canViewAudit
      ? prisma.auditLog.findMany({
          where: {
            // Innlogging og 2FA er sikkerhetshendelser, ikke arbeidsaktivitet.
            // De vises i revisjonsloggen, men skal ikke fylle dashbordet.
            action: { notIn: ["Logget inn", "Logget inn med gjenopprettingskode"] },
          },
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : Promise.resolve([]),
  ]);

  const totalPages = Math.max(1, Math.ceil(listTotal / PAGE_SIZE));
  const listQuery = `${
    searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
  }${statusFilter ? `&status=${statusFilter}` : ""}`;

  return (
    <>
      <SectionCard
        title={t("dashboard.ordersTitle")}
        description={t("dashboard.ordersDescription")}
        action={
          <span className="whitespace-nowrap text-[11px] text-gray-600">
            {t("dashboard.hits", { count: listTotal })}
          </span>
        }
        className="order-7 lg:order-6 lg:col-span-2 border-2 border-gray-200"
      >
        <div className="space-y-4">
        <form
          method="GET"
          action="/"
          className="flex flex-col sm:flex-row gap-2 sm:gap-3"
        >
          <input
            type="text"
            name="q"
            aria-label={t("dashboard.searchPlaceholder")}
            defaultValue={searchQuery}
            placeholder={t("dashboard.searchPlaceholder")}
            className="flex-1 min-w-[200px] border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
          />
          <select
            name="status"
            aria-label={t("dashboard.statusFilterLabel")}
            defaultValue={statusFilter}
            className="border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-gray-900 text-white px-5 py-3 rounded-xl font-bold hover:bg-gray-800 transition shadow-sm whitespace-nowrap text-sm"
          >
            {t("dashboard.search")}
          </button>
          {(searchQuery || statusFilter) && (
            <Link
              href="/"
              className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition flex items-center justify-center whitespace-nowrap text-sm"
            >
              {t("dashboard.reset")}
            </Link>
          )}
        </form>

        {listOrders.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={t("dashboard.noMatches")}
            action={
              canCreate ? (
                <Link
                  href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
                  className="text-blue-600 font-bold hover:underline"
                >
                  {t("dashboard.createNew")}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {listOrders.map((wo) => (
              <Link
                key={wo.id}
                href={`/oppdrag/${wo.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 hover:bg-gray-50 transition gap-3 sm:gap-4 rounded-xl"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                    <h3 className="font-bold text-gray-900 text-base line-clamp-2">
                      {wo.title}
                    </h3>
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="text-xs text-gray-600">
                    🏢 {wo.customer?.name || t("dashboard.orderList.noCustomer")}{" "}
                    • 📅{" "}
                    {formatDateRangeLocalized(
                      wo.scheduledFor,
                      wo.scheduledTo,
                      locale,
                    ) || t("dashboard.orderList.noDate")}
                    {wo._count.reports > 0
                      ? ` • ${t("dashboard.checklists", {
                          count: wo._count.reports,
                        })}`
                      : ""}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-xs text-gray-600">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}
                  {wo.tags && wo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {wo.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 rounded-full text-xs font-bold shadow-sm"
                          suppressHydrationWarning
                          style={{
                            backgroundColor: tag.color || "#3b82f6",
                            color: readableTextColor(tag.color || "#3b82f6"),
                          }}
                        >
                          🏷️ {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="text-gray-600">
                    <p className="font-bold text-gray-700 text-xs uppercase tracking-wider">
                      {t("dashboard.technicians")}
                    </p>
                    <p className="truncate">
                      {wo.technicians.length > 0 ? (
                        wo.technicians
                          .map((tech) => tech.name?.split(" ")[0])
                          .filter(Boolean)
                          .join(", ")
                      ) : (
                        <span className="text-red-700 font-bold">
                          {t("dashboard.notAssigned")}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-gray-600 font-bold">&rarr;</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            {page > 1 && (
              <Link
                href={`/?page=${page - 1}${listQuery}`}
                className="text-blue-600 text-sm font-bold hover:underline whitespace-nowrap"
              >
                {t("dashboard.previous")}
              </Link>
            )}
            <span className="text-sm text-gray-600">
              {t("dashboard.page", { page, pages: totalPages })}
            </span>
            {page < totalPages && (
              <Link
                href={`/?page=${page + 1}${listQuery}`}
                className="text-blue-600 font-bold hover:underline text-sm whitespace-nowrap"
              >
                {t("dashboard.next")}
              </Link>
            )}
          </div>
        )}
        </div>
      </SectionCard>

      {canViewAudit && (
        <SectionCard
          title={t("dashboard.activityTitle")}
          action={
            <Link
              href="/innstillinger?tab=auditlog"
              className="text-[11px] font-bold text-blue-600 hover:underline"
            >
              {t("dashboard.viewAllActivity")}
            </Link>
          }
          className="order-8 lg:order-7 lg:col-span-2 border-2 border-gray-200"
        >
          {recentLogs.length === 0 ? (
            <CompactEmptyState
              icon="📭"
              title={t("dashboard.noActivity")}
            />
          ) : (
            <ol className="space-y-2">
              {recentLogs.map((log) => (
                <li key={log.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-gray-800 font-medium">
                      {describeAuditAction(
                        log.action,
                        t as unknown as AuditTranslator,
                      ) ?? log.action}
                    </p>
                    <p className="text-xs text-gray-600">
                      {log.userName || t("dashboard.unknownUser")} •{" "}
                      {formatDateTimeLocalized(log.createdAt, locale)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      )}
    </>
  );
}

// ------------------------------------------------------------------
// SkjelettFallbacks. De matcher seksjonenes form slik at layouten ikke
// hopper når de ekte dataene strømmer inn.
// ------------------------------------------------------------------

function KpiSectionFallback({ label }: { label: string }) {
  return (
    <>
      <section
        role="status"
        aria-label={label}
        className="order-4 lg:order-2 lg:col-span-2"
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      </section>
      <section
        role="status"
        aria-label={label}
        className="order-5 lg:order-4 lg:col-span-2"
      >
        <Skeleton className="mb-2 h-3 w-24" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      </section>
    </>
  );
}

function ActionQueueFallback({ label }: { label: string }) {
  return (
    <>
      <section
        role="status"
        aria-label={label}
        className="order-2 lg:order-3 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200"
      >
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      </section>
      <div className="order-3 lg:order-3 space-y-4">
        {Array.from({ length: 2 }).map((_, index) => (
          <section
            key={index}
            role="status"
            aria-label={label}
            className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200"
          >
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-4 h-16" />
          </section>
        ))}
      </div>
    </>
  );
}

function ListSectionFallback({ label }: { label: string }) {
  return (
    <section
      role="status"
      aria-label={label}
      className="order-7 lg:order-6 lg:col-span-2 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-3 h-10" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>
    </section>
  );
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const t = await getTranslations("common");
  const locale = await getLocale();

  // Dashbordet bygger på oppdrag. En bruker med utvidede rettigheter, men uten
  // oppdragstilgang, sendes til den første siden vedkommende faktisk kan bruke.
  if (!hasPermission(user, "workorders.view")) {
    if (user.role === "CUSTOMER") redirect("/kundeportal");
    if (hasPermission(user, "customers.view")) redirect("/kunder");
    if (hasPermission(user, "documents.view")) redirect("/dokumenter");
    if (hasPermission(user, "equipment.view")) redirect("/kunder");
    if (hasPermission(user, "reports.view")) redirect("/rapporter");
    if (hasPermission(user, "users.view")) redirect("/innstillinger?tab=ansatte");
    redirect("/kundeportal");
  }

  // Dashbordet er felles for kontor og montører. Montørene ser de samme
  // tallene og listene, men hurtighandlingene peker til feltportalen deres.
  const office = user.role === "ADMIN" || user.role === "OFFICE";
  const canCreate = hasPermission(user, "workorders.create");
  const canSeeCancelled = user.role !== "TECHNICIAN";
  const canViewAudit = hasPermission(user, "audit.view");
  const canAssign = hasPermission(user, "workorders.assign");

  // Vis bare hurtighandlinger brukeren faktisk har tilgang til.
  const allowedHrefs = new Set<string>([
    "/kalender",
    "/kart",
    "/oppdrag",
    "/mine-oppdrag",
  ]);
  if (canCreate) {
    allowedHrefs.add("/oppdrag/ny");
    allowedHrefs.add("/mine-oppdrag/ny");
  }
  if (hasPermission(user, "workorders.assign")) {
    allowedHrefs.add("/kalender/dispatch");
  }
  if (hasPermission(user, "customers.view")) allowedHrefs.add("/kunder");
  if (hasPermission(user, "documents.view")) allowedHrefs.add("/dokumenter");
  if (hasPermission(user, "templates.manage")) {
    allowedHrefs.add("/innstillinger?tab=maler");
  }
  if (hasPermission(user, "reports.view")) {
    allowedHrefs.add("/innstillinger?tab=statistikk");
  }
  const quickActions = (office ? OFFICE_ACTIONS : FIELD_ACTIONS).filter((a) =>
    allowedHrefs.has(a.href),
  );

  const visibleStatus: Prisma.WorkOrderWhereInput = canSeeCancelled
    ? {}
    : { status: { not: "CANCELLED" } };
  const scope = workOrderScope(user);
  // Kunde- og enhets-KPI-ene skal følge samme avdelingssperre som oppdragene.
  // Administrator ser hele organisasjonen; andre ser egen avdeling.
  const organisationScope: Prisma.CustomerWhereInput = {
    deletedAt: null,
    ...(user.role === "ADMIN"
      ? {}
      : user.departmentId
        ? { departmentId: user.departmentId }
        : { id: { in: [] } }),
  };

  const branding = await prisma.branding.findFirst();
  const companyName = branding?.companyName || "FSM System";
  const dateContext = getDateContext();
  const loadingLabel = t("components.skeleton.loading");

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-2">
        {/* HEADER */}
        <header className="order-1 lg:col-span-2">
          <PageHeader
            title={t("dashboard.greeting", {
              name: user?.name?.split(" ")[0] || t("admin"),
            })}
            subtitle={
              <>
                <span className="hidden sm:inline">
                  {t("dashboard.adminOf", { companyName })} •{" "}
                </span>
                {formatDateLocalized(
                  dateContext.startOfToday,
                  locale,
                  undefined,
                  t("dashboard.orderList.noDate"),
                )}
              </>
            }
            actions={
              <div className="flex flex-wrap gap-2">
                {canCreate && (
                  <Link
                    href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
                    className="bg-[var(--primary-color)] text-white px-3 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition shadow-sm whitespace-nowrap sm:px-4"
                  >
                    {t("dashboard.newWorkOrder")}
                  </Link>
                )}
                <Link
                  href="/kalender"
                  className="bg-white border-2 border-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap sm:px-4"
                >
                  {t("dashboard.calendar")}
                </Link>
              </div>
            }
          />
        </header>

        {/* På mobil: dagens oppdrag først, deretter forfalte/ikke-tildelte.
            På desktop løfter KPI-ene seg øverst via `lg:order`. */}
        <Suspense fallback={<ActionQueueFallback label={loadingLabel} />}>
          <DashboardActionQueue
            scope={scope}
            visibleStatus={visibleStatus}
            dateContext={dateContext}
            locale={locale}
            canAssign={canAssign}
          />
        </Suspense>

        <Suspense fallback={<KpiSectionFallback label={loadingLabel} />}>
          <DashboardKpis
            scope={scope}
            visibleStatus={visibleStatus}
            organisationScope={organisationScope}
            dateContext={dateContext}
            locale={locale}
          />
        </Suspense>

        {/* HURTIGHANDLINGER – bevisst under køen og nøkkeltallene. */}
        <SectionCard
          title={
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600">
              {t("dashboard.quickActionsTitle")}
            </span>
          }
          className="order-6 lg:order-5 lg:col-span-2 border-2 border-gray-200"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-2 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-800 transition"
              >
                <span className="text-base leading-none">{action.icon}</span>
                <span className="truncate">{t(action.labelKey)}</span>
              </Link>
            ))}
          </div>
        </SectionCard>

        <Suspense fallback={<ListSectionFallback label={loadingLabel} />}>
          <DashboardLists
            searchParams={searchParams}
            scope={scope}
            visibleStatus={visibleStatus}
            canSeeCancelled={canSeeCancelled}
            canViewAudit={canViewAudit}
            canCreate={canCreate}
            office={office}
            locale={locale}
          />
        </Suspense>
      </div>
    </div>
  );
}
