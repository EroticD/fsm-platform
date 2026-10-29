import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
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
import { reportWorkOrderScope } from "@/lib/report-scope";
import { homePathForRole } from "@/lib/navigation";

// ------------------------------------------------------------------
// Hjelpere (definert utenfor komponenten slik at render forblir ren)
// ------------------------------------------------------------------

// Én samlet kø: forfalte først, deretter dagens og til slutt ikke-tildelte.
// Hvert oppdrag vises bare én gang, selv om det kvalifiserer for flere grupper.
const GROUP_LIMIT = 5;
const QUEUE_TOTAL_LIMIT = 15;
// Ikke-tildelte kan allerede stå i forfalt/dagens. Skann litt lenger ned i
// listen for å finne nok unike oppdrag til den siste gruppen.
const UNASSIGNED_SCAN_LIMIT = QUEUE_TOTAL_LIMIT + GROUP_LIMIT + 1;

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
};

type QueueKey = "overdue" | "today" | "unassigned";

type PriorityQueueGroup<T extends { id: string }> = {
  key: QueueKey;
  orders: T[];
  total: number;
  hasMore: boolean;
};

/**
 * Slår sammen de tre unntakslistene til én prioritert kø. Rekkefølgen er
 * forfalt → i dag → ikke tildelt, og et oppdrag som allerede er tatt med i en
 * høyere prioritet blir filtrert bort fra de lavere. Det gjør at det samme
 * oppdraget aldri vises i to grupper samtidig.
 */
export function buildPriorityQueue<T extends { id: string }>(
  sources: Record<QueueKey, T[]>,
  totals: Record<QueueKey, number>,
  limits: { perGroup: number; total: number } = {
    perGroup: GROUP_LIMIT,
    total: QUEUE_TOTAL_LIMIT,
  },
): PriorityQueueGroup<T>[] {
  const seen = new Set<string>();
  let remaining = limits.total;
  const keys: QueueKey[] = ["overdue", "today", "unassigned"];

  return keys.map((key) => {
    const take = Math.max(0, Math.min(limits.perGroup, remaining));
    const unique = sources[key].filter((order) => !seen.has(order.id));
    const orders = unique.slice(0, take);
    orders.forEach((order) => seen.add(order.id));
    remaining -= orders.length;
    return {
      key,
      orders,
      total: totals[key],
      hasMore: totals[key] > orders.length,
    };
  });
}

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

