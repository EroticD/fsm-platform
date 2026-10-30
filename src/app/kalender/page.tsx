import { redirect } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatAddress } from "@/lib/address";
import {
  formatDateLocalized,
  formatDateRangeLocalized,
  todayInOslo,
} from "@/lib/dates";
import CalendarShell from "@/app/kalender/CalendarShell";
import CalendarLegend from "@/app/kalender/CalendarLegend";
import CalendarViewPage from "@/app/kalender/CalendarViewPage";
import Icon, { type IconName } from "@/components/icons";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";
import type { CalendarTabKey } from "@/lib/calendar-tabs";
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  WORK_ORDER_STATUS_ORDER,
  workOrderStatusColor,
} from "@/lib/work-order-status-colors";

const EYEBROW =
  "text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";

type CalendarViewParam = {
  view: string;
  visParam: string;
  active: CalendarTabKey;
  subtitleKey: string;
};

// Én kalenderrute, seks visninger. De gamle rutene redirecter hit.
const CALENDAR_VIEWS: Record<string, CalendarViewParam> = {
  maned: {
    view: "dayGridMonth",
    visParam: "maned",
    active: "month",
    subtitleKey: "calendar.month.subtitle",
  },
  uke: {
    view: "dayGridWeek",
    visParam: "uke",
    active: "week",
    subtitleKey: "calendar.week.subtitle",
  },
  "2uker": {
    view: "biweekly",
    visParam: "2uker",
    active: "biweekly",
    subtitleKey: "calendar.biweekly.subtitle",
  },
  timegrid: {
    view: "timeGridWeek",
    visParam: "timegrid",
    active: "timeWeek",
    subtitleKey: "calendar.timeWeek.subtitle",
  },
  dag: {
    view: "timeGridDay",
    visParam: "dag",
    active: "timeDay",
    subtitleKey: "calendar.day.subtitle",
  },
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.kalender") };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    vis?: string | string[];
    dato?: string | string[];
    tekniker?: string | string[];
    status?: string | string[];
    ufordelt?: string | string[];
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const params = await searchParams;
  const vis = firstParam(params.vis);
  const calendarView = vis ? CALENDAR_VIEWS[vis] : undefined;
  if (calendarView) {
    return (
      <CalendarViewPage
        {...calendarView}
        date={firstParam(params.dato)}
        technician={firstParam(params.tekniker)}
        status={firstParam(params.status)}
        unassigned={firstParam(params.ufordelt)}
      />
    );
  }

  const t = await getTranslations("common");
  const locale = await getLocale();

  // Montører får se kalenderen, men ikke kontorets verktøy (dispatch-tavla og
  // oppretting av oppdrag fra kontoret er egne, sperrede sider).
  const office = hasPermission(user, "workorders.assign");
  const canCreate = hasPermission(user, "workorders.create");
  const canReports = hasPermission(user, "reports.view");

  // Hent alle ansatte som kan ta oppdrag, innenfor egen avdeling.
  const technicians = await prisma.user.findMany({
    where: staffScope(user),
    orderBy: { name: "asc" },
    take: 200,
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScope(user),
        {
          status: { not: "CANCELLED" },
          OR: [
            { status: { not: "COMPLETED" } },
            { scheduledFor: { gte: thirtyDaysAgo } },
          ],
        },
      ],
    },
    include: {
      customer: true,
      technicians: true,
    },
    orderBy: {
      scheduledFor: "asc",
    },
    take: 500,
  });

  // Ufordelte oppdrag er en kontooppgave. Montører skal ikke møtes av en rød
  // «tildel montør»-vegg de ikke har rettighet til å handle på.
  const unassignedJobs = office
    ? workOrders.filter(
        (workOrder) =>
          workOrder.technicians.length === 0 &&
          workOrder.status !== "COMPLETED",
      )
    : [];

  const statusCounts = new Map<string, number>();
  for (const workOrder of workOrders) {
    statusCounts.set(
      workOrder.status,
      (statusCounts.get(workOrder.status) ?? 0) + 1,
    );
  }
  const legendItems = WORK_ORDER_STATUS_ORDER.filter(
    (status) => status !== "CANCELLED",
  ).map((status) => ({
    status,
    label: t(WORK_ORDER_STATUS_LABEL_KEYS[status]),
    count: statusCounts.get(status) ?? 0,
  }));

  const activeJobs = workOrders.filter(
    (workOrder) => workOrder.status !== "COMPLETED",
  );
  const completedJobs = workOrders.filter(
    (workOrder) => workOrder.status === "COMPLETED",
  );

  const summary: Array<{
    key: string;
    label: string;
    value: number;
    icon: IconName;
    tone: string;
  }> = [
    {
      key: "technicians",
      label: t("calendar.page.summaryTechnicians"),
      value: technicians.length,
      icon: "users",
      tone:
        "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]",
    },
    {
      key: "active",
      label: t("calendar.page.summaryActive"),
      value: activeJobs.length,
      icon: "wrench",
      tone:
        "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
    },
    {
      key: "unassigned",
      label: t("calendar.page.summaryUnassigned"),
      value: unassignedJobs.length,
      icon: "alert",
      tone:
        unassignedJobs.length > 0
          ? "border-[var(--risk-text,#b42318)] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]"
          : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]",
    },
    {
      key: "completed",
      label: t("calendar.page.summaryCompleted"),
      value: completedJobs.length,
      icon: "check",
      tone:
        "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]",
    },
  ];

  // Dagens dato i Oslo, slik at hodet viser samme dag som resten av appen.
  const today = todayInOslo();

  return (
    <CalendarShell
      active="resources"
      canDispatch={office}
      canReports={canReports}
      subtitle={t("calendar.page.subtitle")}
      periodLabel={formatDateLocalized(today, locale)}
      canCreate={canCreate}
      newWorkOrderHref={office ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
    >
      <section
        aria-label={t("calendar.page.summaryLabel")}
        className="office-card grid grid-cols-2 divide-x divide-y divide-[var(--line,#dedcd1)] overflow-hidden lg:grid-cols-4 lg:divide-y-0"
      >
        {summary.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4"
          >
            <div className="min-w-0">
              <p className={`${EYEBROW} leading-tight`}>{item.label}</p>
              <p className="mt-0.5 text-2xl font-black tabular-nums text-[var(--ink,#101310)]">
                {item.value}
              </p>
            </div>
            <span
              aria-hidden="true"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${item.tone}`}
            >
              <Icon name={item.icon} className="h-4 w-4" />
            </span>
          </div>
        ))}
      </section>

      <CalendarLegend title={t("calendar.legend.title")} items={legendItems} />

      {office && unassignedJobs.length > 0 && (
        <section
          aria-labelledby="calendar-unassigned-title"
          className="office-card border-l-4 border-l-[var(--risk,#f04427)] p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]"
            >
              <Icon name="alert" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2
                id="calendar-unassigned-title"
                className="text-base font-black tracking-tight text-[var(--ink,#101310)]"
              >
                {t("calendar.page.unassignedTitle", {
                  count: unassignedJobs.length,
                })}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                {t("calendar.page.unassignedWarning")}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {unassignedJobs.map((workOrder) => (
              <Link
                href={`/oppdrag/${workOrder.id}`}
                key={workOrder.id}
                className="group block rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 transition hover:border-[var(--ink,#101310)] hover:shadow-[2px_2px_0_var(--signal,#d8ff3e)]"
              >
                <span className={`${EYEBROW} block`}>
                  {formatDateRangeLocalized(
                    workOrder.scheduledFor,
                    workOrder.scheduledTo,
                    locale,
                  ) || t("calendar.common.noDate")}
                </span>
                <p className="mt-1 text-sm font-bold leading-tight text-[var(--ink,#101310)] group-hover:underline group-hover:decoration-[var(--signal,#d8ff3e)] group-hover:decoration-2 group-hover:underline-offset-4">
                  {workOrder.title}
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                  <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {workOrder.customer?.name ||
                      t("calendar.common.noCustomer")}
                  </span>
                </p>
                {formatAddress(workOrder.customer) && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                    <Icon name="pin" className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {formatAddress(workOrder.customer)}
                    </span>
                  </p>
                )}
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[var(--ink,#101310)]">
                  {t("calendar.page.assignTechnician")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section
        aria-labelledby="calendar-technicians-title"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
          <div className="min-w-0">
            <p className={EYEBROW}>{t("calendar.page.teamEyebrow")}</p>
            <h2
              id="calendar-technicians-title"
              className="text-lg font-black tracking-tight text-[var(--ink,#101310)] sm:text-xl"
            >
              {t("calendar.page.technicianOverview")}
            </h2>
          </div>
          <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold tabular-nums text-[var(--muted,#62685f)]">
            {t("calendar.page.technicianCount", {
              count: technicians.length,
            })}
          </span>
        </div>

        {technicians.length === 0 ? (
          <div className="office-card p-8 text-center">
            <p className="text-sm font-medium text-[var(--muted,#62685f)]">
              {t("calendar.page.noTechnicians")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {technicians.map((technician) => {
              const techJobs = workOrders.filter((workOrder) =>
                workOrder.technicians.some(
                  (assigned) => assigned.id === technician.id,
                ),
              );
              const active = techJobs.filter(
                (workOrder) => workOrder.status !== "COMPLETED",
              );
              const completed = techJobs.filter(
                (workOrder) => workOrder.status === "COMPLETED",
              );

              return (
                <article
                  key={technician.id}
                  className="office-card flex h-full flex-col p-4"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
                      >
                        <Icon name="users" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-black text-[var(--ink,#101310)]">
                          {technician.name ??
                            t("calendar.filters.unnamedTechnician")}
                        </h3>
                        <p className={`${EYEBROW} mt-0.5`}>
                          {t("calendar.page.activeCount", {
                            count: active.length,
                          })}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex min-w-8 shrink-0 items-center justify-center rounded-lg border px-2 py-1 text-xs font-black tabular-nums ${
                        active.length > 0
                          ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                          : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
                      }`}
                    >
                      {active.length}
                    </span>
                  </div>

                  <div className="flex-1 space-y-2 pt-3">
                    {active.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]/50 p-4 text-center">
                        <p className="text-xs font-medium italic text-[var(--muted,#62685f)]">
                          {t("calendar.page.noActive")}
                        </p>
                      </div>
                    ) : (
                      active.map((workOrder) => {
                        const statusLabel =
                          WORK_ORDER_STATUS_LABEL_KEYS[
                            workOrder.status as keyof typeof WORK_ORDER_STATUS_LABEL_KEYS
                          ];

                        return (
                          <Link
                            href={`/oppdrag/${workOrder.id}`}
                            key={workOrder.id}
                            className="group block rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 transition hover:border-[var(--ink,#101310)] hover:shadow-[2px_2px_0_var(--signal,#d8ff3e)]"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)]">
                                <Icon
                                  name="calendar"
                                  className="h-3.5 w-3.5 shrink-0"
                                />
                                {formatDateRangeLocalized(
                                  workOrder.scheduledFor,
                                  workOrder.scheduledTo,
                                  locale,
                                ) || t("calendar.common.noDate")}
                              </span>
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
                                <span
                                  aria-hidden="true"
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{
                                    backgroundColor: workOrderStatusColor(
                                      workOrder.status,
                                    ),
                                  }}
                                />
                                {statusLabel ? t(statusLabel) : workOrder.status}
                              </span>
                            </div>
                            <p className="mt-1.5 text-sm font-bold leading-tight text-[var(--ink,#101310)] group-hover:underline group-hover:decoration-[var(--signal,#d8ff3e)] group-hover:decoration-2 group-hover:underline-offset-4">
                              {workOrder.title}
                            </p>
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                              <Icon
                                name="building"
                                className="h-3.5 w-3.5 shrink-0"
                              />
                              <span className="truncate">
                                {workOrder.customer?.name ||
                                  t("calendar.common.noCustomer")}
                              </span>
                            </p>
                            {formatAddress(workOrder.customer) && (
                              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                                <Icon
                                  name="pin"
                                  className="h-3.5 w-3.5 shrink-0"
                                />
                                <span className="truncate">
                                  {formatAddress(workOrder.customer)}
                                </span>
                              </p>
                            )}
                          </Link>
                        );
                      })
                    )}
                  </div>

                  {completed.length > 0 && (
                    <div className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3">
                      <p className={`${EYEBROW} mb-2`}>
                        {t("calendar.page.recentlyCompleted", {
                          count: completed.length,
                        })}
                      </p>
                      <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                        {completed.map((workOrder) => (
                          <Link
                            href={`/oppdrag/${workOrder.id}`}
                            key={workOrder.id}
                            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition hover:bg-[var(--paper,#f2efe6)]"
                          >
                            <span className="truncate text-xs font-medium text-[var(--muted,#62685f)]">
                              {workOrder.title}
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--muted,#62685f)]">
                              <Icon name="check" className="h-3.5 w-3.5" />
                              {t("calendar.page.completed")}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </CalendarShell>
  );
}
