import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import FullCalendarClient from "@/app/kalender/FullCalendarClient";
import CalendarTabs from "@/app/kalender/CalendarTabs";
import { toCalendarEvent } from "@/lib/calendar-events";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { addMonthsUtc, parseDateOnly, todayInOslo } from "@/lib/dates";
import type { CalendarTabKey } from "@/lib/calendar-tabs";

/**
 * Felles implementasjon for måned-, uke- og to-ukersvisningen. De tre rutene
 * er egne URL-er fordi de er egne faner, men de skal ikke vedlikeholde hver
 * sin kopi av spørring, tilgangskontroll og header.
 */
export default async function CalendarViewPage({
  view,
  active,
  titleKey,
  subtitleKey,
}: {
  view: string;
  active: CalendarTabKey;
  titleKey: string;
  subtitleKey: string;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");
  const canCreate = hasPermission(user, "workorders.create");
  const canEdit = hasPermission(user, "workorders.edit");
  const canDispatch = hasPermission(user, "workorders.assign");
  const canReports = hasPermission(user, "reports.view");
  const t = await getTranslations("common");

  // Hent oppdrag i en bred datoøk (6 måneder bakover og fremover), slik at
  // FullCalendar kan navigere uten å hente nye data for hver visning.
  const today = parseDateOnly(todayInOslo()) ?? new Date();
  const sixMonthsAgo = addMonthsUtc(today, -6);
  const sixMonthsAhead = addMonthsUtc(today, 6);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      AND: [
        workOrderScope(user),
        {
          status: { not: "CANCELLED" },
          scheduledFor: { not: null, lte: sixMonthsAhead },
          OR: [
            { scheduledFor: { gte: sixMonthsAgo } },
            // Tar med oppdrag som startet før vinduet og varer inn i det.
            { scheduledTo: { gte: sixMonthsAgo } },
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
    take: 1000,
  });

  const events = workOrders.flatMap((wo) => {
    const event = toCalendarEvent(wo);
    return event ? [event] : [];
  });

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex flex-col gap-3 border-b border-gray-300 pb-4 sm:flex-row sm:items-center sm:justify-between sm:pb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 md:text-3xl">
              {t(titleKey)}
            </h1>
            <p className="mt-1 text-sm text-gray-600">{t(subtitleKey)}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/kalender"
              className="rounded-lg border bg-white px-4 py-2 font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              {t("calendar.common.home")}
            </Link>
            {canCreate && (
              <Link
                href="/oppdrag/ny"
                className="flex items-center gap-2 rounded-lg bg-[var(--primary-color)] px-5 py-2 font-bold text-white shadow-sm transition hover:opacity-90"
              >
                {t("calendar.common.newWorkOrder")}
              </Link>
            )}
          </div>
        </div>

        <CalendarTabs
          active={active}
          canDispatch={canDispatch}
          canReports={canReports}
        />

        <FullCalendarClient
          events={events}
          view={view}
          weekNumbers={true}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