// Kompakt oppdragsliste for køen. Bevisst uten tag-chips og sekundære
// detaljer, slik at unntakene kan skannes raskt på både mobil og desktop.
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
        const technicians = wo.technicians
          .map((tech) => tech.name?.split(" ")[0])
          .filter(Boolean)
          .join(", ");
        return (
          <Link
            key={wo.id}
            href={`/oppdrag/${wo.id}`}
            className="block rounded-xl border border-gray-200 bg-gray-50 p-2.5 transition hover:border-blue-300 hover:bg-blue-50/60"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-sm font-bold text-gray-900">
                {wo.title}
              </span>
              <StatusBadge status={wo.status} />
            </div>
            <p className="mt-1 text-xs text-gray-600">
              🏢 {wo.customer?.name || t("dashboard.orderList.noCustomer")} • 📅{" "}
              {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) ||
                t("dashboard.orderList.noDate")}
              {technicians ? (
                <> • 👷 {technicians}</>
              ) : (
                <span className="font-bold text-red-700">
                  {" "}
                  • {t("dashboard.orderList.unassigned")}
                </span>
              )}
            </p>
            {address && (
              <p className="mt-0.5 truncate text-xs text-gray-500">
                📍 {address}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

type QuickAction = {
  href: string;
  icon: string;
  label: string;
  emphasis?: boolean;
};

// ------------------------------------------------------------------
// Async seksjoner. Hver av dem eier spørringene sine, slik at de kan
// streame uavhengig av hverandre i stedet for å dele én stor Promise.all.
// ------------------------------------------------------------------

/**
 * Unntaksstripen og den prioriterte køen. De hentes sammen slik at tallene
 * over køen alltid beskriver de samme listene som køen viser.
 */
async function DashboardOverview({
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
  const { startOfToday } = dateContext;

  const [
    statusGroups,
    todayCount,
    overdueCount,
    unassignedCount,
    overdueOrders,
    todayOrders,
    unassignedOrders,
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
    prisma.workOrder.findMany({
      where: overdueWhere(scope, visibleStatus, dateContext),
      orderBy: { scheduledFor: "asc" },
      take: GROUP_LIMIT,
      include: { customer: true, technicians: true },
    }),
    prisma.workOrder.findMany({
      where: todayWhere(scope, visibleStatus, dateContext),
      orderBy: { scheduledFor: "asc" },
      take: GROUP_LIMIT,
      include: { customer: true, technicians: true },
    }),
    prisma.workOrder.findMany({
      where: unassignedWhere(scope, visibleStatus),
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
      take: UNASSIGNED_SCAN_LIMIT,
      include: { customer: true, technicians: true },
    }),
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

  const groups = buildPriorityQueue(
    {
      overdue: overdueOrders,
      today: todayOrders,
      unassigned: unassignedOrders,
    },
    {
      overdue: overdueCount,
      today: todayCount,
      unassigned: unassignedCount,
    },
  );
  const visibleGroups = groups.filter((group) => group.orders.length > 0);

  const groupMeta: Record<
    QueueKey,
    { title: string; icon: string; badge: string; href: string; action: string }
  > = {
    overdue: {
      title: t("dashboard.queue.overdue"),
      icon: "⚠️",
      badge: "bg-red-100 text-red-800",
      href: "/oppdrag?vis=forfalte",
      action: t("dashboard.queue.viewAllOverdue"),
    },
    today: {
      title: t("dashboard.queue.today"),
      icon: "📅",
      badge: "bg-blue-100 text-blue-800",
      href: "/oppdrag?vis=idag",
      action: t("dashboard.queue.viewAllToday"),
    },
    unassigned: {
      title: t("dashboard.queue.unassigned"),
      icon: "🙋",
      badge: "bg-amber-100 text-amber-900",
      href: canAssign ? "/kalender/dispatch" : "/oppdrag?vis=ikke-tildelt",
      action: canAssign
        ? t("dashboard.queue.openDispatch")
        : t("dashboard.queue.viewAllUnassigned"),
    },
  };

  return (
    <>
      <section aria-labelledby="dashboard-exceptions-title">
        <h2 id="dashboard-exceptions-title" className="sr-only">
          {t("dashboard.primaryKpisTitle")}
        </h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <KpiCard
            compact
            icon="⚠️"
            label={t("dashboard.kpi.overdue")}
            value={overdueCount}
            sub={t("dashboard.kpi.overdueSub")}
            tone={overdueCount > 0 ? "red" : "gray"}
            href="/oppdrag?vis=forfalte"
          />
          <KpiCard
            compact
            icon="📅"
            label={t("dashboard.kpi.today")}
            value={todayCount}
            sub={dateLabel}
            tone="blue"
            href="/oppdrag?vis=idag"
          />
          <KpiCard
            compact
            icon="🙋"
            label={t("dashboard.kpi.unassigned")}
            value={unassignedCount}
            sub={t("dashboard.kpi.unassignedSub")}
            tone={unassignedCount > 0 ? "amber" : "gray"}
            href="/oppdrag?vis=ikke-tildelt"
          />
          <KpiCard
            compact
            icon="🔄"
            label={t("dashboard.kpi.inProgress")}
            value={inProgressCount}
            sub={t("dashboard.kpi.awaiting", { count: awaitingCount })}
            tone="purple"
            href="/oppdrag?vis=pagaaende"
          />
        </div>
      </section>

      <SectionCard
        title={t("dashboard.queue.title")}
        description={t("dashboard.queue.description")}
        action={
          <Link
            href="/oppdrag"
            className="whitespace-nowrap text-xs font-bold text-blue-600 hover:underline"
          >
            {t("dashboard.allOrders")} →
          </Link>
        }
        className="border-2 border-gray-200"
      >
        {visibleGroups.length === 0 ? (
          <CompactEmptyState title={t("dashboard.queue.empty")} />
        ) : (
          <div className="space-y-5">
            {visibleGroups.map((group) => {
              const meta = groupMeta[group.key];
              return (
                <section
                  key={group.key}
                  aria-labelledby={`dashboard-queue-${group.key}`}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3
                      id={`dashboard-queue-${group.key}`}
                      className="flex items-center gap-2 text-sm font-bold text-gray-900"
                    >
                      <span aria-hidden="true">{meta.icon}</span>
                      {meta.title}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${meta.badge}`}
                      >
                        {group.total}
                      </span>
                    </h3>
                    <Link
                      href={meta.href}
                      className="whitespace-nowrap text-xs font-bold text-blue-600 hover:underline"
                    >
                      {meta.action}
                    </Link>
                  </div>
                  <OrderList
                    orders={group.orders}
                    emptyTitle={t("dashboard.queue.empty")}
                    locale={locale}
                  />
                </section>
              );
            })}
          </div>
        )}
      </SectionCard>
    </>
  );
}

/** Sekundære nøkkeltall, bevisst mindre enn unntakene. */
async function DashboardKeyFigures({
  reportScope,
  organisationScope,
  dateContext,
}: {
  reportScope: Prisma.WorkOrderWhereInput;
  organisationScope: Prisma.CustomerWhereInput;
  dateContext: DateContext;
}) {
  const t = await getTranslations("common");
  const { startOfMonth } = dateContext;

  const [reportsThisMonth, customerCount, unitCount] = await Promise.all([
    prisma.report.count({
      where: {
        deletedAt: null,
        completedAt: { gte: startOfMonth },
        workOrder: { deletedAt: null, ...reportScope },
      },
    }),
    prisma.customer.count({ where: organisationScope }),
    prisma.product.count({ where: { customer: organisationScope } }),
  ]);

  return (
    <section aria-labelledby="dashboard-key-figures-title">
      <h2
        id="dashboard-key-figures-title"
        className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500"
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
  );
}

/** Aktivitet er historikk og holdes sammenklappet nederst på siden. */
async function DashboardActivity({ locale }: { locale: string }) {
  const t = await getTranslations("common");

  const recentLogs = await prisma.auditLog.findMany({
    where: {
      // Innlogging og 2FA er sikkerhetshendelser, ikke arbeidsaktivitet.
      // De vises i revisjonsloggen, men skal ikke fylle dashbordet.
      action: { notIn: ["Logget inn", "Logget inn med gjenopprettingskode"] },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return (
    <CollapsibleSection title={t("dashboard.activityTitle")}>
      {recentLogs.length === 0 ? (
        <CompactEmptyState icon="📭" title={t("dashboard.noActivity")} />
      ) : (
        <ol className="space-y-2">
          {recentLogs.map((log) => (
            <li key={log.id} className="flex items-start gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
              <div className="min-w-0">
                <p className="font-medium text-gray-800">
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
      <div className="mt-3 border-t border-gray-100 pt-3">
        <Link
          href="/innstillinger?tab=auditlog"
          className="text-xs font-bold text-blue-600 hover:underline"
        >
          {t("dashboard.viewAllActivity")}
        </Link>
      </div>
    </CollapsibleSection>
  );
}

// ------------------------------------------------------------------
// Små presentasjonskomponenter
// ------------------------------------------------------------------

/** Native, tilgjengelig seksjon som er sammenklappet til brukeren åpner den. */
function CollapsibleSection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={`group rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
          {title}
        </h2>
        <span
          aria-hidden="true"
          className="text-xs text-gray-500 transition group-open:rotate-180"
        >
          ⌄
        </span>
      </summary>
      <div className="border-t border-gray-100 p-4 sm:p-5">{children}</div>
    </details>
  );
}

function QuickActionButton({
  action,
  compact = false,
}: {
  action: QuickAction;
  compact?: boolean;
}) {
  return (
    <Link
      href={action.href}
      className={`flex items-center gap-2 rounded-xl border text-sm font-bold transition ${
        compact ? "px-2.5 py-2" : "px-3 py-2.5"
      } ${
        action.emphasis
          ? "border-transparent bg-[var(--primary-color)] text-[var(--primary-foreground)] hover:opacity-90"
          : "border-gray-200 bg-gray-50 text-gray-800 hover:border-blue-300 hover:bg-blue-50"
      }`}
    >
      <span className="text-base leading-none" aria-hidden="true">
        {action.icon}
      </span>
      <span className="truncate">{action.label}</span>
    </Link>
  );
}

function QuickActionsContent({
  primary,
  secondary,
  moreLabel,
}: {
  primary: QuickAction[];
  secondary: QuickAction[];
  moreLabel: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {primary.map((action) => (
          <QuickActionButton key={action.href + action.label} action={action} />
        ))}
      </div>
      {secondary.length > 0 && (
        <details className="group rounded-xl border border-gray-200 bg-gray-50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-gray-700 [&::-webkit-details-marker]:hidden">
            <span>{moreLabel}</span>
            <span
              aria-hidden="true"
              className="text-gray-500 transition group-open:rotate-180"
            >
              ⌄
            </span>
          </summary>
          <div className="grid grid-cols-2 gap-2 border-t border-gray-200 p-2 sm:grid-cols-3">
            {secondary.map((action) => (
              <QuickActionButton
                key={action.href + action.label}
                action={action}
                compact
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Skjelettfallbacks. De matcher seksjonenes form slik at layouten ikke
// hopper når de ekte dataene strømmer inn.
// ------------------------------------------------------------------

function OverviewFallback({ label }: { label: string }) {
  return (
    <>
      <section role="status" aria-label={label}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      </section>
      <section
        role="status"
        aria-label={label}
        className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      </section>
    </>
  );
}

function KeyFiguresFallback({ label }: { label: string }) {
  return (
    <section role="status" aria-label={label}>
      <Skeleton className="mb-2 h-3 w-24" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </div>
    </section>
  );
}

function ActivityFallback({ label }: { label: string }) {
  return (
    <section
      role="status"
      aria-label={label}
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <Skeleton className="h-4 w-32" />
    </section>
  );
}

export default async function AdminDashboard() {
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

  // Montører har «I dag» som hjem. Kontor og administrator beholder
  // dashbordet; kundeportalbrukere er allerede sendt videre over.
  const home = homePathForRole(user.role);
  if (home !== "/") redirect(home);

  // Dashbordet er kontorets flate. Montører er allerede sendt til «I dag»
  // over, men egendefinerte roller med oppdragstilgang kan fortsatt lande her.
  const office = user.role === "ADMIN" || user.role === "OFFICE";
  const canCreate = hasPermission(user, "workorders.create");
  const canSeeCancelled = user.role !== "TECHNICIAN";
  const canViewAudit = hasPermission(user, "audit.view");
  const canAssign = hasPermission(user, "workorders.assign");

  const primaryActions: QuickAction[] = [
    canCreate
      ? {
          href: office ? "/oppdrag/ny" : "/mine-oppdrag/ny",
          icon: "➕",
          label: t("dashboard.quickActions.newWorkOrder"),
          emphasis: true,
        }
      : null,
    {
      href: "/kalender",
      icon: "📅",
      label: t("dashboard.quickActions.calendar"),
    },
    office && canAssign
      ? {
          href: "/kalender/dispatch",
          icon: "🎛️",
          label: t("dashboard.quickActions.dispatch"),
        }
      : null,
    !office
      ? {
          href: "/mine-oppdrag",
          icon: "📋",
          label: t("dashboard.quickActions.myWorkOrders"),
        }
      : null,
    {
      href: "/sok",
      icon: "🔍",
      label: t("dashboard.quickActions.search"),
    },
  ]
    .filter((action): action is QuickAction => action !== null)
    .slice(0, 4);

  const secondaryActions: QuickAction[] = [
    { href: "/oppdrag", icon: "📂", label: t("dashboard.quickActions.allWorkOrders") },
    { href: "/kart", icon: "🗺️", label: t("dashboard.quickActions.map") },
    hasPermission(user, "customers.view")
      ? {
          href: "/kunder",
          icon: "🏢",
          label: t("dashboard.quickActions.customers"),
        }
      : null,
    hasPermission(user, "documents.view")
      ? {
          href: "/dokumenter",
          icon: "📚",
          label: t("dashboard.quickActions.documents"),
        }
      : null,
    hasPermission(user, "templates.manage")
      ? {
          href: "/innstillinger?tab=maler",
          icon: "📋",
          label: t("dashboard.quickActions.checklists"),
        }
      : null,
    hasPermission(user, "reports.view")
      ? {
          href: "/innstillinger?tab=statistikk",
          icon: "📊",
          label: t("dashboard.quickActions.statistics"),
        }
      : null,
  ].filter((action): action is QuickAction => action !== null);

  const visibleStatus: Prisma.WorkOrderWhereInput = canSeeCancelled
    ? {}
    : { status: { not: "CANCELLED" } };
  const scope = workOrderScope(user);
  const reportScope = reportWorkOrderScope(user);
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
      <div className="mx-auto max-w-5xl space-y-4 sm:space-y-5">
        <header>
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
          />
        </header>

        {/* Mobil og desktop følger samme rekkefølge: unntak, én prioritert kø,
            hurtighandlinger, nøkkeltall og til slutt sammenklappet aktivitet. */}
        <Suspense fallback={<OverviewFallback label={loadingLabel} />}>
          <DashboardOverview
            scope={scope}
            visibleStatus={visibleStatus}
            dateContext={dateContext}
            locale={locale}
            canAssign={canAssign}
          />
        </Suspense>

        {/* Hurtighandlinger: fire primære handlinger. På mobil er hele
            seksjonen sammenklappet, og resten ligger bak «Flere verktøy». */}
        <CollapsibleSection
          title={t("dashboard.quickActionsTitle")}
          className="border-2 border-gray-200 lg:hidden"
        >
          <QuickActionsContent
            primary={primaryActions}
            secondary={secondaryActions}
            moreLabel={t("dashboard.moreTools")}
          />
        </CollapsibleSection>

        <SectionCard
          title={
            <span className="text-xs font-bold uppercase tracking-wide text-gray-600">
              {t("dashboard.quickActionsTitle")}
            </span>
          }
          className="hidden border-2 border-gray-200 lg:block"
        >
          <QuickActionsContent
            primary={primaryActions}
            secondary={secondaryActions}
            moreLabel={t("dashboard.moreTools")}
          />
        </SectionCard>

        <Suspense fallback={<KeyFiguresFallback label={loadingLabel} />}>
          <DashboardKeyFigures
            reportScope={reportScope}
            organisationScope={organisationScope}
            dateContext={dateContext}
          />
        </Suspense>

        {canViewAudit && (
          <Suspense fallback={<ActivityFallback label={loadingLabel} />}>
            <DashboardActivity locale={locale} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
