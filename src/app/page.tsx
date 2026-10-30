import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { scheduledTodayWhere } from "@/lib/work-order-date-where";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { type Prisma, WorkStatus } from "@prisma/client";
import { Skeleton } from "@/components/Skeleton";
import Icon, { type IconName } from "@/components/icons";
import {
  addDaysUtc,
  formatDateLocalized,
  formatDateTimeLocalized,
  isoWeekNumber,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { describeAuditAction, type AuditTranslator } from "@/lib/audit-actions";
import { hasPermission } from "@/lib/permissions";
import { departmentUsersScope, workOrderScope } from "@/lib/access";
import { reportWorkOrderScope } from "@/lib/report-scope";
import { homePathForRole } from "@/lib/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardMetricCards, {
  type DashboardMetricCard,
} from "@/components/dashboard/DashboardMetricCards";
import DashboardBoard from "@/components/dashboard/DashboardBoard";
import PriorityQueue from "@/components/dashboard/PriorityQueue";
import DashboardRail from "@/components/dashboard/DashboardRail";
import {
  QUEUE_SORT_KEYS,
  buildBoardColumns,
  resolveDashboardView,
  resolveQueueSort,
  sortQueueRows,
  type BoardColumnKey,
  type DashboardView,
  type QueueKey,
  type QueueSort,
} from "@/components/dashboard/helpers";

