import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getLocale, getTranslations } from "next-intl/server";
import FullCalendarClient from "@/app/kalender/FullCalendarClient";
import CalendarFilters from "@/app/kalender/CalendarFilters";
import CalendarShell from "@/app/kalender/CalendarShell";
import { toVisitCalendarEvent } from "@/lib/calendar-events";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";
import {
  addDaysUtc,
  addMonthsUtc,
  formatDateLocalized,
  osloDayStart,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import {
  calendarPeriodLabel,
  normalizeCalendarDate,
  type CalendarTabKey,
  type CalendarTabQuery,
} from "@/lib/calendar-tabs";
import { WORK_ORDER_STATUS_ORDER } from "@/lib/work-order-status-colors";

/**
 * Felles implementasjon for måned-, uke-, to-ukers-, timegrid- og dagvisning.
 * Alle nås via `/kalender?vis=...`, slik at visningsbyttet og URL-en alltid
 * stemmer.
 *
 * `dato` er ankerdatoen for visningen. FullCalendar oppdaterer den ved
 * navigering, slik at refresh, deling og tilbake-navigering beholder perioden.
 */
export default async function CalendarViewPage({
  view,
  visParam,
  active,
  subtitleKey,
  date,
  technician,
  status,
  unassigned,
}: {
  view: string;
  visParam: string;
  active: CalendarTabKey;
  subtitleKey: string;
  date?: string;
  technician?: string;
  status?: string;
  unassigned?: string;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const canCreate = hasPermission(user, "workorders.create");
  // Flytting av en visitt er en planleggingshandling og krever
  // workorders.assign, samme rettighet som PATCH /api/visits/[id] håndhever.
  // Kalenderen skal derfor ikke tilby dra-og-slipp til brukere som bare kan
  // oppdatere et oppdrag.
  const canReschedule = hasPermission(user, "workorders.assign");
  const canEdit = hasPermission(user, "workorders.edit");
  const canDispatch = hasPermission(user, "workorders.assign");
  const canReports = hasPermission(user, "reports.view");
  const t = await getTranslations("common");
  const locale = await getLocale();

  const today = todayInOslo();
  const initialDate = normalizeCalendarDate(date, today);
  const todayDate = parseDateOnly(today) ?? new Date();

  // Hent visiter i en bred datoøk (6 måneder bakover og fremover), slik at
  // FullCalendar kan navigere uten å hente nye data for hver visning. Både
  // vinduet og 1000-grensen vises for brukeren lenger ned.
  const sixMonthsAgo = addMonthsUtc(todayDate, -6);
  const sixMonthsAhead = addMonthsUtc(todayDate, 6);
  const windowStart = toDateOnly(sixMonthsAgo);
  const windowEnd = toDateOnly(sixMonthsAhead);
  const windowStartInstant = osloDayStart(windowStart);
  const windowEndInstant = osloDayStart(toDateOnly(addDaysUtc(sixMonthsAhead, 1)));

  const technicians = await prisma.user.findMany({
    where: staffScope(user),
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 200,
  });

  // Ukjente verdier i URL-en skal ikke gi en tom kalender uten forklaring.
  const technicianFilter = technicians.some(
    (candidate) => candidate.id === technician,
  )
    ? technician ?? ""
    : "";
  const requestedStatus = status?.trim().toUpperCase() ?? "";
  const statusFilter =
    WORK_ORDER_STATUS_ORDER.find(
      (candidate) =>
        candidate === requestedStatus && candidate !== "CANCELLED",
    ) ?? "";
  const unassignedFilter = canDispatch && unassigned === "1";

  const workOrderFilter: Prisma.WorkOrderWhereInput = {
    AND: [
      workOrderScope(user),
      { status: statusFilter || { not: "CANCELLED" } },
    ],
  };

  // Kalenderen planlegger visiter, ikke oppdragets avledede datoperiode.
  // Uten visiter vises ingen hendelse – vi lager aldri en syntetisk tid for
  // et eldre oppdrag. Montør- og ufordelt-filteret gjelder visittens egne
  // montører, som er den faktiske bemanningen av tidsblokken.
  const visits = await prisma.visit.findMany({
    where: {
      startsAt: { lt: windowEndInstant },
      endsAt: { gt: windowStartInstant },
      status: { not: "CANCELLED" },
      workOrder: workOrderFilter,
      ...(technicianFilter
        ? { technicians: { some: { userId: technicianFilter } } }
        : {}),
      ...(unassignedFilter ? { technicians: { none: {} } } : {}),
    },
    include: {
      technicians: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      workOrder: {
        include: { customer: true },
      },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 1000,
  });

  const events = visits.flatMap((visit) => {
    const event = toVisitCalendarEvent(visit);
    return event ? [event] : [];
  });

  const truncated = visits.length >= 1000;
  const tabQuery: CalendarTabQuery = {
    date: initialDate,
    technician: technicianFilter,
    status: statusFilter,
    unassigned: unassignedFilter,
  };

  const subtitle = canReschedule
    ? t(subtitleKey)
    : t("calendar.a11y.readOnlySubtitle");
  const periodLabel = calendarPeriodLabel({
    view: visParam,
    date: initialDate,
    locale,
    weekLabel: t("calendar.common.week"),
  });

  return (
    <CalendarShell
      active={active}
      canDispatch={canDispatch}
      canReports={canReports}
      query={tabQuery}
      subtitle={subtitle}
      periodLabel={periodLabel}
      canCreate={canCreate}
      newWorkOrderHref={canDispatch ? "/oppdrag/ny" : "/mine-oppdrag/ny"}
    >
      <CalendarFilters
        visParam={visParam}
        date={initialDate}
        technician={technicianFilter}
        status={statusFilter}
        unassigned={unassignedFilter}
        technicians={technicians}
        showUnassigned={canDispatch}
      />

      {visits.length === 0 && (
        <div
          role="status"
          className="office-card px-4 py-3 text-sm font-medium text-[var(--muted,#62685f)]"
        >
          {t("calendar.visit.empty")}
        </div>
      )}

      <div
        className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs sm:px-4 ${
          truncated
            ? "border-[#e4c98f] bg-[#fdf5e4] text-[#7a4f0c]"
            : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--muted,#62685f)]"
        }`}
        role="note"
      >
        <span
          aria-hidden="true"
          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
        <div>
          <p>
            {t("calendar.window.notice", {
              from: formatDateLocalized(windowStart, locale),
              to: formatDateLocalized(windowEnd, locale),
            })}
          </p>
          {truncated && (
            <p className="mt-1 font-semibold">
              {t("calendar.window.truncated")}
            </p>
          )}
        </div>
      </div>

      <FullCalendarClient
        events={events}
        view={view}
        initialDate={initialDate}
        visParam={visParam}
        technician={technicianFilter || undefined}
        status={statusFilter || undefined}
        unassigned={unassignedFilter}
        weekNumbers={true}
        canEdit={canReschedule}
        canOpenEditor={canEdit}
      />
    </CalendarShell>
  );
}
