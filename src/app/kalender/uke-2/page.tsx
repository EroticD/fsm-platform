import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import FullCalendarClient from "@/app/kalender/FullCalendarClient";
import { toCalendarEvent } from "@/lib/calendar-events";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { addMonthsUtc, parseDateOnly, todayInOslo } from "@/lib/dates";

export default async function BiweeklyCalendarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");
  const canCreate = hasPermission(user, "workorders.create");
  const t = await getTranslations("common");

  // Hent oppdrag i en bred datoøk (6 måneder bakover og fremover)
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
      scheduledFor: 'asc',
    },
    take: 1000,
  });

  const events = workOrders.flatMap((wo) => {
    const event = toCalendarEvent(wo);
    return event ? [event] : [];
  });

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex justify-between items-center border-b border-gray-300 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t("calendar.biweekly.title")}</h1>
            <p className="text-gray-600 mt-1">{t("calendar.biweekly.subtitle")}</p>
          </div>
          <div className="flex gap-3">
            <Link href="/kalender" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition">
              {t("calendar.common.home")}
            </Link>
            {canCreate && (
              <Link href="/oppdrag/ny" className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-sm transition flex items-center gap-2">
                {t("calendar.common.newWorkOrder")}
              </Link>
            )}
          </div>
        </div>

        {/* FANER (TABS) */}
        <div className="flex gap-1 bg-gray-200 p-1 rounded-xl w-max">
          <Link href="/kalender" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            {t("calendar.common.resources")}
          </Link>
          <Link href="/kalender/maned" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            {t("calendar.common.month")}
          </Link>
          <Link href="/kalender/uke" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            {t("calendar.common.week")}
          </Link>
          <Link href="/kalender/uke-2" className="px-5 py-2 rounded-lg text-sm font-bold bg-white shadow-sm text-gray-900 pointer-events-none">
            {t("calendar.common.biweekly")}
          </Link>
          <Link href="/kalender/dispatch" className="px-5 py-2 rounded-lg text-sm font-bold text-gray-600 hover:text-gray-900 transition">
            {t("calendar.common.dispatch")}
          </Link>
        </div>

        {/* KALENDER */}
        <FullCalendarClient
          events={events}
          view="biweekly"
          weekNumbers={true}
        />

      </div>
    </div>
  );
}
