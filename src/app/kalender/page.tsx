import { redirect } from "next/navigation";
import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatAddress } from "@/lib/address";
import { formatDateRangeLocalized } from "@/lib/dates";
import CalendarTabs from "@/app/kalender/CalendarTabs";
import CalendarViewPage from "@/app/kalender/CalendarViewPage";
import WorkOrderStatusLegend from "@/components/WorkOrderStatusLegend";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";
import type { CalendarTabKey } from "@/lib/calendar-tabs";
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  WORK_ORDER_STATUS_ORDER,
} from "@/lib/work-order-status-colors";

type CalendarViewParam = {
  view: string;
  active: CalendarTabKey;
  titleKey: string;
  subtitleKey: string;
};

// Én kalenderrute, tre visninger. De gamle rutene redirecter hit.
const CALENDAR_VIEWS: Record<string, CalendarViewParam> = {
  maned: {
    view: "dayGridMonth",
    active: "month",
    titleKey: "calendar.month.title",
    subtitleKey: "calendar.month.subtitle",
  },
  uke: {
    view: "dayGridWeek",
    active: "week",
    titleKey: "calendar.week.title",
    subtitleKey: "calendar.week.subtitle",
  },
  "2uker": {
    view: "biweekly",
    active: "biweekly",
    titleKey: "calendar.biweekly.title",
    subtitleKey: "calendar.biweekly.subtitle",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.kalender") };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ vis?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const params = await searchParams;
  const vis = Array.isArray(params.vis) ? params.vis[0] : params.vis;
  const calendarView = vis ? CALENDAR_VIEWS[vis] : undefined;
  if (calendarView) {
    return <CalendarViewPage {...calendarView} />;
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
    orderBy: { name: 'asc' },
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
            { scheduledFor: { gte: thirtyDaysAgo } }
          ],
        },
      ],
    },
    include: {
      customer: true,
      technicians: true
    },
    orderBy: {
      scheduledFor: 'asc'
    },
    take: 500,
  });

  // Ufordelte oppdrag er en kontooppgave. Montører skal ikke møtes av en rød
  // «tildel montør»-vegg de ikke har rettighet til å handle på.
  const unassignedJobs = office
    ? workOrders.filter(wo => wo.technicians.length === 0 && wo.status !== "COMPLETED")
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

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t("calendar.page.title")}</h1>
            <p className="text-gray-600 mt-1 text-sm">{t("calendar.page.subtitle")}</p>
          </div>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            <Link href="/" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition text-sm">
              {t("calendar.common.home")}
            </Link>
            {canCreate && (
              <Link href="/oppdrag/ny" className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-lg font-bold hover:opacity-90 shadow-sm transition flex items-center gap-2 text-sm">
                {t("calendar.common.newWorkOrder")}
              </Link>
            )}
          </div>
        </div>

        {/* FANER (TABS) FOR Å BYTTE VISNING */}
        <CalendarTabs
          active="resources"
          canDispatch={office}
          canReports={canReports}
        />

        <WorkOrderStatusLegend
          title={t("calendar.legend.title")}
          items={legendItems}
        />

        {/* VARSEL: UFORDELTE OPPDRAG */}
        {office && unassignedJobs.length > 0 && (
          <div className="bg-red-50 border-2 border-red-200 p-4 sm:p-6 rounded-2xl shadow-sm">
            <h2 className="font-bold text-red-800 text-lg flex items-center gap-2 mb-2">
              {t("calendar.page.unassignedTitle", { count: unassignedJobs.length })}
            </h2>
            <p className="text-sm text-red-800 mb-4">{t("calendar.page.unassignedWarning")}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {unassignedJobs.map(wo => (
                <Link href={`/oppdrag/${wo.id}`} key={wo.id} className="block group bg-white p-3 sm:p-4 rounded-xl border border-red-100 hover:border-red-400 shadow-sm transition">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-bold text-red-800 uppercase">
                      {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) || t("calendar.common.noDate")}
                    </span>
                  </div>
                  <p className="font-bold text-gray-900 text-sm group-hover:text-red-700">{wo.title}</p>
                  <p className="text-xs text-gray-600 mt-1 truncate">🏢 {wo.customer?.name || t("calendar.common.noCustomer")}</p>
                  {formatAddress(wo.customer) && (
                    <p className="text-xs text-gray-600 mt-0.5">📍 {formatAddress(wo.customer)}</p>
                  )}
                  <div className="mt-3">
                    <span className="bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg shadow-sm">{t("calendar.page.assignTechnician")}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* RESSURSOVERSIKT: MONTØRER */}
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-4">{t("calendar.page.technicianOverview")}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {technicians.map(tech => {
              const techJobs = workOrders.filter(wo => wo.technicians.some(t => t.id === tech.id));
              const activeJobs = techJobs.filter(wo => wo.status !== "COMPLETED");
              const completedJobs = techJobs.filter(wo => wo.status === "COMPLETED");

              return (
                <div key={tech.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-5 flex flex-col h-full">
                  <div className="flex justify-between items-center border-b pb-3 sm:pb-4 mb-3 sm:mb-4">
                    <h3 className="font-bold text-gray-900 text-base sm:text-lg flex items-center gap-2">
                      👷 {tech.name}
                    </h3>
                    <span className="bg-blue-100 text-blue-950 text-xs font-bold px-2 py-1 rounded-lg">
                      {t("calendar.page.activeCount", { count: activeJobs.length })}
                    </span>
                  </div>

                  <div className="flex-1 space-y-3">
                    {activeJobs.length === 0 ? (
                      <div className="bg-gray-50 border border-dashed rounded-xl p-4 sm:p-6 text-center">
                        <p className="text-xs text-gray-600 italic font-medium">{t("calendar.page.noActive")}</p>
                      </div>
                    ) : (
                      activeJobs.map(wo => {
                        let badgeColor = "bg-gray-100 text-gray-900";
                        let badgeText = t("calendar.page.statusPlanned");
                        if (wo.status === "OPEN") { badgeColor = "bg-purple-100 text-purple-950"; badgeText = t("calendar.page.statusOpen"); }
                        else if (wo.status === "IN_PROGRESS") { badgeColor = "bg-blue-100 text-blue-950"; badgeText = t("calendar.page.statusInProgress"); }
                        else if (wo.status === "WAITING") { badgeColor = "bg-orange-100 text-orange-950"; badgeText = t("calendar.page.statusWaiting"); }
                        else if (wo.status === "PENDING") { badgeColor = "bg-yellow-100 text-yellow-950"; badgeText = t("calendar.page.statusPending"); }

                        return (
                          <Link href={`/oppdrag/${wo.id}`} key={wo.id} className="block group">
                            <div className="bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200 group-hover:border-blue-400 hover:shadow-sm transition">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                                  {formatDateRangeLocalized(wo.scheduledFor, wo.scheduledTo, locale) || t("calendar.common.noDate")}
                                </span>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${badgeColor}`}>
                                  {badgeText}
                                </span>
                              </div>
                              <p className="font-bold text-gray-900 text-sm group-hover:text-blue-700 leading-tight mb-1">{wo.title}</p>
                              <p className="text-xs text-gray-600 truncate">🏢 {wo.customer?.name || t("calendar.common.noCustomer")}</p>
                              {formatAddress(wo.customer) && (
                                <p className="text-xs text-gray-600">📍 {formatAddress(wo.customer)}</p>
                              )}
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>

                  {completedJobs.length > 0 && (
                    <div className="mt-4 pt-3 border-t">
                      <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">
                        {t("calendar.page.recentlyCompleted", { count: completedJobs.length })}
                      </p>
                      <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
                        {completedJobs.map(wo => (
                          <Link href={`/oppdrag/${wo.id}`} key={wo.id} className="flex justify-between items-center bg-green-50/50 p-2 rounded-lg border border-green-100 hover:bg-green-50 transition">
                            <span className="text-xs font-medium text-gray-700 truncate max-w-[200px]">{wo.title}</span>
                            <span className="text-xs bg-green-100 text-green-950 px-1.5 py-0.5 rounded font-bold">{t("calendar.page.completed")}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
