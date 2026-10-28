import { redirect } from "next/navigation";
import type { Prisma, WorkStatus } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import CalendarTabs from "@/app/kalender/CalendarTabs";
import DispatchBoard from "@/app/kalender/dispatch/DispatchBoard";
import type {
  DispatchDay,
  DispatchWorkOrder,
} from "@/app/kalender/dispatch/types";
import { markdownToPlainText } from "@/lib/markdown";
import { formatAddress } from "@/lib/address";
import {
  addDaysUtc,
  formatDateLocalized,
  formatDateRangeLocalized,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { resolveDateRange } from "@/lib/date-range";
import { parsePage, pageWindow } from "@/lib/pagination";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { staffScope, workOrderScope } from "@/lib/access";
import {
  STATUS_OPTION_ORDER,
  allowedTransitions,
} from "@/lib/work-order-status";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Dispatch-tavla: oppdrag gruppert per dag, med én kolonne per montør.
 * Alle handlinger går via server actions som kontrollerer rettighetene på
 * nytt. Tavla viser bare lovlige statusoverganger og feilmeldinger på raden
 * som feilet.
 */
export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{
    fra?: string | string[];
    til?: string | string[];
    q?: string | string[];
    side?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.assign")) redirect("/");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const canReports = hasPermission(user, "reports.view");
  const canUpdateStatus = hasPermission(user, "workorders.update");
  const canCancel = hasPermission(user, "workorders.edit");
  const isAdmin = user.role === "ADMIN";

  const query = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const today = parseDateOnly(todayInOslo());
  const defaultFrom = today ? toDateOnly(today) : todayInOslo();
  const defaultTo = today
    ? toDateOnly(addDaysUtc(today, 7))
    : todayInOslo();
  const range = resolveDateRange({
    params: {
      from: firstParam(params.fra),
      to: firstParam(params.til),
    },
    defaultFrom,
    defaultTo,
  });

  const filters: Prisma.WorkOrderWhereInput[] = [
    workOrderScope(user),
    { status: { not: "COMPLETED" } },
    { status: { not: "CANCELLED" } },
  ];

  if (range.invalid) {
    // Ugyldig periode skal ikke gi et stille, tomt eller misvisende resultat.
    filters.push({ id: { in: [] } });
  } else {
    if (range.from) filters.push({ scheduledFor: { gte: range.from } });
    if (range.to) filters.push({ scheduledFor: { lte: range.to } });
  }

  if (query) {
    const contains = { contains: query, mode: "insensitive" as const };
    filters.push({
      OR: [
        { title: contains },
        { address: contains },
        { city: contains },
        { customer: { name: contains } },
        { orderNumber: contains },
      ],
    });
  }

  const where: Prisma.WorkOrderWhereInput = { AND: filters };

  const [total, unassignedCount, technicians] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.count({
      where: { AND: [where, { technicians: { none: {} } }] },
    }),
    prisma.user.findMany({
      where: staffScope(user),
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    }),
  ]);

  const pagination = pageWindow(
    parsePage(firstParam(params.side)),
    total,
    80,
  );

  const workOrders = await prisma.workOrder.findMany({
    where,
    include: {
      customer: true,
      technicians: true,
      product: true,
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    skip: pagination.skip,
    take: pagination.take,
  });

  const groups = new Map<
    string,
    { date: string; label: string; workOrders: DispatchWorkOrder[] }
  >();

  for (const workOrder of workOrders) {
    const date = toDateOnly(workOrder.scheduledFor);
    const key = date || "9999-12-31";
    const group = groups.get(key) ?? {
      date: date || "none",
      label: date
        ? formatDateLocalized(date, locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })
        : t("calendar.common.noDate"),
      workOrders: [],
    };

    const allowed = new Set(
      allowedTransitions(workOrder.status as WorkStatus, isAdmin),
    );
    // PENDING er systemets startstatus og skal ikke velges manuelt.
    // Kansellering krever workorders.edit, så den skjules for brukere som
    // bare har tildelingsrett.
    const statusOptions = canUpdateStatus
      ? STATUS_OPTION_ORDER.filter(
          (status) =>
            status !== "PENDING" &&
            allowed.has(status) &&
            (status !== "CANCELLED" || canCancel),
        )
      : [];

    group.workOrders.push({
      id: workOrder.id,
      title: workOrder.title,
      status: workOrder.status,
      customerName:
        workOrder.customer?.name || t("calendar.common.noCustomer"),
      address: formatAddress(workOrder.customer),
      productModel: workOrder.product?.model ?? null,
      description: workOrder.description
        ? markdownToPlainText(workOrder.description).slice(0, 240)
        : "",
      dateRange: formatDateRangeLocalized(
        workOrder.scheduledFor,
        workOrder.scheduledTo,
        locale,
      ),
      technicians: workOrder.technicians.map((technician) => ({
        id: technician.id,
        name: technician.name ?? technician.email ?? technician.id,
      })),
      statusOptions,
    });

    groups.set(key, group);
  }

  const days: DispatchDay[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group);

  function hrefFor(page: number): string {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    search.set("fra", range.fromText);
    search.set("til", range.toText);
    if (page > 1) search.set("side", String(page));
    const queryString = search.toString();
    return queryString
      ? `/kalender/dispatch?${queryString}`
      : "/kalender/dispatch";
  }

  const baseHref = hrefFor(1);
  const legacyError = firstParam(params.error);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* HEADER */}
        <div className="flex flex-col gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 md:text-3xl">
              {t("calendar.dispatch.title")}
            </h1>
            <p className="text-sm text-gray-600">
              {t("calendar.dispatch.subtitle")}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/kalender"
              className="whitespace-nowrap rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              {t("calendar.dispatch.backToCalendar")}
            </Link>
          </div>
        </div>

        {/* Eldre lenker kan fortsatt ha ?error= fra den gamle redirect-flyten. */}
        {legacyError && (
          <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            {legacyError === "ugyldig-status"
              ? t("calendar.dispatch.invalidStatus")
              : t("calendar.dispatch.genericError")}
          </div>
        )}

        <CalendarTabs active="dispatch" canDispatch canReports={canReports} />

        {/* FILTER */}
        <form
          action="/kalender/dispatch"
          method="get"
          className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
            {t("calendar.dispatch.filters.dateFrom")}
            <input
              type="date"
              name="fra"
              defaultValue={range.fromText}
              className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
            {t("calendar.dispatch.filters.dateTo")}
            <input
              type="date"
              name="til"
              defaultValue={range.toText}
              className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm text-gray-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-gray-700 sm:col-span-2">
            {t("calendar.dispatch.filters.search")}
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("calendar.dispatch.filters.searchPlaceholder")}
              className="min-h-11 rounded-xl border-2 border-gray-300 bg-white px-3 text-sm text-gray-900"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="min-h-11 flex-1 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
            >
              {t("calendar.dispatch.filters.apply")}
            </button>
            <Link
              href="/kalender/dispatch"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              {t("calendar.dispatch.filters.clear")}
            </Link>
          </div>
        </form>

        {range.invalid && (
          <div
            role="alert"
            className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"
          >
            {range.invalidOrder
              ? t("calendar.dispatch.filters.rangeError")
              : t("calendar.dispatch.filters.dateError")}
          </div>
        )}

        {/* ANTALL UTEN MONTØR */}
        {unassignedCount > 0 && (
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <h2 className="text-lg font-bold text-amber-800">
                  {t("calendar.dispatch.unassignedCount", {
                    count: unassignedCount,
                  })}
                </h2>
                <p className="mt-1 text-sm text-amber-700">
                  {t("calendar.dispatch.unassignedWarning")}
                </p>
              </div>
              <Link
                href={baseHref}
                className="whitespace-nowrap rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700"
              >
                {t("calendar.dispatch.refresh")}
              </Link>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
          <span>
            {t("calendar.dispatch.resultRange", {
              from: total === 0 ? 0 : pagination.skip + 1,
              to: pagination.skip + workOrders.length,
              total,
            })}
          </span>
          {pagination.totalPages > 1 && (
            <nav
              aria-label={t("calendar.dispatch.pages")}
              className="flex items-center gap-2"
            >
              {pagination.page > 1 ? (
                <Link
                  href={hrefFor(pagination.page - 1)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 font-bold text-gray-700 hover:bg-gray-50"
                >
                  ← {t("calendar.dispatch.pagePrevious")}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 font-bold text-gray-400"
                >
                  ← {t("calendar.dispatch.pagePrevious")}
                </span>
              )}
              <span className="text-xs font-bold">
                {t("calendar.dispatch.pageOf", {
                  page: pagination.page,
                  total: pagination.totalPages,
                })}
              </span>
              {pagination.page < pagination.totalPages ? (
                <Link
                  href={hrefFor(pagination.page + 1)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 font-bold text-gray-700 hover:bg-gray-50"
                >
                  {t("calendar.dispatch.pageNext")} →
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 font-bold text-gray-400"
                >
                  {t("calendar.dispatch.pageNext")} →
                </span>
              )}
            </nav>
          )}
        </div>

        <DispatchBoard
          days={days}
          technicians={technicians.map((technician) => ({
            id: technician.id,
            name: technician.name ?? technician.id,
          }))}
        />
      </div>
    </div>
  );
}
