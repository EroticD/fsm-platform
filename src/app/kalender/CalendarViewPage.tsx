import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getLocale, getTranslations } from "next-intl/server";
import FullCalendarClient from "@/app/kalender/FullCalendarClient";
import CalendarFilters from "@/app/kalender/CalendarFilters";
import CalendarShell from "@/app/kalender/CalendarShell";
import { toCalendarEvent } from "@/lib/calendar-events";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";
import {
  addMonthsUtc,
  formatDateLocalized,
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
 * Felles implementasjon for måned-, uke- og to-ukersvisningen. Alle tre nås
 * via `/kalender?vis=...`, slik at visningsbyttet og URL-en alltid stemmer.
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
  // Dato-API-et krever workorders.update, ikke workorders.edit. Montørene skal
  // kunne flytte feltjobber i egen avdeling, så kalenderen tilbyr dra-og-slipp
  // til alle som faktisk kan lagre datoen. Den fulle redigeringssiden krever
  // fortsatt workorders.edit og styres separat.
  const canReschedule = hasPermission(user, "workorders.update");
  const canEdit = hasPermission(user, "workorders.edit");
  const canDispatch = hasPermission(user, "workorders.assign");
  const canReports = hasPermission(user, "reports.view");
  const t = await getTranslations("common");
  const locale = await getLocale();

  const today = todayInOslo();
  const initialDate = normalizeCalendarDate(date, today);
  const todayDate = parseDateOnly(today) ?? new Date();

  // Hent oppdrag i en bred datoøk (6 måneder bakover og fremover), slik at
  // FullCalendar kan navigere uten å hente nye data for hver visning. Både
  // vinduet og 1000-grensen vises for brukeren lenger ned.
  const sixMonthsAgo = addMonthsUtc(todayDate, -6);
  const sixMonthsAhead = addMonthsUtc(todayDate, 6);
  const windowStart = toDateOnly(sixMonthsAgo);
  const windowEnd = toDateOnly(sixMonthsAhead);

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

  const workOrders = await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScope(user),
        {
          status: statusFilter || { not: "CANCELLED" },
          scheduledFor: { not: null, lte: sixMonthsAhead },
          OR: [
            { scheduledFor: { gte: sixMonthsAgo } },
            // Tar med oppdrag som startet før vinduet og varer inn i det.
            { scheduledTo: { gte: sixMonthsAgo } },
          ],
          ...(technicianFilter
            ? { technicians: { some: { id: technicianFilter } } }
            : {}),
          ...(unassignedFilter ? { technicians: { none: {} } } : {}),
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
    take: 1000,
  });

  const events = workOrders.flatMap((workOrder) => {
    const event = toCalendarEvent(workOrder);
    return event
      ? [
          {
            ...event,
            extendedProps: {
              ...event.extendedProps,
              status: workOrder.status,
            },
          },
        ]
      : [];
  });

  const truncated = workOrders.length >= 1000;
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
