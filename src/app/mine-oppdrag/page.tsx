import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { readableTextColor } from "@/lib/colors";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatAddress } from "@/lib/address";
import { formatDateRange } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import StatusBadge from "@/components/StatusBadge";

/** Feltportalen viser de nærmeste oppdragene, ikke hele historikken. */
const LIST_LIMIT = 50;

const LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  scheduledFor: true,
  scheduledTo: true,
  customer: {
    select: { id: true, name: true, address: true, postalCode: true, city: true },
  },
  tags: { select: { id: true, name: true, color: true } },
} as const;

export default async function TechnicianDashboard({ 
  searchParams 
}: { 
  searchParams: Promise<{ q?: string }> 
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const t = await getTranslations("common");
  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q?.trim() || "";
  const accessScope = workOrderScope(user);

  // 1. Hent oppdrag som er tildelt denne montøren
  let assignedWorkOrders: any[] = [];
  // 2. Hent oppdrag som IKKE har noen tildelte montører i det hele tatt
  let unassignedWorkOrders: any[] = [];

  const searchOr: Prisma.WorkOrderWhereInput = searchQuery
    ? {
        OR: [
          { title: { contains: searchQuery, mode: 'insensitive' } },
          { description: { contains: searchQuery, mode: 'insensitive' } },
          { customer: { name: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { city: { contains: searchQuery, mode: 'insensitive' } } },
          { customer: { address: { contains: searchQuery, mode: 'insensitive' } } },
        ],
      }
    : {};

  // Aktive/kommende oppdrag. Fullførte holdes utenfor oversikten og hentes
  // separat til historikkseksjonen.
  assignedWorkOrders = await prisma.workOrder.findMany({
    where: {
      AND: [accessScope, searchOr],
      technicians: { some: { id: user.id } },
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
    select: LIST_SELECT,
    orderBy: { scheduledFor: 'asc' },
    take: LIST_LIMIT,
  });

  unassignedWorkOrders = await prisma.workOrder.findMany({
    where: {
      AND: [accessScope, searchOr],
      technicians: { none: {} },
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
    select: LIST_SELECT,
    orderBy: { scheduledFor: 'asc' },
    take: LIST_LIMIT,
  });

  const completedAssigned = await prisma.workOrder.findMany({
    where: {
      AND: [accessScope, searchOr],
      technicians: { some: { id: user.id } },
      status: 'COMPLETED',
    },
    select: LIST_SELECT,
    orderBy: { scheduledFor: 'desc' },
    take: LIST_LIMIT,
  });

  const activeAssigned = assignedWorkOrders;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900">{t("orders.fieldList.greeting", { name: user.name || t("orders.detail.roleTechnician") })}</h1>
            <p className="text-sm text-gray-500 font-medium">
              {t("orders.fieldList.subtitle")}
              {user.department ? ` • ${t("orders.fieldList.department", { name: user.department.name })}` : ` • ${t("orders.fieldList.noDepartment")}`}
            </p>
          </div>
          <form action="/api/auth/signout" method="POST">
            <button type="submit" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap">
              {t("orders.fieldList.logOut")}
            </button>
          </form>
        </div>

        {/* SØKEFELT */}
        <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-gray-200">
          <form method="GET" action="/mine-oppdrag" className="flex gap-2 sm:gap-3 flex-wrap">
            <input
              type="text"
              name="q"
              defaultValue={searchQuery}
              placeholder={t("orders.fieldList.searchPlaceholder")}
              className="flex-1 min-w-[200px] border-2 border-gray-200 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-600 bg-gray-50"
            />
            <button type="submit" className="bg-blue-700 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap text-sm">
              {t("orders.fieldList.search")}
            </button>
            {searchQuery && (
              <Link href="/mine-oppdrag" className="bg-gray-100 text-gray-600 px-4 py-3 rounded-xl font-bold hover:bg-gray-200 transition flex items-center justify-center whitespace-nowrap text-sm">
                {t("orders.fieldList.reset")}
              </Link>
            )}
          </form>
        </div>

        {/* SEKSJON 1: KALENDER / KOMMENDE OPPRETTEDE OPPRAG (Tildelt deg) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-gray-900">{t("orders.fieldList.upcomingTitle", { count: activeAssigned.length })}</h2>
          </div>

          {activeAssigned.length === 0 ? (
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-200 text-center">
              <p className="text-sm text-gray-500 italic">{t("orders.fieldList.noActive")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeAssigned.map(wo => (
                <Link
                  key={wo.id}
                  href={`/mine-oppdrag/${wo.id}`}
                  className="block bg-white hover:bg-blue-50/40 border-2 border-gray-200 hover:border-blue-300 p-3 sm:p-4 rounded-2xl transition shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                    <StatusBadge status={wo.status} />
                  </div>

                  <p className="text-[10px] text-gray-600 font-medium">
                    🏢 {wo.customer.name}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}
                  {wo.tags && wo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {wo.tags.map((tag: any) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 rounded-full text-[9px] font-bold shadow-sm"
                          suppressHydrationWarning
                          style={{ backgroundColor: tag.color || "#3b82f6", color: readableTextColor(tag.color || "#3b82f6") }}
                        >
                          🏷️ {tag.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between items-center text-[10px] pt-2 border-t border-gray-100 text-gray-500 font-medium">
                    <span className="font-bold text-gray-700 bg-gray-100 px-2 py-1 rounded-lg">
                      📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo) || t("orders.fieldList.noDate")}
                    </span>
                    <span className="font-black text-blue-600 hover:underline whitespace-nowrap">
                      {t("orders.fieldList.openWorkOrder")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* SEKSJON 2: IKKE TILDELTE OPPDRAG */}
        {unassignedWorkOrders.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900">{t("orders.fieldList.unassignedTitle", { count: unassignedWorkOrders.length })}</h2>
              <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-1 rounded-full">{t("orders.fieldList.requiresAssignment")}</span>
            </div>

            <div className="space-y-3">
              {unassignedWorkOrders.map(wo => (
                <Link
                  key={wo.id}
                  href={`/mine-oppdrag/${wo.id}`}
                  className="block bg-amber-50/40 hover:bg-amber-50 border-2 border-amber-200 hover:border-amber-300 p-3 sm:p-4 rounded-2xl transition shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <h3 className="font-black text-gray-900 text-base">{wo.title}</h3>
                    <StatusBadge status={wo.status} />
                  </div>

                  <p className="text-[10px] text-gray-600 font-medium">
                    🏢 {wo.customer.name}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}

                  <div className="flex justify-between items-center text-[10px] pt-2 border-t border-amber-200 text-gray-600 font-medium">
                    <span className="font-bold bg-white px-2 py-1 rounded-lg border border-amber-200">
                      📅 {formatDateRange(wo.scheduledFor, wo.scheduledTo) || t("orders.fieldList.noDate")}
                    </span>
                    <span className="font-black text-amber-800 hover:underline whitespace-nowrap">
                      {t("orders.fieldList.takeWorkOrder")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* SEKSJON 3: HISTORIKK OVER FULLFØRTE OPPRAG */}
        {completedAssigned.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <h2 className="text-lg font-black text-gray-900">{t("orders.fieldList.historyTitle", { count: completedAssigned.length })}</h2>

            <div className="space-y-3">
              {completedAssigned.map(wo => (
                <Link
                  key={wo.id}
                  href={`/mine-oppdrag/${wo.id}`}
                  className="block bg-white hover:bg-gray-50 border-2 border-gray-200 p-3 sm:p-4 rounded-2xl transition opacity-75 hover:opacity-100 shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                    <h3 className="font-bold text-gray-800 text-base">{wo.title}</h3>
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="text-[10px] text-gray-500 font-medium">
                    {t("orders.fieldList.archived", { customer: wo.customer?.name || t("orders.reportsPage.noCustomer") })}
                  </p>
                  {formatAddress(wo.customer) && (
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">
                      📍 {formatAddress(wo.customer)}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