// ------------------------------------------------------------------
// Command Center-flater. Klassenavnene under er de samme verdiene som
// office-app/office-card/signal-button/ink-button får fra designtokens.
// Fallbackene holder flaten riktig også før tokenlaget er lastet.
// ------------------------------------------------------------------
const CARD = "office-card";
const EYEBROW =
  "text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const MUTED = "text-[var(--muted,#62685f)]";

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

// Tavlekortene henter litt flere rader enn den kompakte køen, men alltid
// avgrenset. Kolonnene kappes til `BOARD_COLUMN_LIMIT` etter prioritering.
const BOARD_SCAN_LIMIT = 24;

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

// Tavlekolonnene har samme prioritet som `buildBoardColumns`: forfalt først,
// deretter pågående, dagens og til slutt ikke-tildelte. Telle-spørringene
// bruker derfor de samme unntakene, slik at kolonnetallet matcher kortene.
function inProgressBucketWhere(
  scope: Prisma.WorkOrderWhereInput,
  visibleStatus: Prisma.WorkOrderWhereInput,
  dates: DateContext,
): Prisma.WorkOrderWhereInput {
  return {
    AND: [
      scope,
      visibleStatus,
      { status: "IN_PROGRESS" },
      { NOT: overdueWhere(scope, visibleStatus, dates) },
    ],
  };
}

function todayBucketWhere(
  scope: Prisma.WorkOrderWhereInput,
  visibleStatus: Prisma.WorkOrderWhereInput,
  dates: DateContext,
): Prisma.WorkOrderWhereInput {
  return {
    AND: [
      todayWhere(scope, visibleStatus, dates),
      { status: { not: "IN_PROGRESS" } },
    ],
  };
}

function unassignedBucketWhere(
  scope: Prisma.WorkOrderWhereInput,
  visibleStatus: Prisma.WorkOrderWhereInput,
  dates: DateContext,
): Prisma.WorkOrderWhereInput {
  return {
    AND: [
      unassignedWhere(scope, visibleStatus),
      { status: { not: "IN_PROGRESS" } },
      {
        NOT: {
          OR: [
            overdueWhere(scope, visibleStatus, dates),
            todayWhere(scope, visibleStatus, dates),
          ],
        },
      },
    ],
  };
}

function completedTodayWhere(
  scope: Prisma.WorkOrderWhereInput,
  visibleStatus: Prisma.WorkOrderWhereInput,
  { startOfToday, endOfToday }: DateContext,
): Prisma.WorkOrderWhereInput {
  return {
    AND: [
      scope,
      visibleStatus,
      scheduledTodayWhere(startOfToday, endOfToday),
      { status: "COMPLETED" },
    ],
  };
}

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

type QuickAction = {
  href: string;
  icon: IconName;
  label: string;
  emphasis?: boolean;
};

// ------------------------------------------------------------------
// Async seksjoner. Hver av dem eier spørringene sine, slik at de kan
// streame uavhengig av hverandre i stedet for å dele én stor Promise.all.
// ------------------------------------------------------------------

/**
 * Unntaksstripen, den prioriterte køen og høyresporet. De hentes sammen slik
 * at tallene over køen alltid beskriver de samme listene som køen viser.
 */
async function DashboardOverview({
  scope,
  visibleStatus,
  teamScope,
  dateContext,
  locale,
  canAssign,
  canViewSla,
  view,
  sort,
  footer,
}: {
  scope: Prisma.WorkOrderWhereInput;
  visibleStatus: Prisma.WorkOrderWhereInput;
  teamScope: Prisma.UserWhereInput;
  dateContext: DateContext;
  locale: string;
  canAssign: boolean;
  canViewSla: boolean;
  view: DashboardView;
  sort: QueueSort;
  footer?: ReactNode;
}) {
  const t = await getTranslations("common");

  const [
    statusGroups,
    todayCount,
    overdueCount,
    unassignedCount,
    todayBucketCount,
    inProgressBucketCount,
    unassignedBucketCount,
    completedTodayCount,
    todayInProgressCount,
    overdueOrders,
    todayOrders,
    inProgressOrders,
    unassignedOrders,
    team,
    slaAtRiskCount,
    slaBreachedCount,
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
    prisma.workOrder.count({
      where: todayBucketWhere(scope, visibleStatus, dateContext),
    }),
    prisma.workOrder.count({
      where: inProgressBucketWhere(scope, visibleStatus, dateContext),
    }),
    prisma.workOrder.count({
      where: unassignedBucketWhere(scope, visibleStatus, dateContext),
    }),
    prisma.workOrder.count({
      where: completedTodayWhere(scope, visibleStatus, dateContext),
    }),
    prisma.workOrder.count({
      where: {
        AND: [
          todayWhere(scope, visibleStatus, dateContext),
          { status: "IN_PROGRESS" },
        ],
      },
    }),
    prisma.workOrder.findMany({
      where: overdueWhere(scope, visibleStatus, dateContext),
      orderBy: { scheduledFor: "asc" },
      take: BOARD_SCAN_LIMIT,
      include: { customer: true, technicians: true },
    }),
    prisma.workOrder.findMany({
      where: todayWhere(scope, visibleStatus, dateContext),
      orderBy: { scheduledFor: "asc" },
      take: BOARD_SCAN_LIMIT,
      include: { customer: true, technicians: true },
    }),
    prisma.workOrder.findMany({
      where: inProgressBucketWhere(scope, visibleStatus, dateContext),
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
      take: BOARD_SCAN_LIMIT,
      include: { customer: true, technicians: true },
    }),
    prisma.workOrder.findMany({
      where: unassignedWhere(scope, visibleStatus),
      orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }],
      take: UNASSIGNED_SCAN_LIMIT,
      include: { customer: true, technicians: true },
    }),
    prisma.user.findMany({
      where: { ...teamScope, isActive: true, role: { not: "CUSTOMER" } },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            workOrders: {
              where: todayWhere(scope, visibleStatus, dateContext),
            },
          },
        },
      },
      orderBy: { name: "asc" },
      take: 8,
    }),
    canViewSla
      ? prisma.slaClock.count({
          where: {
            state: "AT_RISK",
            workOrder: { AND: [scope, visibleStatus] },
          },
        })
      : Promise.resolve(0),
    canViewSla
      ? prisma.slaClock.count({
          where: {
            state: "BREACHED",
            workOrder: { AND: [scope, visibleStatus] },
          },
        })
      : Promise.resolve(0),
  ]);

  const countByStatus = (status: WorkStatus) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const inProgressCount = countByStatus("IN_PROGRESS");
  const awaitingCount = AWAITING_STATUSES.reduce(
    (sum, status) => sum + countByStatus(status),
    0,
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
  const rows = sortQueueRows(
    groups.flatMap((group) =>
      group.orders.map((order) => ({ order, queueKey: group.key })),
    ),
    sort,
  );

  const boardTotals: Record<BoardColumnKey, number> = {
    overdue: overdueCount,
    today: todayBucketCount,
    inProgress: inProgressBucketCount,
    unassigned: unassignedBucketCount,
  };
  const boardColumns = buildBoardColumns(
    {
      overdue: overdueOrders,
      today: todayOrders,
      inProgress: inProgressOrders,
      unassigned: unassignedOrders,
    },
    boardTotals,
  );
  const boardHrefs: Record<BoardColumnKey, string> = {
    overdue: "/oppdrag?vis=forfalte",
    today: "/oppdrag?vis=idag",
    inProgress: "/oppdrag?vis=pagaaende",
    unassigned: "/oppdrag?vis=ikke-tildelt",
  };

  const nextOverdue = overdueOrders[0] ?? null;
  const teamSorted = [...team].sort(
    (a, b) =>
      b._count.workOrders - a._count.workOrders ||
      (a.name ?? "").localeCompare(b.name ?? "", "nb"),
  );
  const teamRows = teamSorted.map((member) => ({
    id: member.id,
    name: member.name,
    count: member._count.workOrders,
  }));

  const metricCards: DashboardMetricCard[] = [
    {
      key: "overdue",
      label: t("dashboard.kpi.overdue"),
      foot: t("dashboard.kpi.overdueSub"),
      value: overdueCount,
      href: "/oppdrag?vis=forfalte",
      tone: "ink",
      icon: "alert",
    },
    {
      key: "today",
      label: t("dashboard.kpi.today"),
      foot: t("dashboard.kpi.todaySub"),
      value: todayCount,
      href: "/oppdrag?vis=idag",
      tone: "signal",
      icon: "calendar",
    },
    {
      key: "unassigned",
      label: t("dashboard.kpi.unassigned"),
      foot: t("dashboard.kpi.unassignedSub"),
      value: unassignedCount,
      href: "/oppdrag?vis=ikke-tildelt",
      tone: "paper",
      icon: "plus",
    },
    {
      key: "inProgress",
      label: t("dashboard.kpi.inProgress"),
      foot: t("dashboard.kpi.awaiting", { count: awaitingCount }),
      value: inProgressCount,
      href: "/oppdrag?vis=pagaaende",
      tone: "paper",
      marker: "signal",
    },
    ...(canViewSla
      ? [
          {
            key: "slaAtRisk",
            label: t("dashboard.kpi.slaAtRisk"),
            foot: t("dashboard.kpi.slaAtRiskSub"),
            value: slaAtRiskCount,
            href: "/oppdrag",
            tone: "paper" as const,
            marker: "signal" as const,
          },
          {
            key: "slaBreached",
            label: t("dashboard.kpi.slaBreached"),
            foot: t("dashboard.kpi.slaBreachedSub"),
            value: slaBreachedCount,
            href: "/oppdrag",
            tone: "ink" as const,
            marker: "risk" as const,
          },
        ]
      : []),
  ];

  const sortLinks = QUEUE_SORT_KEYS.reduce(
    (links, key) => {
      links[key] = `/?vis=liste${key === "dato" ? "" : `&sort=${key}`}`;
      return links;
    },
    {} as Record<QueueSort, string>,
  );

  const updatedTime = formatDateLocalized(new Date(), locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return (
    <>
      <DashboardMetricCards
        cards={metricCards}
        title={t("dashboard.primaryKpisTitle")}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          {view === "tavle" ? (
            <DashboardBoard
              columns={boardColumns}
              hrefs={boardHrefs}
              locale={locale}
              title={t("dashboard.header.viewBoard")}
              t={t}
            />
          ) : (
            <PriorityQueue
              rows={rows}
              sort={sort}
              sortLinks={sortLinks}
              filterHref="/oppdrag"
              locale={locale}
              t={t}
            />
          )}
        </div>

        <DashboardRail
          nextOrder={nextOverdue}
          team={teamRows}
          counts={{
            unassigned: unassignedCount,
            completedToday: completedTodayCount,
            todayTotal: todayCount + completedTodayCount,
            todayRemaining: todayCount,
            todayInProgress: todayInProgressCount,
          }}
          updatedAt={updatedTime}
          locale={locale}
          canAssign={canAssign}
          t={t}
        />

        {footer ? (
          <div className="space-y-4 lg:col-start-1 lg:row-start-2">{footer}</div>
        ) : null}
      </div>
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

  const figures = [
    {
      key: "customers",
      label: t("dashboard.kpi.customers"),
      sub: t("dashboard.kpi.customersSub"),
      value: customerCount,
      href: "/kunder",
    },
    {
      key: "equipment",
      label: t("dashboard.kpi.equipment"),
      sub: t("dashboard.kpi.equipmentSub"),
      value: unitCount,
    },
    {
      key: "reports",
      label: t("dashboard.kpi.reports"),
      sub: t("dashboard.kpi.reportsSub"),
      value: reportsThisMonth,
      href: "/rapporter",
    },
  ];

  return (
    <section aria-labelledby="dashboard-key-figures-title">
      <h2 id="dashboard-key-figures-title" className="sr-only">
        {t("dashboard.keyFigures")}
      </h2>
      <div
        className={`${CARD} grid grid-cols-3 divide-x divide-[var(--line,#d8d3c5)] overflow-hidden`}
      >
        {figures.map((figure) => {
          const content = (
            <>
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#5e6356]">
                {figure.label}
              </span>
              <span className="mt-0.5 block text-2xl font-black tabular-nums leading-none">
                {figure.value}
              </span>
              <span className={`mt-1 block truncate text-xs ${MUTED}`}>
                {figure.sub}
              </span>
            </>
          );
          return figure.href ? (
            <Link
              key={figure.key}
              href={figure.href}
              className="px-3 py-2.5 transition hover:bg-[#f3f6e7] sm:px-4"
            >
              {content}
            </Link>
          ) : (
            <div key={figure.key} className="px-3 py-2.5 sm:px-4">
              {content}
            </div>
          );
        })}
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
        <p className={`px-1 py-2 text-sm ${MUTED}`}>
          {t("dashboard.noActivity")}
        </p>
      ) : (
        <ol className="divide-y divide-[var(--line,#d8d3c5)]">
          {recentLogs.map((log) => (
            <li key={log.id} className="flex items-start gap-3 py-2 text-sm">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#c8f135)] ring-1 ring-[var(--ink,#131711)]"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="font-medium text-[var(--ink,#131711)]">
                  {describeAuditAction(
                    log.action,
                    t as unknown as AuditTranslator,
                  ) ?? log.action}
                </p>
                <p className="text-xs text-[#5e6356]">
                  {log.userName || t("dashboard.unknownUser")} ·{" "}
                  {formatDateTimeLocalized(log.createdAt, locale)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2 border-t border-[var(--line,#d8d3c5)] pt-2">
        <Link
          href="/innstillinger?tab=auditlog"
          className="text-xs font-bold text-[var(--ink,#131711)] underline decoration-[var(--signal,#c8f135)] decoration-2 underline-offset-4"
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
    <details className={`group ${CARD} ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-xs font-black uppercase tracking-[0.14em]">
          {title}
        </h2>
        <span
          aria-hidden="true"
          className="text-xs text-[#5e6356] transition group-open:rotate-180"
        >
          <Icon name="chevronDown" className="h-4 w-4" />
        </span>
      </summary>
      <div className="border-t border-[var(--line,#d8d3c5)] px-4 py-3">
        {children}
      </div>
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
      className={`flex items-center justify-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-bold transition ${
        action.emphasis
          ? "border-[var(--ink,#131711)] bg-[var(--signal,#c8f135)] text-[var(--ink,#131711)] shadow-[1px_1px_0_var(--ink,#131711)] hover:translate-x-px hover:translate-y-px hover:shadow-none"
          : "border-[var(--line,#d8d3c5)] bg-white text-[var(--ink,#131711)] hover:border-[var(--ink,#131711)]"
      } ${compact ? "min-h-9" : "min-h-10"}`}
    >
      <Icon name={action.icon} className="h-4 w-4 shrink-0" />
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
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {primary.map((action) => (
          <QuickActionButton key={action.href + action.label} action={action} />
        ))}
      </div>
      {secondary.length > 0 && (
        <details className="group rounded-lg border border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold [&::-webkit-details-marker]:hidden">
            <span>{moreLabel}</span>
            <span
              aria-hidden="true"
              className="text-[#5e6356] transition group-open:rotate-180"
            >
              <Icon name="chevronDown" className="h-4 w-4" />
            </span>
          </summary>
          <div className="grid grid-cols-2 gap-2 border-t border-[var(--line,#d8d3c5)] p-2 sm:grid-cols-3">
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
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton
              key={index}
              className="h-[8.75rem] rounded-2xl"
            />
          ))}
        </div>
      </section>
      <section
        role="status"
        aria-label={label}
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]"
      >
        <div className={`${CARD} p-4`}>
          <Skeleton className="h-5 w-40" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-16" />
          <Skeleton className="mt-3 h-24" />
        </div>
      </section>
    </>
  );
}

function KeyFiguresFallback({ label }: { label: string }) {
  return (
    <section role="status" aria-label={label}>
      <Skeleton className="h-16 rounded-xl" />
    </section>
  );
}

function ActivityFallback({ label }: { label: string }) {
  return (
    <section role="status" aria-label={label}>
      <Skeleton className="h-12 rounded-xl" />
    </section>
  );
}

function dashboardHref(view: DashboardView, sort: QueueSort) {
  const params = new URLSearchParams({ vis: view });
  if (sort !== "dato") params.set("sort", sort);
  return `/?${params.toString()}`;
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams?: Promise<{
    vis?: string | string[];
    sort?: string | string[];
  }>;
} = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = (await searchParams) ?? {};
  const view = resolveDashboardView(params.vis);
  const sort = resolveQueueSort(params.sort);

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
  const canViewSla =
    hasPermission(user, "contracts.view") ||
    hasPermission(user, "contracts.manage");

  const primaryActions: QuickAction[] = [
    canCreate
      ? {
          href: office ? "/oppdrag/ny" : "/mine-oppdrag/ny",
          icon: "plus",
          label: t("dashboard.quickActions.newWorkOrder"),
          emphasis: true,
        }
      : null,
    {
      href: "/kalender",
      icon: "calendar",
      label: t("dashboard.quickActions.calendar"),
    },
    office && canAssign
      ? {
          href: "/kalender/dispatch",
          icon: "grid",
          label: t("dashboard.quickActions.dispatch"),
        }
      : null,
    !office
      ? {
          href: "/mine-oppdrag",
          icon: "clipboard",
          label: t("dashboard.quickActions.myWorkOrders"),
        }
      : null,
    {
      href: "/sok",
      icon: "search",
      label: t("dashboard.quickActions.search"),
    },
  ]
    .filter((action): action is QuickAction => action !== null)
    .slice(0, 4);

  const secondaryActions: QuickAction[] = [
    { href: "/oppdrag", icon: "clipboard", label: t("dashboard.quickActions.allWorkOrders") },
    { href: "/kart", icon: "map", label: t("dashboard.quickActions.map") },
    hasPermission(user, "customers.view")
      ? {
          href: "/kunder",
          icon: "building",
          label: t("dashboard.quickActions.customers"),
        }
      : null,
    hasPermission(user, "documents.view")
      ? {
          href: "/dokumenter",
          icon: "folder",
          label: t("dashboard.quickActions.documents"),
        }
      : null,
    hasPermission(user, "templates.manage")
      ? {
          href: "/innstillinger?tab=maler",
          icon: "list",
          label: t("dashboard.quickActions.checklists"),
        }
      : null,
    hasPermission(user, "reports.view")
      ? {
          href: "/innstillinger?tab=statistikk",
          icon: "chart",
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

  const dateContext = getDateContext();
  const loadingLabel = t("components.skeleton.loading");
  const fullDate = formatDateLocalized(
    dateContext.startOfToday,
    locale,
    { dateStyle: "full" },
    t("dashboard.orderList.noDate"),
  );
  const dateIso = toDateOnly(dateContext.startOfToday);
  const week = isoWeekNumber(dateContext.startOfToday);
  const newOrderHref = office ? "/oppdrag/ny" : "/mine-oppdrag/ny";

  return (
    <div className="office-app office-dashboard min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <DashboardHeader
          view={view}
          week={week}
          fullDate={fullDate}
          dateIso={dateIso}
          listHref={dashboardHref("liste", sort)}
          boardHref={dashboardHref("tavle", sort)}
          newOrderHref={newOrderHref}
          canCreate={canCreate}
          scope={scope}
          visibleStatus={visibleStatus}
          t={t}
        />

        {/* Fast rekkefølge: unntak, prioritert kø med høyrespor, verktøy,
            nøkkeltall og til slutt sammenklappet aktivitet. Verktøy og tall
            ligger i venstrekolonnen slik at høyresporet følger køen. */}
        <Suspense fallback={<OverviewFallback label={loadingLabel} />}>
          <DashboardOverview
            scope={scope}
            visibleStatus={visibleStatus}
            teamScope={departmentUsersScope(user)}
            dateContext={dateContext}
            locale={locale}
            canAssign={canAssign}
            canViewSla={canViewSla}
            view={view}
            sort={sort}
            footer={
              <>
                <section className={`${CARD} px-4 py-3`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 className={EYEBROW}>
                      {t("dashboard.quickActionsTitle")}
                    </h2>
                    <Link
                      href="/oppdrag"
                      className="text-xs font-bold underline decoration-[var(--signal,#c8f135)] decoration-2 underline-offset-4"
                    >
                      {t("dashboard.allOrders")}
                      <Icon name="arrowRight" className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <QuickActionsContent
                    primary={primaryActions}
                    secondary={secondaryActions}
                    moreLabel={t("dashboard.moreTools")}
                  />
                </section>

                <Suspense
                  fallback={<KeyFiguresFallback label={loadingLabel} />}
                >
                  <DashboardKeyFigures
                    reportScope={reportScope}
                    organisationScope={organisationScope}
                    dateContext={dateContext}
                  />
                </Suspense>
              </>
            }
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
