import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { scheduledTodayWhere } from "@/lib/work-order-date-where";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { type Prisma, WorkStatus } from "@prisma/client";
import { Skeleton } from "@/components/Skeleton";
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
import { departmentUsersScope, workOrderScope } from "@/lib/access";
import { reportWorkOrderScope } from "@/lib/report-scope";
import { homePathForRole } from "@/lib/navigation";

// ------------------------------------------------------------------
// Command Center-flater. Klassenavnene under er de samme verdiene som
// office-app/office-card/signal-button/ink-button får fra designtokens.
// Fallbackene holder flaten riktig også før tokenlaget er lastet.
// ------------------------------------------------------------------
const CARD = "office-card";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
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

const STATUS_LABEL_KEYS: Record<string, string> = {
  OPEN: "statusOpen",
  PENDING: "statusPending",
  PLANNED: "statusPlanned",
  IN_PROGRESS: "statusInProgress",
  WAITING: "statusWaiting",
  COMPLETED: "statusCompleted",
  CANCELLED: "statusCancelled",
};

const STATUS_TONE: Record<string, string> = {
  IN_PROGRESS:
    "border-[var(--ink,#131711)] bg-[var(--signal,#c8f135)] text-[var(--ink,#131711)]",
  COMPLETED: "border-[#a9c96a] bg-[#eef7d6] text-[#283509]",
  CANCELLED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  WAITING: "border-[#e4c98f] bg-[#fdf5e4] text-[#7a4f0c]",
};

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

function initials(name: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.charAt(0) ?? "?"}${parts[1]?.charAt(0) ?? ""}`;
}

function statusLabel(
  t: (key: string) => string,
  status: string,
) {
  return t(STATUS_LABEL_KEYS[status] ?? "statusOpen");
}

function StatusPill({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${
        STATUS_TONE[status] ?? "border-[var(--line,#d8d3c5)] bg-white"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

/** Kompakt tomtilstand i køen – ingen stor illustrasjon eller kortstabel. */
function QueueEmpty({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-6 text-sm">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--signal,#c8f135)] text-sm font-black text-[var(--ink,#131711)]"
        aria-hidden
      >
        ✓
      </span>
      <p className="font-bold text-[var(--ink,#131711)]">{title}</p>
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
  footer,
}: {
  scope: Prisma.WorkOrderWhereInput;
  visibleStatus: Prisma.WorkOrderWhereInput;
  teamScope: Prisma.UserWhereInput;
  dateContext: DateContext;
  locale: string;
  canAssign: boolean;
  footer?: ReactNode;
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
    team,
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
  const rows = groups.flatMap((group) =>
    group.orders.map((order) => ({ order, queueKey: group.key })),
  );

  const groupMeta: Record<QueueKey, { href: string; action: string }> = {
    overdue: {
      href: "/oppdrag?vis=forfalte",
      action: t("dashboard.queue.viewAllOverdue"),
    },
    today: {
      href: "/oppdrag?vis=idag",
      action: t("dashboard.queue.viewAllToday"),
    },
    unassigned: {
      href: canAssign ? "/kalender/dispatch" : "/oppdrag?vis=ikke-tildelt",
      action: canAssign
        ? t("dashboard.queue.openDispatch")
        : t("dashboard.queue.viewAllUnassigned"),
    },
  };

  const nextOverdue = overdueOrders[0];
  const teamSorted = [...team].sort(
    (a, b) =>
      b._count.workOrders - a._count.workOrders ||
      (a.name ?? "").localeCompare(b.name ?? "", "nb"),
  );
  const teamMax = Math.max(
    1,
    ...teamSorted.map((member) => member._count.workOrders),
  );

  const exceptions = [
    {
      key: "overdue",
      label: t("dashboard.kpi.overdue"),
      sub: t("dashboard.kpi.overdueSub"),
      value: overdueCount,
      href: "/oppdrag?vis=forfalte",
      valueClass:
        overdueCount > 0
          ? "bg-[var(--risk-text,#b42318)] text-white"
          : "bg-[#e9e6db] text-[var(--ink,#131711)]",
      marker: "bg-[var(--risk,#b42318)]",
    },
    {
      key: "today",
      label: t("dashboard.kpi.today"),
      sub: dateLabel,
      value: todayCount,
      href: "/oppdrag?vis=idag",
      valueClass:
        "bg-[var(--signal,#c8f135)] text-[var(--ink,#131711)]",
      marker: "bg-[var(--signal,#c8f135)]",
    },
    {
      key: "unassigned",
      label: t("dashboard.kpi.unassigned"),
      sub: t("dashboard.kpi.unassignedSub"),
      value: unassignedCount,
      href: "/oppdrag?vis=ikke-tildelt",
      valueClass:
        unassignedCount > 0
          ? "bg-[#f4d79b] text-[#4b3205]"
          : "bg-[#e9e6db] text-[var(--ink,#131711)]",
      marker: "bg-[#c78b16]",
    },
    {
      key: "inProgress",
      label: t("dashboard.kpi.inProgress"),
      sub: t("dashboard.kpi.awaiting", { count: awaitingCount }),
      value: inProgressCount,
      href: "/oppdrag?vis=pagaaende",
      valueClass:
        "bg-[var(--ink,#131711)] text-[var(--paper,#fbfaf4)]",
      marker: "bg-[var(--ink,#131711)]",
    },
  ];

  return (
    <>
      <section aria-labelledby="dashboard-exceptions-title">
        <h2 id="dashboard-exceptions-title" className="sr-only">
          {t("dashboard.primaryKpisTitle")}
        </h2>
        <div
          className={`${CARD} grid grid-cols-2 divide-x divide-y divide-[var(--line,#d8d3c5)] overflow-hidden lg:grid-cols-4 lg:divide-y-0`}
        >
          {exceptions.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="flex items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-[#f3f6e7] sm:px-4"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[#5e6356]">
                  <span
                    className={`h-2 w-2 rounded-full ${item.marker}`}
                    aria-hidden
                  />
                  {item.label}
                </p>
                <p className={`mt-0.5 truncate text-xs ${MUTED}`}>
                  {item.sub}
                </p>
              </div>
              <span
                className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-2 text-xl font-black tabular-nums ${item.valueClass}`}
              >
                {item.value}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section className={`${CARD} overflow-hidden lg:col-start-1 lg:row-start-1`} aria-labelledby="queue-title">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[var(--line,#d8d3c5)] px-4 py-3">
            <div className="min-w-0">
              <h2 id="queue-title" className="text-sm font-black tracking-tight">
                {t("dashboard.queue.title")}
              </h2>
              <p className={`mt-0.5 hidden text-xs sm:block ${MUTED}`}>
                {t("dashboard.queue.description")}
              </p>
            </div>
            <Link
              href="/oppdrag"
              className="text-xs font-bold text-[var(--ink,#131711)] underline decoration-[var(--signal,#c8f135)] decoration-2 underline-offset-4 hover:decoration-[var(--ink,#131711)]"
            >
              {t("dashboard.allOrders")} →
            </Link>
          </div>

          {rows.length === 0 ? (
            <QueueEmpty title={t("dashboard.queue.empty")} />
          ) : (
            <>
              {/* Desktop: tett tabell med samme kolonner som planleggeren. */}
              <div className="hidden overflow-x-auto md:block">
                <table className="office-table" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "7rem" }} />
                    <col />
                    <col style={{ width: "8.5rem" }} />
                    <col style={{ width: "11rem" }} />
                    <col style={{ width: "8.5rem" }} />
                    <col style={{ width: "5.5rem" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-[var(--ink,#101310)]">
                      {[
                        t("dashboard.queue.date"),
                        t("dashboard.queue.order"),
                        t("dashboard.queue.customer"),
                        t("dashboard.queue.status"),
                        t("dashboard.queue.technician"),
                        t("dashboard.queue.action"),
                      ].map((label, index) => (
                        <th
                          key={label}
                          scope="col"
                          style={{
                            color: "var(--paper, #f2efe6)",
                            borderBottomColor: "var(--signal, #d8ff3e)",
                            borderBottomWidth: "2px",
                            fontSize: "0.75rem",
                            textAlign: index === 5 ? "right" : "left",
                          }}
                          className="whitespace-nowrap"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ order, queueKey }) => {
                      const address = [
                        order.customer?.postalCode,
                        order.customer?.city,
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <tr
                          key={order.id}
                          className={`border-b border-[var(--line,#d8d3c5)] transition last:border-0 hover:bg-[#f4f7e8] ${
                            queueKey === "overdue" ? "bg-[#fdf4f2]" : ""
                          }`}
                        >
                          <td className="whitespace-nowrap px-3 py-2 align-top">
                            <span className="block text-xs font-bold tabular-nums">
                              {formatDateRangeLocalized(
                                order.scheduledFor,
                                order.scheduledTo,
                                locale,
                              ) || t("dashboard.orderList.noDate")}
                            </span>
                            <span
                              className={`mt-0.5 block text-xs font-bold ${
                                queueKey === "overdue"
                                  ? "text-[var(--risk-text,#b42318)]"
                                  : queueKey === "today"
                                    ? "text-[#3f4a1a]"
                                    : "text-[#7a5a12]"
                              }`}
                            >
                              {queueKey === "overdue"
                                ? t("dashboard.kpi.overdue")
                                : queueKey === "today"
                                  ? t("dashboard.kpi.today")
                                  : t("dashboard.kpi.unassigned")}
                            </span>
                          </td>
                          <td className="max-w-[18rem] px-3 py-2 align-top">
                            <Link
                              href={`/oppdrag/${order.id}`}
                              className="line-clamp-2 font-bold leading-5 text-[var(--ink,#131711)] hover:underline"
                            >
                              {order.title}
                            </Link>
                          </td>
                          <td className="max-w-[12rem] px-3 py-2 align-top text-xs">
                            <span className="block truncate font-bold">
                              {order.customer?.name ||
                                t("dashboard.orderList.noCustomer")}
                            </span>
                            {address ? (
                              <span className="block truncate text-[#5f655b]">
                                {address}
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-top">
                            <StatusPill
                              status={order.status}
                              label={statusLabel(t, order.status)}
                            />
                          </td>
                          <td className="max-w-[10rem] px-3 py-2 align-top text-xs">
                            {order.technicians.length > 0 ? (
                              <span className="block truncate font-bold">
                                {order.technicians
                                  .map((tech) => tech.name)
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            ) : (
                              <span className="font-bold text-[var(--risk-text,#b42318)]">
                                {t("dashboard.orderList.unassigned")}
                              </span>
                            )}
                          </td>
                          <td
                            className="whitespace-nowrap"
                            style={{ textAlign: "right" }}
                          >
                            <Link
                              href={`/oppdrag/${order.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--ink,#101310)] px-2 py-1 text-xs font-bold transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
                            >
                              {t("dashboard.queue.open")} →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobil: samme kø som kompakte rader, ikke kort på 300 px. */}
              <div className="divide-y divide-[var(--line,#d8d3c5)] md:hidden">
                {rows.map(({ order, queueKey }) => (
                  <Link
                    key={order.id}
                    href={`/oppdrag/${order.id}`}
                    className={`block px-3 py-2.5 transition hover:bg-[#f4f7e8] ${
                      queueKey === "overdue" ? "bg-[#fdf4f2]" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className={`text-xs font-bold ${
                            queueKey === "overdue"
                              ? "text-[var(--risk-text,#b42318)]"
                              : MUTED
                          }`}
                        >
                          {formatDateRangeLocalized(
                            order.scheduledFor,
                            order.scheduledTo,
                            locale,
                          ) || t("dashboard.orderList.noDate")}
                          {" · "}
                          {queueKey === "overdue"
                            ? t("dashboard.kpi.overdue")
                            : queueKey === "today"
                              ? t("dashboard.kpi.today")
                              : t("dashboard.kpi.unassigned")}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-sm font-bold leading-5">
                          {order.title}
                        </p>
                        <p className="truncate text-xs text-[#5e6356]">
                          {order.customer?.name ||
                            t("dashboard.orderList.noCustomer")}
                          {order.technicians.length === 0
                            ? ` · ${t("dashboard.orderList.unassigned")}`
                            : ` · ${order.technicians
                                .map((tech) => tech.name)
                                .filter(Boolean)
                                .join(", ")}`}
                        </p>
                      </div>
                      <StatusPill
                        status={order.status}
                        label={statusLabel(t, order.status)}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}

          {visibleGroups.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] px-4 py-2">
              {visibleGroups.map((group) => (
                <Link
                  key={group.key}
                  href={groupMeta[group.key].href}
                  className="text-xs font-bold text-[var(--ink,#131711)] underline decoration-[var(--line,#d8d3c5)] decoration-2 underline-offset-4 hover:decoration-[var(--signal,#c8f135)]"
                >
                  {groupMeta[group.key].action}
                  {group.hasMore ? ` (${group.total})` : ""} →
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:col-start-2 lg:row-span-2">
          {/* Neste handling: ett forfalt oppdrag med tydelig tildelingsvalg. */}
          <section
            className={`${CARD} overflow-hidden`}
            aria-labelledby="next-action-title"
          >
            <div className="flex items-center justify-between border-b border-[var(--line,#d8d3c5)] px-4 py-2.5">
              <h2
                id="next-action-title"
                className="text-xs font-black uppercase tracking-[0.14em]"
              >
                {t("dashboard.nextAction.title")}
              </h2>
              <span
                className="h-2 w-2 rounded-full bg-[var(--risk,#b42318)]"
                aria-hidden
              />
            </div>
            {nextOverdue ? (
              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--risk-text,#b42318)]">
                  {t("dashboard.kpi.overdue")} ·{" "}
                  {formatDateRangeLocalized(
                    nextOverdue.scheduledFor,
                    nextOverdue.scheduledTo,
                    locale,
                  ) || t("dashboard.orderList.noDate")}
                </p>
                <h3 className="mt-1 text-base font-black leading-6">
                  {nextOverdue.title}
                </h3>
                <p className="mt-1 text-xs text-[#5e6356]">
                  {nextOverdue.customer?.name ||
                    t("dashboard.orderList.noCustomer")}
                  {nextOverdue.technicians.length > 0
                    ? ` · ${nextOverdue.technicians
                        .map((tech) => tech.name)
                        .filter(Boolean)
                        .join(", ")}`
                    : ` · ${t("dashboard.orderList.unassigned")}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canAssign ? (
                    <Link
                      href={`/oppdrag/${nextOverdue.id}#tildel`}
                      className={SIGNAL_BUTTON}
                    >
                      {t("dashboard.nextAction.assign")} →
                    </Link>
                  ) : (
                    <Link
                      href={`/oppdrag/${nextOverdue.id}`}
                      className={SIGNAL_BUTTON}
                    >
                      {t("dashboard.nextAction.open")} →
                    </Link>
                  )}
                  <Link
                    href={`/oppdrag/${nextOverdue.id}`}
                    className={INK_BUTTON}
                  >
                    {t("dashboard.queue.open")}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <p className="flex items-center gap-2 text-sm font-black">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--signal,#c8f135)] text-xs"
                    aria-hidden
                  >
                    ✓
                  </span>
                  {t("dashboard.nextAction.emptyTitle")}
                </p>
                <p className={`mt-1 text-xs ${MUTED}`}>
                  {t("dashboard.nextAction.emptyDescription")}
                </p>
                <Link
                  href="/oppdrag?vis=forfalte"
                  className={`${INK_BUTTON} mt-3 w-full`}
                >
                  {t("dashboard.nextAction.allOverdue")}
                </Link>
              </div>
            )}
          </section>

          {/* Team i dag: kompakt belastningsliste basert på dagens tildelinger. */}
          <section
            className={`${CARD} overflow-hidden`}
            aria-labelledby="team-title"
          >
            <div className="flex items-center justify-between border-b border-[var(--line,#d8d3c5)] px-4 py-2.5">
              <h2
                id="team-title"
                className="text-xs font-black uppercase tracking-[0.14em]"
              >
                {t("dashboard.team.title")}
              </h2>
              <Link
                href="/oppdrag?vis=idag"
                className="text-xs font-bold underline decoration-[var(--line,#d8d3c5)] decoration-2 underline-offset-4 hover:decoration-[var(--signal,#c8f135)]"
              >
                {t("dashboard.team.viewToday")} →
              </Link>
            </div>
            {teamSorted.length === 0 ? (
              <p className={`px-4 py-4 text-xs ${MUTED}`}>
                {t("dashboard.team.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--line,#d8d3c5)]">
                {teamSorted.map((member) => {
                  const load = member._count.workOrders;
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-2.5 px-4 py-2"
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--ink,#131711)] text-xs font-black uppercase text-[var(--signal,#c8f135)]"
                        aria-hidden
                      >
                        {initials(member.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-bold">
                            {member.name || t("dashboard.unknownUser")}
                          </span>
                          <span className="shrink-0 text-xs font-bold tabular-nums">
                            {t("dashboard.team.load", { count: load })}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e7e3d7]">
                          <div
                            className={`h-full rounded-full ${
                              load === 0
                                ? "bg-transparent"
                                : "bg-[var(--signal,#c8f135)]"
                            }`}
                            style={{
                              width: `${load === 0 ? 0 : Math.max(12, Math.round((load / teamMax) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="border-t border-[var(--line,#d8d3c5)] bg-[var(--paper,#f2efe6)] px-4 py-2">
              <Link
                href="/oppdrag?vis=ikke-tildelt"
                className="flex items-center justify-between gap-2 text-xs font-bold"
              >
                <span>{t("dashboard.kpi.unassigned")}</span>
                <span className="flex items-center gap-1.5 text-[var(--risk-text,#b42318)]">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-current"
                    aria-hidden
                  />
                  {unassignedCount}
                </span>
              </Link>
            </div>
          </section>
        </aside>

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
          ⌄
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
              ⌄
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
        <Skeleton className="h-[4.25rem] rounded-xl" />
      </section>
      <section role="status" aria-label={label} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className={`${CARD} p-4`}>
          <Skeleton className="h-5 w-40" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        </div>
        <div className={`${CARD} p-4`}>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-16" />
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
  const dateLabel = formatDateLocalized(
    dateContext.startOfToday,
    locale,
    undefined,
    t("dashboard.orderList.noDate"),
  );
  const firstName = user.name?.split(" ")[0] || t("admin");
  const canOpenNew = canCreate;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 border-b border-[var(--line,#d8d3c5)] pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className={EYEBROW}>{t("dashboard.planningEyebrow")}</p>
            <h1 className="mt-0.5 text-3xl font-black tracking-tight sm:text-4xl">
              {t("dashboard.planningTitle")}
            </h1>
            <p className={`mt-1 text-sm ${MUTED}`}>
              {t("dashboard.planningSubtitle", { name: firstName })}
              {companyName ? (
                <>
                  {" · "}
                  {t("dashboard.adminOf", { companyName })}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-lg border border-[var(--line,#d8d3c5)] bg-[var(--paper,#fbfaf4)] px-3 py-1.5">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#5e6356]">
                {t("dashboard.planningDate")}
              </p>
              <p className="text-sm font-black tabular-nums">{dateLabel}</p>
            </div>
            {canOpenNew ? (
              <Link href={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"} className={SIGNAL_BUTTON}>
                {t("dashboard.quickActions.newWorkOrder")} →
              </Link>
            ) : null}
          </div>
        </header>

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
                      {t("dashboard.allOrders")} →
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
